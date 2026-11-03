#!/usr/bin/env node
/**
 * Runs the collaboration server:  aveon-collab --port 1234 [--workers 4] [storage] [--stats]
 *
 * Storage (where documents are kept between sessions), one of:
 *   --data ./collab-data          JSON files in a folder (one server only)
 *   --sqlite ./collab.db          SQLite file (Node 22.5+)
 *   --postgres <connection URL>   PostgreSQL, shared by several servers (needs `npm install pg`)
 *   --mssql <connection string>   SQL Server (needs `npm install mssql`)
 *   --mysql <connection URL>      MySQL / MariaDB (needs `npm install mysql2`)
 *   (none)                        memory only, lost on restart
 *
 * --workers N runs N server processes behind one port (use about one per CPU core). Everyone editing
 * the same document is sent to the same process, chosen from the `?doc=` part of the address that
 * the editor adds; connections without it all go to the first process. A process that stops is
 * started again.
 *
 * GET /health answers 200 while every process is up (503 otherwise) and GET /metrics gives
 * Prometheus metrics, on the same port.
 */

import cluster from 'node:cluster';
import http from 'node:http';
import net from 'node:net';
import { createCollaborationServer, FileStorage, MemoryStorage, SqlStorage } from '../src/server.js';

const args = process.argv.slice(2);
const option = name => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? undefined : args[index + 1];
};

if (args.includes('--help')) {
  console.log('Usage: aveon-collab [--port 1234] [--workers 4] [--data DIR | --sqlite FILE | --postgres URL | --mssql CONN | --mysql URL] [--stats]');
  process.exit(0);
}

const port = Number(option('port') || process.env.PORT || 1234);
const workers = Math.max(1, Number(option('workers') || process.env.AVEON_COLLAB_WORKERS || 1));
const showStats = args.includes('--stats');
const storageConfig = {
  data: option('data') || process.env.AVEON_COLLAB_DATA,
  sqlite: option('sqlite'),
  postgres: option('postgres') || process.env.AVEON_COLLAB_POSTGRES,
  mssql: option('mssql') || process.env.AVEON_COLLAB_MSSQL,
  mysql: option('mysql') || process.env.AVEON_COLLAB_MYSQL
};
const where = storageConfig.postgres ? ' (documents in PostgreSQL)' : storageConfig.mssql ? ' (documents in SQL Server)' : storageConfig.mysql ? ' (documents in MySQL)' : storageConfig.sqlite ? ` (documents in ${storageConfig.sqlite})` : storageConfig.data ? ` (documents in ${storageConfig.data})` : ' (in memory)';
const startedAt = Date.now();
// Before the server starts: the samples below read these.
let lastCpu = process.cpuUsage();
let lastTime = process.hrtime.bigint();

if (workers > 1 && cluster.isPrimary) await runPrimary();
else if (cluster.isWorker) await runWorker();
else await runSingle();

/** One process doing everything. */
async function runSingle() {
  const httpServer = http.createServer((request, response) => {
    const stats = { ...server.stats(), ...sampleProcess(), workersUp: 1, workers: 1, restarts: 0 };
    if (!answerMonitoring(request, response, stats, true)) response.writeHead(426).end('Upgrade required');
  });
  const server = createCollaborationServer({ server: httpServer, storage: await createStorage() });
  await new Promise(resolve => httpServer.listen(port, resolve));
  console.log(`Aveon collaboration server listening on ws://localhost:${httpServer.address().port}${where}`);
  if (showStats) setInterval(() => console.log(formatStats({ ...server.stats(), ...sampleProcess() })), 2000).unref();
  stopOnSignal(async () => {
    await server.close();
    httpServer.close();
  });
}

