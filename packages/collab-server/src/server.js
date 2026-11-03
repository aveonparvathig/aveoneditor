/**
 * Aveon Editor collaboration server.
 *
 * The server keeps one ordered log of model operations per document. Clients send operations
 * together with the version they are based on; the server accepts them only when that version is
 * current (otherwise the client rebases on the newer operations and resends). Because every client
 * applies the same operations in the same order, all copies of a document stay identical.
 *
 * The server never parses document content: it stores the operation log, the latest snapshot
 * (HTML at a version, sent by clients) and the comment threads, and relays presence (who is
 * connected and where their cursor is).
 *
 *   import { createCollaborationServer, FileStorage } from '@aveon/collab-server';
 *   const server = createCollaborationServer({
 *     port: 1234,
 *     storage: new FileStorage('./collab-data'),
 *     authenticate: async ({ token, documentId }) => verifyToken(token, documentId), // user or null
 *     onSnapshot: async ({ documentId, version, data }) => saveHtmlToDatabase(documentId, data)
 *   });
 */

import { WebSocketServer } from 'ws';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const DOCUMENT_ID = /^[\w.:-]{1,128}$/;
const COLORS = 8;

/** Keeps documents as JSON files in a directory. */
export class FileStorage {
  constructor(directory) {
    this.directory = directory;
  }

  _file(documentId) {
    return path.join(this.directory, `${encodeURIComponent(documentId)}.json`);
  }

