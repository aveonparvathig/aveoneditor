#!/usr/bin/env node
/**
 * Runs the collaboration server:  aveon-collab --port 1234 --data ./collab-data [--workers 4]
 * Without --data, documents are kept in memory only.
 *
 * --workers N runs N server processes behind one port (use about one per CPU core). Everyone editing
 * the same document is sent to the same process, chosen from the `?doc=` part of the address that
 * the editor adds; connections without it all go to the first process.
 */

import cluster from 'node:cluster';
import http from 'node:http';
import net from 'node:net';
import { createCollaborationServer, FileStorage, MemoryStorage } from '../src/server.js';

const args = process.argv.slice(2);
const option = name => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? undefined : args[index + 1];
};

if (args.includes('--help')) {
  console.log('Usage: aveon-collab [--port 1234] [--data ./collab-data] [--workers 4] [--stats]');
  process.exit(0);
}

const port = Number(option('port') || process.env.PORT || 1234);
const dataDir = option('data') || process.env.AVEON_COLLAB_DATA;
const workers = Math.max(1, Number(option('workers') || process.env.AVEON_COLLAB_WORKERS || 1));
const showStats = args.includes('--stats');
const where = dataDir ? ` (documents in ${dataDir})` : ' (in memory)';

if (workers > 1 && cluster.isPrimary) await runPrimary();
else if (cluster.isWorker) await runWorker();
else await runSingle();

/** One process doing everything. */
async function runSingle() {
  const server = createCollaborationServer({ port, storage: createStorage() });
  await server.ready();
  console.log(`Aveon collaboration server listening on ws://localhost:${server.port}${where}`);
  if (showStats) setInterval(() => console.log(formatStats(sampleStats(server))), 2000).unref();
  stopOnSignal(() => server.close());
}

/** Accepts connections and hands each one to the process that owns its document. */
async function runPrimary() {
  const pool = [];
  for (let i = 0; i < workers; i++) pool.push(cluster.fork());
  await Promise.all(pool.map(worker => new Promise(resolve => worker.on('message', message => message.type === 'ready' && resolve()))));

  const balancer = net.createServer(socket => {
    socket.on('error', () => socket.destroy());
    let head = Buffer.alloc(0);
    const onData = chunk => {
      head = Buffer.concat([head, chunk]);
      const lineEnd = head.indexOf('\r\n');
      if (lineEnd === -1 && head.length < 8192) return;
      socket.off('data', onData);
      socket.pause();
      // "GET /path?doc=ID HTTP/1.1": the document decides the process.
      const target = head.subarray(0, lineEnd === -1 ? head.length : lineEnd).toString('latin1').split(' ')[1] || '';
      const documentId = new URLSearchParams(target.split('?')[1] || '').get('doc') || '';
      const worker = pool[documentId ? hash(documentId) % pool.length : 0];
      // The bytes already read go along with the connection.
      worker.send({ type: 'connection', head: head.toString('base64') }, socket);
    };
    socket.on('data', onData);
  });
  await new Promise(resolve => balancer.listen(port, resolve));
  console.log(`Aveon collaboration server listening on ws://localhost:${port} with ${workers} processes${where}`);

  if (showStats) {
    // Totals over the processes; CPU is the sum (100% = one core).
    const latest = new Map();
    for (const worker of pool) worker.on('message', message => message.type === 'stats' && latest.set(worker.id, message.stats));
    setInterval(() => {
      const all = [...latest.values()];
      if (!all.length) return;
      const sum = key => all.reduce((total, stats) => total + stats[key], 0);
      console.log(formatStats({ cpu: sum('cpu'), rss: sum('rss'), heap: sum('heap'), connections: sum('connections') }));
    }, 2000).unref();
  }
  cluster.on('exit', (worker, code) => {
    if (code !== 0) console.error(`aveon-collab: process ${worker.id} stopped (${code}); its documents are unavailable until restart`);
  });
  stopOnSignal(async () => {
    balancer.close();
    // Each process saves its open documents before stopping.
    await Promise.all(pool.map(worker => new Promise(resolve => {
      worker.once('exit', resolve);
      worker.send({ type: 'stop' });
    })));
  });
}

/** Serves the connections the primary hands over. */
async function runWorker() {
  const httpServer = http.createServer((request, response) => response.writeHead(426).end());
  const server = createCollaborationServer({ server: httpServer, storage: createStorage() });
  process.on('message', async (message, socket) => {
    if (message.type === 'connection' && socket) {
      httpServer.emit('connection', socket);
      socket.unshift(Buffer.from(message.head, 'base64'));
      socket.resume();
    } else if (message.type === 'stop') {
      await server.close();
      process.exit(0);
    }
  });
  if (showStats) setInterval(() => process.send({ type: 'stats', stats: sampleStats(server) }), 2000).unref();
  // Stopping is coordinated by the primary.
  process.on('SIGINT', () => {});
  process.on('SIGTERM', () => {});
  process.send({ type: 'ready' });
}

function createStorage() {
  return dataDir ? new FileStorage(dataDir) : new MemoryStorage();
}

let lastCpu = process.cpuUsage();
let lastTime = process.hrtime.bigint();
/** Load since the previous sample: CPU (share of one core), memory and connections. */
function sampleStats(server) {
  const cpu = process.cpuUsage(lastCpu);
  const now = process.hrtime.bigint();
  const percent = ((cpu.user + cpu.system) / 1000 / (Number(now - lastTime) / 1e6)) * 100;
  lastCpu = process.cpuUsage();
  lastTime = now;
  const memory = process.memoryUsage();
  return { cpu: percent, rss: memory.rss / 1e6, heap: memory.heapUsed / 1e6, connections: server.wss.clients.size };
}

function formatStats({ cpu, rss, heap, connections }) {
  return `stats cpu=${cpu.toFixed(0)}% rss=${rss.toFixed(0)}MB heap=${heap.toFixed(0)}MB connections=${connections}`;
}

/** FNV-1a: the same document always maps to the same process. */
function hash(text) {
  let value = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 0x01000193);
  return value >>> 0;
}

function stopOnSignal(stop) {
  const handler = async () => {
    await stop();
    process.exit(0);
  };
  process.on('SIGINT', handler);
  process.on('SIGTERM', handler);
}