/** Accepts connections and hands each one to the process that owns its document. */
async function runPrimary() {
  const pool = new Array(workers).fill(null);
  const latest = new Map();
  const waiting = [];
  let restarts = 0;
  let stopping = false;

  // Each slot always has a process: a stopped one is replaced, keeping its slot (and so its documents).
  const start = slot => {
    const worker = cluster.fork({ AVEON_COLLAB_SLOT: String(slot) });
    worker.ready = false;
    pool[slot] = worker;
    worker.on('message', message => {
      if (message.type === 'ready') {
        worker.ready = true;
        for (const entry of waiting.splice(0)) dispatch(entry.socket, entry.head, entry.slot);
      } else if (message.type === 'stats') {
        latest.set(slot, message.stats);
      }
    });
    worker.on('exit', code => {
      latest.delete(slot);
      if (stopping) return;
      restarts++;
      console.error(`aveon-collab: process ${slot + 1} stopped (${code ?? 'signal'}); starting it again`);
      // Its documents are saved by the storage; a short pause avoids a restart loop eating the CPU.
      setTimeout(() => !stopping && start(slot), restarts > 5 ? 1000 : 100);
    });
    return worker;
  };
  for (let slot = 0; slot < workers; slot++) start(slot);
  await new Promise(resolve => {
    const check = setInterval(() => {
      if (pool.every(worker => worker.ready)) {
        clearInterval(check);
        resolve();
      }
    }, 20);
  });

  const totals = () => {
    const all = [...latest.values()];
    const sum = key => all.reduce((total, stats) => total + (stats[key] || 0), 0);
    return {
      cpu: sum('cpu'),
      rss: sum('rss'),
      heap: sum('heap'),
      connections: sum('connections'),
      documents: sum('documents'),
      operations: sum('operations'),
      rejects: sum('rejects'),
      resyncs: sum('resyncs'),
      workers,
      workersUp: pool.filter(worker => worker.ready).length,
      restarts,
      processes: pool.map((worker, slot) => ({ slot: slot + 1, pid: worker.process.pid, up: worker.ready }))
    };
  };

  function dispatch(socket, head, slot) {
    const worker = pool[slot];
    if (!worker.ready) {
      // Being restarted: the connection waits (the editor would otherwise retry anyway).
      waiting.push({ socket, head, slot });
      setTimeout(() => {
        const index = waiting.findIndex(entry => entry.socket === socket);
        if (index !== -1) waiting.splice(index, 1)[0].socket.destroy();
      }, 10000).unref();
      return;
    }
    // The bytes already read go along with the connection.
    worker.send({ type: 'connection', head: head.toString('base64') }, socket, error => error && socket.destroy());
  }

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
      const [method, target = ''] = head.subarray(0, lineEnd === -1 ? head.length : lineEnd).toString('latin1').split(' ');
      const pathname = target.split('?')[0];
      if (method === 'GET' && (pathname === '/health' || pathname === '/metrics')) return answerRaw(socket, pathname, totals());
      const documentId = new URLSearchParams(target.split('?')[1] || '').get('doc') || '';
      dispatch(socket, head, documentId ? hash(documentId) % pool.length : 0);
    };
    socket.on('data', onData);
  });
  await new Promise(resolve => balancer.listen(port, resolve));
  console.log(`Aveon collaboration server listening on ws://localhost:${port} with ${workers} processes${where}`);

  if (showStats) setInterval(() => latest.size && console.log(formatStats(totals())), 2000).unref();
  stopOnSignal(async () => {
    stopping = true;
    balancer.close();
    // Each process saves its open documents before stopping.
    await Promise.all(
      pool.map(
        worker =>
          new Promise(resolve => {
            if (worker.isDead()) return resolve();
            worker.once('exit', resolve);
            worker.send({ type: 'stop' });
          })
      )
    );
  });
}

/** Serves the connections the primary hands over. */
async function runWorker() {
  const httpServer = http.createServer((request, response) => response.writeHead(426).end());
  const server = createCollaborationServer({ server: httpServer, storage: await createStorage() });
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
  // Figures for /health, /metrics and --stats, collected by the primary.
  const report = () => process.send({ type: 'stats', stats: { ...server.stats(), ...sampleProcess() } });
  setInterval(report, 2000).unref();
  // Stopping is coordinated by the primary.
  process.on('SIGINT', () => {});
  process.on('SIGTERM', () => {});
  process.send({ type: 'ready' });
  report();
}