  async load(documentId) {
    try {
      return JSON.parse(await fs.readFile(this._file(documentId), 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async save(documentId, state) {
    await fs.mkdir(this.directory, { recursive: true });
    const file = this._file(documentId);
    await fs.writeFile(`${file}.tmp`, JSON.stringify(state));
    await fs.rename(`${file}.tmp`, file);
  }
}

/** Keeps documents in memory only (lost on restart). */
export class MemoryStorage {
  constructor() {
    this.documents = new Map();
  }

  async load(documentId) {
    const state = this.documents.get(documentId);
    return state ? JSON.parse(JSON.stringify(state)) : null;
  }

  async save(documentId, state) {
    this.documents.set(documentId, JSON.parse(JSON.stringify(state)));
  }
}

const SQL = {
  postgres: {
    param: i => `$${i}`,
    create: table => `CREATE TABLE IF NOT EXISTS ${table} (id VARCHAR(200) PRIMARY KEY, state TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL)`,
    upsert: table => `INSERT INTO ${table} (id, state, updated_at) VALUES ($1, $2, $3) ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state, updated_at = EXCLUDED.updated_at`
  },
  mssql: {
    param: i => `@p${i}`,
    create: table => `IF OBJECT_ID(N'${table}', N'U') IS NULL CREATE TABLE ${table} (id NVARCHAR(200) NOT NULL PRIMARY KEY, state NVARCHAR(MAX) NOT NULL, updated_at DATETIME2 NOT NULL)`,
    upsert: table =>
      `MERGE ${table} WITH (HOLDLOCK) AS t USING (SELECT @p1 AS id, @p2 AS state, @p3 AS updated_at) AS s ON t.id = s.id ` +
      'WHEN MATCHED THEN UPDATE SET state = s.state, updated_at = s.updated_at WHEN NOT MATCHED THEN INSERT (id, state, updated_at) VALUES (s.id, s.state, s.updated_at);'
  },
  mysql: {
    param: () => '?',
    create: table => `CREATE TABLE IF NOT EXISTS ${table} (id VARCHAR(200) PRIMARY KEY, state LONGTEXT NOT NULL, updated_at DATETIME(3) NOT NULL)`,
    upsert: table => `INSERT INTO ${table} (id, state, updated_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE state = VALUES(state), updated_at = VALUES(updated_at)`
  },
  sqlite: {
    param: () => '?',
    create: table => `CREATE TABLE IF NOT EXISTS ${table} (id TEXT PRIMARY KEY, state TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    upsert: table => `INSERT INTO ${table} (id, state, updated_at) VALUES (?, ?, ?) ON CONFLICT (id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`
  }
};

/**
 * Keeps documents in a SQL database shared by all collaboration servers, so any server can open
 * any document (after a restart, a failover or when servers are added).
 *
 *   import pg from 'pg';
 *   const storage = SqlStorage.postgres(new pg.Pool({ connectionString: process.env.DATABASE_URL }));
 *
 * Also `SqlStorage.mssql(pool)` (package `mssql`), `SqlStorage.mysql(pool)` (`mysql2/promise`) and
 * `SqlStorage.sqlite(db)` (`node:sqlite`), or `new SqlStorage({ dialect, query })` with any driver
 * whose `query(sql, params)` resolves to the result rows. The table (default `aveon_documents`) is
 * created when missing unless `createTable: false`.
 */
export class SqlStorage {
  constructor({ dialect = 'postgres', query, table = 'aveon_documents', createTable = true }) {
    if (!SQL[dialect]) throw new Error(`aveon-collab: unknown SQL dialect "${dialect}" (postgres, mssql, mysql or sqlite).`);
    if (!/^[A-Za-z_][\w.]*$/.test(table)) throw new Error(`aveon-collab: invalid table name "${table}".`);
    this.dialect = SQL[dialect];
    this.query = query;
    this.table = table;
    this._ready = createTable ? null : Promise.resolve();
  }

  static postgres(pool, options) {
    return new SqlStorage({ ...options, dialect: 'postgres', query: (sql, params) => pool.query(sql, params).then(result => result.rows) });
  }

  static mssql(pool, options) {
    return new SqlStorage({
      ...options,
      dialect: 'mssql',
      query: (sql, params) => {
        const request = pool.request();
        params.forEach((value, i) => request.input(`p${i + 1}`, value));
        return request.query(sql).then(result => result.recordset || []);
      }
    });
  }

  static mysql(pool, options) {
    return new SqlStorage({ ...options, dialect: 'mysql', query: (sql, params) => pool.query(sql, params).then(([rows]) => (Array.isArray(rows) ? rows : [])) });
  }

  static sqlite(db, options) {
    return new SqlStorage({
      ...options,
      dialect: 'sqlite',
      query: async (sql, params) => {
        const statement = db.prepare(sql);
        return /^\s*select/i.test(sql) ? statement.all(...params) : (statement.run(...params), []);
      }
    });
  }

  _init() {
    if (!this._ready) this._ready = this.query(this.dialect.create(this.table), []);
    return this._ready;
  }

  async load(documentId) {
    await this._init();
    const rows = await this.query(`SELECT state FROM ${this.table} WHERE id = ${this.dialect.param(1)}`, [documentId]);
    return rows.length ? JSON.parse(rows[0].state) : null;
  }

  async save(documentId, state) {
    await this._init();
    const updatedAt = this.dialect === SQL.sqlite ? new Date().toISOString() : new Date();
    await this.query(this.dialect.upsert(this.table), [documentId, JSON.stringify(state), updatedAt]);
  }
}

class Room {
  constructor(id, state) {
    this.id = id;
    this.initialData = state.initialData ?? '';
    this.snapshot = state.snapshot ?? null;
    this.opsStart = state.opsStart ?? 0;
    this.ops = state.ops ?? [];
    this.threads = new Map((state.threads ?? []).map(thread => [thread.id, thread]));
    this.clients = new Set();
    this.saveTimer = null;
    /** Cursor moves waiting to be sent (client id → selection), sent together a few times a second. */
    this.presence = new Map();
    this.presenceTimer = null;
  }

  get version() {
    return this.opsStart + this.ops.length;
  }

  opsSince(version) {
    if (version < this.opsStart || version > this.version) return null;
    return this.ops.slice(version - this.opsStart);
  }

  toJSON() {
    return { initialData: this.initialData, snapshot: this.snapshot, opsStart: this.opsStart, ops: this.ops, threads: [...this.threads.values()] };
  }
}

/**
 * Starts a collaboration server.
 *
 * Options: `port` or `server` (an existing HTTP server to attach to), `path` (default any),
 * `storage` (default in memory), `authenticate({ token, documentId, user, request })` returning the
 * user (`{ id, name }`) or null to refuse, `onSnapshot({ documentId, version, data })` called when the
 * latest HTML is known, `keepOperations` (operations kept for reconnecting clients, default 2000),
 * `saveDelay` (ms, default 1000), `presenceInterval` (ms cursor moves are gathered before being
 * sent, default 50) and `maxPayload` (bytes, default 5 MB).
 */
export function createCollaborationServer(options = {}) {
  const storage = options.storage || new MemoryStorage();
  const keepOperations = options.keepOperations ?? 2000;
  const saveDelay = options.saveDelay ?? 1000;
  const presenceInterval = options.presenceInterval ?? 50;
  const rooms = new Map();
  const loading = new Map();
  let nextClientId = 1;
  const connections = new Set();
  /** Saves under way, so stopping the server waits for them. */
  const pendingSaves = new Set();
  /** Running totals for monitoring (see `stats()`). */
  const counters = { operations: 0, rejects: 0, resyncs: 0 };

  const wss = new WebSocketServer({
    port: options.server ? undefined : options.port ?? 1234,
    server: options.server,
    path: options.path,
    maxPayload: options.maxPayload ?? 5 * 1024 * 1024
  });

  async function getRoom(documentId, initialData) {
    if (rooms.has(documentId)) return rooms.get(documentId);
    if (!loading.has(documentId)) {
      loading.set(
        documentId,
        (async () => {
          const stored = await storage.load(documentId);
          const room = new Room(documentId, stored || { initialData: initialData ?? '' });
          rooms.set(documentId, room);
          loading.delete(documentId);
          if (!stored) scheduleSave(room);
          return room;
        })()
      );
    }
    return loading.get(documentId);
  }

  function scheduleSave(room) {
    clearTimeout(room.saveTimer);
    room.saveTimer = setTimeout(() => {
      room.saveTimer = null;
      storage.save(room.id, room.toJSON()).catch(error => console.error(`aveon-collab: saving "${room.id}" failed`, error));
    }, saveDelay);
  }

  function send(socket, message) {
    if (socket.readyState === 1) socket.send(JSON.stringify(message));
  }

  function broadcast(room, message, except) {
    // Serialised once for everyone in the room.
    const data = JSON.stringify(message);
    for (const client of room.clients) {
      if (client !== except && client.socket.readyState === 1) client.socket.send(data);
    }
  }

  /**
   * Cursor moves are gathered per document and sent as one message: in a document with n people,
   * each move would otherwise cost n − 1 messages (n² in total when everyone moves).
   */
  function queuePresence(client) {
    const room = client.room;
    room.presence.set(client.id, client.selection);
    if (room.presenceTimer) return;
    room.presenceTimer = setTimeout(() => flushPresence(room), presenceInterval);
  }

  function flushPresence(room) {
    room.presenceTimer = null;
    if (!room.presence.size) return;
    const updates = [...room.presence].map(([clientId, selection]) => ({ clientId, selection }));
    room.presence.clear();
    if (updates.length === 1) {
      const sender = [...room.clients].find(client => client.id === updates[0].clientId);
      return broadcast(room, { type: 'presence', ...updates[0] }, sender);
    }
    // Everyone gets the same message; clients ignore their own entry.
    broadcast(room, { type: 'presence', updates });
  }

  function publicClient(client) {
    return { clientId: client.id, user: client.user, color: client.color, selection: client.selection };
  }

  function freeColor(room) {
    const used = new Set([...room.clients].map(client => client.color));
    for (let color = 0; color < COLORS; color++) if (!used.has(color)) return color;
    return room.clients.size % COLORS;
  }

  async function onJoin(client, message) {
    const documentId = String(message.documentId || '');
    if (!DOCUMENT_ID.test(documentId)) return send(client.socket, { type: 'error', message: 'Invalid document id.' });
    let user = message.user && typeof message.user === 'object' ? { id: String(message.user.id || 'user'), name: String(message.user.name || 'User') } : { id: 'user', name: 'User' };
    if (options.authenticate) {
      const result = await options.authenticate({ token: message.token, documentId, user, request: client.request });
      if (!result) {
        send(client.socket, { type: 'error', message: 'Not allowed.', fatal: true });
        return client.socket.close(4401, 'Not allowed');
      }
      if (typeof result === 'object') user = { id: String(result.id), name: String(result.name || result.id) };
    }
    const room = await getRoom(documentId, typeof message.initialData === 'string' ? message.initialData : '');
    client.room = room;
    client.user = user;
    client.color = freeColor(room);
    client.selection = null;
    const others = [...room.clients].map(publicClient);
    room.clients.add(client);

    const base = { type: 'joined', clientId: client.id, color: client.color, version: room.version, users: others, threads: [...room.threads.values()] };
    const since = Number.isInteger(message.version) && !message.fresh ? room.opsSince(message.version) : null;
    if (since) {
      // Reconnect: the client keeps its document and catches up.
      send(client.socket, { ...base, fromVersion: message.version, ops: since });
    } else {
      // Fresh start: from the latest snapshot (or the initial content) plus the operations after it.
      // `noSnapshot` asks for the full history (a client that could not apply operations on a snapshot).
      const fromSnapshot = room.snapshot && room.opsSince(room.snapshot.version) && (!message.noSnapshot || room.opsStart > 0);
      const dataVersion = fromSnapshot ? room.snapshot.version : 0;
      const data = fromSnapshot ? room.snapshot.data : room.initialData;
      send(client.socket, { ...base, data, fromVersion: dataVersion, ops: room.opsSince(dataVersion) ?? [] });
    }
    broadcast(room, { type: 'user-joined', ...publicClient(client) }, client);
  }

  function onOps(client, message) {
    const room = client.room;
    if (!room || !Array.isArray(message.ops)) return;
    if (message.version !== room.version) {
      // Based on an old version: the client rebases on these operations and sends again.
      if (!room.opsSince(message.version)) {
        counters.resyncs++;
        return send(client.socket, { type: 'resync' });
      }
      counters.rejects++;
      // The client already has the newer operations (each was broadcast to it, in order, before this
      // reply), so they are not sent again: it rebases on them and sends again from `version`.
      return send(client.socket, { type: 'reject', fromVersion: room.version, ops: [] });
    }
    const fromVersion = room.version;
    room.ops.push(...message.ops);
    counters.operations += message.ops.length;
    // Old operations are dropped once a snapshot covers them (keeping some for reconnects).
    const excess = room.ops.length - keepOperations;
    if (excess > 0 && room.snapshot && room.snapshot.version > room.opsStart) {
      const drop = Math.min(excess, room.snapshot.version - room.opsStart);
      room.ops.splice(0, drop);
      room.opsStart += drop;
    }
    send(client.socket, { type: 'ack', version: room.version });
    broadcast(room, { type: 'ops', fromVersion, ops: message.ops, clientId: client.id }, client);
    scheduleSave(room);
  }

  function onSnapshot(client, message) {
    const room = client.room;
    if (!room || typeof message.data !== 'string' || !Number.isInteger(message.version)) return;
    if (message.version > room.version || (room.snapshot && message.version <= room.snapshot.version)) return;
    room.snapshot = { version: message.version, data: message.data };
    scheduleSave(room);
    if (options.onSnapshot) {
      Promise.resolve(options.onSnapshot({ documentId: room.id, version: message.version, data: message.data })).catch(error => console.error('aveon-collab: onSnapshot failed', error));
    }
  }

  function onThreads(client, message) {
    const room = client.room;
    if (!room) return;
    const upserts = Array.isArray(message.upserts) ? message.upserts.filter(thread => thread && typeof thread.id === 'string') : [];
    const removals = Array.isArray(message.removals) ? message.removals.filter(id => typeof id === 'string') : [];
    for (const thread of upserts) room.threads.set(thread.id, thread);
    for (const id of removals) room.threads.delete(id);
    broadcast(room, { type: 'threads', upserts, removals }, client);
    scheduleSave(room);
  }

  wss.on('connection', (socket, request) => {
    const client = { id: nextClientId++, socket, request, room: null, user: null, color: 0, selection: null, queue: Promise.resolve() };
    socket.on('message', raw => {
      let message;
      try {
        message = JSON.parse(String(raw));
      } catch {
        return send(socket, { type: 'error', message: 'Invalid message.' });
      }
      // Messages are handled in order, even when joining has to wait for storage.
      client.queue = client.queue
        .then(() => {
          if (message.type === 'join') return client.room ? undefined : onJoin(client, message);
          if (!client.room) return undefined;
          if (message.type === 'ops') return onOps(client, message);
          if (message.type === 'presence') {
            client.selection = message.selection ?? null;
            return queuePresence(client);
          }
          if (message.type === 'snapshot') return onSnapshot(client, message);
          if (message.type === 'threads') return onThreads(client, message);
          return undefined;
        })
        .catch(error => {
          console.error('aveon-collab:', error);
          send(socket, { type: 'error', message: 'Server error.' });
        });
    });
    connections.add(client);
    client.closed = new Promise(resolve => {
      socket.on('close', () => {
        // After the messages the client sent before leaving (e.g. its last snapshot).
        client.queue = client.queue.then(() => onClose(client)).finally(() => {
          connections.delete(client);
          resolve();
        });
      });
    });
  });

  function onClose(client) {
    const room = client.room;
    if (!room) return;
    room.clients.delete(client);
    room.presence.delete(client.id);
    broadcast(room, { type: 'user-left', clientId: client.id });
    if (!room.clients.size) {
      // Keep the room in memory until it is saved, then let it go.
      clearTimeout(room.saveTimer);
      clearTimeout(room.presenceTimer);
      room.presenceTimer = null;
      const saving = storage
        .save(room.id, room.toJSON())
        .catch(error => console.error(`aveon-collab: saving "${room.id}" failed`, error))
        .finally(() => {
          pendingSaves.delete(saving);
          if (!room.clients.size) rooms.delete(room.id);
        });
      pendingSaves.add(saving);
    }
  }

  return {
    wss,
    /** Port the server listens on (useful with `port: 0`). */
    get port() {
      const address = wss.address();
      return typeof address === 'object' && address ? address.port : options.port;
    },
    /** Resolves once the server is listening. */
    ready() {
      return new Promise(resolve => {
        if (options.server || wss.address()) resolve();
        else wss.once('listening', resolve);
      });
    },
    /** Load figures for health checks and metrics. */
    stats() {
      return { connections: wss.clients.size, documents: rooms.size, ...counters };
    },
    /** Users connected to a document. */
    users(documentId) {
      const room = rooms.get(documentId);
      return room ? [...room.clients].map(publicClient) : [];
    },
    /** Saves every open document and stops the server. */
    async close() {
      for (const room of rooms.values()) clearTimeout(room.presenceTimer);
      for (const client of wss.clients) client.terminate();
      // Let every connection finish its queued messages and leave its document first.
      await Promise.all([...connections].map(client => client.closed));
      await Promise.all([...pendingSaves]);
      await Promise.all([...rooms.values()].map(room => storage.save(room.id, room.toJSON())));
      await new Promise(resolve => wss.close(() => resolve()));
    }
  };
}
