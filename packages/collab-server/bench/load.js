#!/usr/bin/env node
/**
 * Load test for the collaboration server: many simulated users editing at the same time.
 *
 *   node bench/load.js --users 3000 --docs 300 --active 0.3 --rate 2 --duration 30
 *
 * --users     simulated people connected at once
 * --docs      documents they are spread over (users / docs people per document)
 * --active    share of people typing at any moment (the rest read, cursor still moving)
 * --rate      edits per second sent by a typing person (the editor batches keystrokes, so
 *             2 messages/s ≈ fast typing)
 * --duration  seconds of measurement after everyone has joined
 * --workers   processes simulating the users (default 4)
 * --url       an already running server (otherwise one is started with --stats)
 * --server-workers  processes for the started server (its --workers; default 1)
 *
 * Reports how long an edit takes to be accepted by the server (round trip, including retries
 * when someone else's edit came first) and to reach the other people in the document, plus the
 * server's CPU and memory.
 */

import { fork, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { WebSocket } from 'ws';

const here = path.dirname(fileURLToPath(import.meta.url));
// A typical document of a few pages (~6 KB of HTML).
const SNAPSHOT = '<p>' + 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(100) + '</p>';
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
};

if (process.env.AVEON_LOAD_WORKER) {
  runWorker(JSON.parse(process.env.AVEON_LOAD_WORKER));
} else {
  await runMain();
}

/* ------------------------------------------------------------------------------------------ */

async function runMain() {
  const users = Number(option('users', 1000));
  const docs = Number(option('docs', 100));
  const active = Number(option('active', 0.3));
  const rate = Number(option('rate', 2));
  const duration = Number(option('duration', 30));
  const workers = Number(option('workers', 4));
  const serverWorkers = Number(option('server-workers', 1));
  let url = option('url');
  let serverProcess = null;
  const serverStats = [];

  if (!url) {
    const port = 4300 + Math.floor(Math.random() * 600);
    url = `ws://127.0.0.1:${port}`;
    serverProcess = spawn(process.execPath, ['--max-old-space-size=4096', path.join(here, '../bin/aveon-collab.js'), '--port', String(port), '--workers', String(serverWorkers), '--stats'], { stdio: ['ignore', 'pipe', 'inherit'] });
    await new Promise(resolve => {
      serverProcess.stdout.on('data', chunk => {
        for (const line of String(chunk).split('\n')) {
          if (line.includes('listening')) resolve();
          const match = /stats cpu=(\d+)% rss=(\d+)MB heap=(\d+)MB connections=(\d+)/.exec(line);
          if (match) serverStats.push({ cpu: +match[1], rss: +match[2], heap: +match[3], connections: +match[4], at: Date.now() });
        }
      });
    });
  }

  console.log(`Load test: ${users} users, ${docs} documents (${Math.round(users / docs)} per document), ${Math.round(active * 100)}% typing at ${rate} edits/s, ${duration}s, ${serverWorkers} server process(es)`);
  const totals = { acks: [], deliveries: [], sent: 0, rejected: 0, received: 0, errors: 0, connected: 0 };
  const children = [];
  const joinFailures = new Map();
  let measuring = false;
  for (let w = 0; w < workers; w++) {
    const count = Math.floor(users / workers) + (w < users % workers ? 1 : 0);
    const child = fork(fileURLToPath(import.meta.url), [], { env: { ...process.env, AVEON_LOAD_WORKER: JSON.stringify({ url, count, offset: w * Math.ceil(users / workers), docs, active, rate }) } });
    child.on('message', message => {
      if (message.type === 'connected') totals.connected += message.count;
      if (message.type === 'join-failed') joinFailures.set(message.reason, (joinFailures.get(message.reason) || 0) + 1);
      if (message.type === 'metrics' && measuring) {
        totals.acks.push(...message.acks);
        totals.deliveries.push(...message.deliveries);
        totals.sent += message.sent;
        totals.rejected += message.rejected;
        totals.received += message.received;
        totals.errors += message.errors;
      }
    });
    children.push(child);
  }

  // Everyone joins, then a short warm-up, then the measured period.
  const joinStart = Date.now();
  while (totals.connected < users && Date.now() - joinStart < 120000) await sleep(200);
  console.log(`${totals.connected}/${users} joined in ${((Date.now() - joinStart) / 1000).toFixed(1)}s`);
  await sleep(3000);
  measuring = true;
  const statsFrom = Date.now();
  for (const child of children) child.send({ type: 'reset' });
  await sleep(duration * 1000);
  measuring = false;
  for (const child of children) child.send({ type: 'flush' });
  measuring = true;
  await sleep(1500);
  measuring = false;

  const measured = serverStats.filter(stat => stat.at >= statsFrom);
  const pct = (values, p) => {
    if (!values.length) return NaN;
    const sorted = values.slice().sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
  };
  const average = values => values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
  console.log('');
  console.log(`Edits accepted:     ${totals.acks.length} (${(totals.acks.length / duration).toFixed(0)}/s), retried after a conflict: ${totals.rejected}`);
  console.log(`Edit confirmed in:  p50 ${pct(totals.acks, 50)} ms · p95 ${pct(totals.acks, 95)} ms · p99 ${pct(totals.acks, 99)} ms`);
  console.log(`Seen by others in:  p50 ${pct(totals.deliveries, 50)} ms · p95 ${pct(totals.deliveries, 95)} ms · p99 ${pct(totals.deliveries, 99)} ms (${totals.received} deliveries)`);
  if (measured.length) {
    console.log(`Server:             CPU avg ${average(measured.map(s => s.cpu)).toFixed(0)}% / max ${Math.max(...measured.map(s => s.cpu))}% of one core (summed over server processes) · memory ${Math.max(...measured.map(s => s.rss))} MB`);
  }
  console.log(`Errors: ${totals.errors}${joinFailures.size ? ` · could not join: ${[...joinFailures].map(([reason, count]) => `${count}× ${reason}`).join(', ')}` : ''}`);

  for (const child of children) child.kill();
  if (serverProcess) serverProcess.kill();
  process.exit(0);
}

