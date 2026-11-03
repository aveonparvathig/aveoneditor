import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { WebSocket } from 'ws';
import { createCollaborationServer, SqlStorage } from '../src/server.js';

/** Opens a socket, joins a document and resolves with helpers once joined. */
function join(port, documentId) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/?doc=${documentId}`);
    const waiting = [];
    socket.on('error', reject);
    socket.on('open', () => socket.send(JSON.stringify({ type: 'join', documentId, initialData: '<p>Hello</p>' })));
    socket.on('message', raw => {
      const message = JSON.parse(String(raw));
      if (message.type === 'joined') resolve({ socket, joined: message, next: type => new Promise(done => waiting.push({ type, done })) });
      const index = waiting.findIndex(entry => entry.type === message.type);
      if (index !== -1) waiting.splice(index, 1)[0].done(message);
    });
  });
}

test('SQL storage: a document edited on one server opens on another', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'collab-sql-'));
  const file = path.join(dir, 'collab.db');
  const dbA = new DatabaseSync(file);
  const dbB = new DatabaseSync(file);
  const servers = [];
  try {
    const serverA = createCollaborationServer({ port: 0, storage: SqlStorage.sqlite(dbA), saveDelay: 10 });
    servers.push(serverA);
    await serverA.ready();
    const user = await join(serverA.port, 'acme:quote-42');
    const op = { __className: 'InsertOperation', baseVersion: 0, position: { root: 'main', path: [0, 0] }, nodes: [{ data: 'x' }] };
    user.socket.send(JSON.stringify({ type: 'ops', version: user.joined.version, ops: [op, op] }));
    assert.equal((await user.next('ack')).version, 2);
    user.socket.send(JSON.stringify({ type: 'snapshot', version: 2, data: '<p>xxHello</p>' }));
    // Leaving normally: the server reads everything sent before the close.
    await new Promise(resolve => {
      user.socket.once('close', resolve);
      user.socket.close();
    });
    await serverA.close();

    // A second server, with its own database connection, picks the document up.
    const serverB = createCollaborationServer({ port: 0, storage: SqlStorage.sqlite(dbB) });
    servers.push(serverB);
    await serverB.ready();
    const other = await join(serverB.port, 'acme:quote-42');
    assert.equal(other.joined.version, 2);
    assert.equal(other.joined.data, '<p>xxHello</p>');
    other.socket.close();
    await serverB.close();

    const rows = dbB.prepare('SELECT id FROM aveon_documents').all();
    assert.deepEqual(rows.map(row => row.id), ['acme:quote-42']);
  } finally {
    // Closing twice is harmless; a failed assertion must not leave a server running.
    await Promise.all(servers.map(server => server.close().catch(() => {})));
    dbA.close();
    dbB.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('SQL storage: statements for every dialect use that dialect\'s parameters', async () => {
  const seen = [];
  const query = async (sql, params) => {
    seen.push({ sql, params });
    return sql.startsWith('SELECT') ? [{ state: '{"initialData":"<p>a</p>"}' }] : [];
  };
  for (const dialect of ['postgres', 'mssql', 'mysql']) {
    seen.length = 0;
    const storage = new SqlStorage({ dialect, query, table: 'docs' });
    assert.deepEqual(await storage.load('d1'), { initialData: '<p>a</p>' });
    await storage.save('d1', { initialData: '<p>b</p>' });
    assert.match(seen.at(0).sql, /CREATE TABLE/);
    assert.match(seen.at(1).sql, dialect === 'postgres' ? /\$1/ : dialect === 'mssql' ? /@p1/ : /\?/);
    assert.deepEqual(seen.at(2).params.slice(0, 2), ['d1', '{"initialData":"<p>b</p>"}']);
  }
  assert.throws(() => new SqlStorage({ query, table: 'docs; DROP TABLE x' }), /invalid table/);
});