async function createStorage() {
  const load = async name => {
    try {
      return await import(name);
    } catch {
      console.error(`aveon-collab: this storage needs the "${name}" package (npm install ${name.split('/')[0]}).`);
      process.exit(1);
    }
  };
  if (storageConfig.postgres) {
    const pg = (await load('pg')).default;
    return SqlStorage.postgres(new pg.Pool({ connectionString: storageConfig.postgres }));
  }
  if (storageConfig.mssql) {
    const mssql = (await load('mssql')).default;
    return SqlStorage.mssql(await new mssql.ConnectionPool(storageConfig.mssql).connect());
  }
  if (storageConfig.mysql) {
    const mysql = await load('mysql2/promise');
    return SqlStorage.mysql((mysql.default || mysql).createPool(storageConfig.mysql));
  }
  if (storageConfig.sqlite) {
    const { DatabaseSync } = await load('node:sqlite');
    const db = new DatabaseSync(storageConfig.sqlite);
    // Several processes share the file: wait for each other's writes instead of failing.
    db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
    return SqlStorage.sqlite(db);
  }
  return storageConfig.data ? new FileStorage(storageConfig.data) : new MemoryStorage();
}

/** This process since the previous sample: CPU (share of one core) and memory (MB). */
function sampleProcess() {
  const cpu = process.cpuUsage(lastCpu);
  const now = process.hrtime.bigint();
  const elapsed = Number(now - lastTime) / 1e6;
  const percent = elapsed > 0 ? ((cpu.user + cpu.system) / 1000 / elapsed) * 100 : 0;
  lastCpu = process.cpuUsage();
  lastTime = now;
  const memory = process.memoryUsage();
  return { cpu: percent, rss: memory.rss / 1e6, heap: memory.heapUsed / 1e6 };
}

function formatStats({ cpu, rss, heap, connections }) {
  return `stats cpu=${cpu.toFixed(0)}% rss=${rss.toFixed(0)}MB heap=${heap.toFixed(0)}MB connections=${connections}`;
}

/** The /health and /metrics bodies: `[status, contentType, body]`. */
function monitoringResponse(pathname, stats) {
  if (pathname === '/health') {
    const healthy = stats.workersUp === stats.workers;
    const body = { status: healthy ? 'ok' : 'degraded', workers: stats.workers, workersUp: stats.workersUp, connections: stats.connections, documents: stats.documents, uptimeSeconds: Math.round((Date.now() - startedAt) / 1000), processes: stats.processes || [{ slot: 1, pid: process.pid, up: true }] };
    return [healthy ? 200 : 503, 'application/json', JSON.stringify(body)];
  }
  const lines = [
    ['aveon_collab_connections', 'gauge', 'Open editor connections', stats.connections],
    ['aveon_collab_documents', 'gauge', 'Documents open in memory', stats.documents],
    ['aveon_collab_operations_total', 'counter', 'Editing operations accepted', stats.operations],
    ['aveon_collab_rejects_total', 'counter', 'Edits sent again after a conflict', stats.rejects],
    ['aveon_collab_resyncs_total', 'counter', 'Clients that had to reload the document', stats.resyncs],
    ['aveon_collab_cpu_percent', 'gauge', 'CPU use, 100 = one core', Math.round(stats.cpu)],
    ['aveon_collab_memory_bytes', 'gauge', 'Resident memory', Math.round(stats.rss * 1e6)],
    ['aveon_collab_workers', 'gauge', 'Server processes configured', stats.workers],
    ['aveon_collab_workers_up', 'gauge', 'Server processes running', stats.workersUp],
    ['aveon_collab_worker_restarts_total', 'counter', 'Server processes started again after stopping', stats.restarts]
  ].flatMap(([name, type, help, value]) => [`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`, `${name} ${value ?? 0}`]);
  return [200, 'text/plain; version=0.0.4', `${lines.join('\n')}\n`];
}

function answerMonitoring(request, response, stats) {
  const pathname = (request.url || '').split('?')[0];
  if (request.method !== 'GET' || (pathname !== '/health' && pathname !== '/metrics')) return false;
  const [status, type, body] = monitoringResponse(pathname, stats);
  response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' }).end(body);
  return true;
}

/** Answers /health or /metrics on a raw connection (the balancer does not run an HTTP server). */
function answerRaw(socket, pathname, stats) {
  const [status, type, body] = monitoringResponse(pathname, stats);
  socket.end(`HTTP/1.1 ${status} ${status === 200 ? 'OK' : 'Service Unavailable'}\r\nContent-Type: ${type}\r\nCache-Control: no-store\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`);
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
