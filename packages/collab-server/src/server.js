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
      if (!room.opsSince(message.version)) return send(client.socket, { type: 'resync' });
      // The client already has the newer operations (each was broadcast to it, in order, before this
      // reply), so they are not sent again: it rebases on them and sends again from `version`.
      return send(client.socket, { type: 'reject', fromVersion: room.version, ops: [] });
    }
    const fromVersion = room.version;
    room.ops.push(...message.ops);
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
    socket.on('close', () => {
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
        storage
          .save(room.id, room.toJSON())
          .catch(error => console.error(`aveon-collab: saving "${room.id}" failed`, error))
          .finally(() => {
            if (!room.clients.size) rooms.delete(room.id);
          });
      }
    });
  });

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
    /** Users connected to a document. */
    users(documentId) {
      const room = rooms.get(documentId);
      return room ? [...room.clients].map(publicClient) : [];
    },
    /** Saves every open document and stops the server. */
    async close() {
      for (const room of rooms.values()) clearTimeout(room.presenceTimer);
      for (const client of wss.clients) client.terminate();
      await Promise.all([...rooms.values()].map(room => storage.save(room.id, room.toJSON())));
      await new Promise(resolve => wss.close(() => resolve()));
    }
  };
}