/* ------------------------------------------------------------------------------------------ */

function runWorker({ url, count, offset, docs, active, rate }) {
  let acks = [];
  let deliveries = [];
  let sent = 0;
  let rejected = 0;
  let received = 0;
  let errors = 0;
  let connected = 0;

  const report = () => {
    process.send({ type: 'metrics', acks, deliveries, sent, rejected, received, errors });
    acks = [];
    deliveries = [];
    sent = rejected = received = errors = 0;
  };
  process.on('message', message => {
    if (message.type === 'reset') {
      acks = [];
      deliveries = [];
      sent = rejected = received = errors = 0;
    }
    if (message.type === 'flush') report();
  });
  setInterval(report, 2000);

  const start = index => {
    const id = offset + index;
    const documentId = `load-doc-${id % docs}`;
    const typing = Math.random() < active;
    const user = { socket: new WebSocket(`${url}/?doc=${documentId}`), version: 0, inflight: null, firstSent: 0, ready: false };
    user.socket.on('open', () => user.socket.send(JSON.stringify({ type: 'join', documentId, user: { id: `u${id}`, name: `User ${id}` }, initialData: '<p>Hello</p>' })));
    user.socket.on('error', error => {
      errors++;
      if (!user.ready) process.send({ type: 'join-failed', reason: error.code || error.message });
    });
    user.socket.on('close', code => !user.ready && process.send({ type: 'join-failed', reason: `closed ${code}` }));
    user.socket.on('message', raw => {
      const message = JSON.parse(String(raw));
      if (message.type === 'joined') {
        user.version = message.version;
        user.ready = true;
        connected++;
        process.send({ type: 'connected', count: 1 });
      } else if (message.type === 'ack') {
        user.version = message.version;
        if (user.inflight) acks.push(Date.now() - user.firstSent);
        user.inflight = null;
      } else if (message.type === 'ops') {
        if (message.fromVersion === user.version) user.version += message.ops.length;
        else if (message.fromVersion + message.ops.length > user.version) user.version = message.fromVersion + message.ops.length;
        const now = Date.now();
        for (const op of message.ops) if (op.t) deliveries.push(now - op.t);
        received += message.ops.length;
      } else if (message.type === 'reject') {
        rejected++;
        user.version = message.fromVersion + message.ops.length;
        // Rebase is the client's job; here the same edit is simply sent again on the new version.
        if (user.inflight) sendEdit(user, true);
      }
    });
    if (typing) {
      const interval = 1000 / rate;
      setTimeout(() => setInterval(() => user.ready && !user.inflight && sendEdit(user, false), interval), Math.random() * interval);
      // Like the editor after a pause in typing: the current HTML, so the server can drop old operations.
      setTimeout(() => setInterval(() => user.ready && user.socket.send(JSON.stringify({ type: 'snapshot', version: user.version, data: SNAPSHOT })), 5000), Math.random() * 5000);
    }
    // Everyone's cursor moves now and then (reading, clicking).
    setTimeout(() => setInterval(() => user.ready && user.socket.send(JSON.stringify({ type: 'presence', selection: { anchor: { root: 'main', path: [0, Math.floor(Math.random() * 5)] }, focus: { root: 'main', path: [0, 1] } } })), typing ? 500 : 3000), Math.random() * 3000);
  };

  function sendEdit(user, retry) {
    if (!retry) user.firstSent = Date.now();
    user.inflight = true;
    sent++;
    user.socket.send(JSON.stringify({ type: 'ops', version: user.version, ops: [{ __className: 'InsertOperation', baseVersion: 0, position: { root: 'main', path: [0, 0] }, nodes: [{ data: 'x' }], shouldReceiveAttributes: true, t: Date.now() }] }));
  }

  // Connect gradually (like people opening the page), ~400 per second per worker.
  let index = 0;
  const timer = setInterval(() => {
    for (let i = 0; i < 20 && index < count; i++) start(index++);
    if (index >= count) clearInterval(timer);
  }, 50);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
