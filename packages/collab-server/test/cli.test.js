import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { WebSocket } from 'ws';

const bin = path.join(path.dirname(fileURLToPath(import.meta.url)), '../bin/aveon-collab.js');

/** Starts `aveon-collab` on a free-ish port and resolves once it listens. */
function startServer(extraArgs) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, [bin, '--port', String(port), ...extraArgs], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  return new Promise((resolve, reject) => {
    const onData = chunk => {
      output += chunk;
      if (output.includes('listening')) resolve({ child, port, url: `http://127.0.0.1:${port}`, output: () => output });
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', chunk => (output += chunk));
    child.on('exit', code => reject(new Error(`server exited (${code}): ${output}`)));
  });
}

function stop(server) {
  return new Promise(resolve => {
    server.child.removeAllListeners('exit');
    server.child.once('exit', resolve);
    server.child.kill();
  });
}

const until = async (check, timeout = 10000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await check();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('timed out');
};

function joinDocument(url, documentId) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${url.replace('http', 'ws')}/?doc=${documentId}`);
    socket.on('error', reject);
    socket.on('open', () => socket.send(JSON.stringify({ type: 'join', documentId, initialData: '<p>a</p>' })));
    socket.on('message', raw => JSON.parse(String(raw)).type === 'joined' && resolve(socket));
  });
}

test('one process: /health and /metrics next to the WebSocket', async () => {
  const server = await startServer([]);
  try {
    const socket = await joinDocument(server.url, 'acme:doc-1');
    const health = await (await fetch(`${server.url}/health`)).json();
    assert.equal(health.status, 'ok');
    assert.equal(health.connections, 1);
    assert.equal(health.documents, 1);
    const metrics = await (await fetch(`${server.url}/metrics`)).text();
    assert.match(metrics, /^aveon_collab_connections 1$/m);
    assert.match(metrics, /# TYPE aveon_collab_operations_total counter/);
    socket.close();
  } finally {
    await stop(server);
  }
});

test('several processes: a stopped process is started again and keeps serving its documents', async () => {
  const server = await startServer(['--workers', '2']);
  try {
    let health = await until(async () => {
      const body = await (await fetch(`${server.url}/health`)).json();
      return body.processes.every(entry => entry.pid) && body;
    });
    assert.equal(health.workersUp, 2);

    // A crash: SIGKILL, because the processes ignore SIGTERM (stopping is coordinated by the primary).
    process.kill(health.processes.at(0).pid, 'SIGKILL');
    health = await until(async () => {
      const response = await fetch(`${server.url}/health`);
      const body = await response.json();
      return response.status === 200 && body.processes.at(0).pid !== health.processes.at(0).pid && body;
    });
    assert.equal(health.status, 'ok');
    const metrics = await (await fetch(`${server.url}/metrics`)).text();
    assert.match(metrics, /^aveon_collab_worker_restarts_total 1$/m);

    // Documents on either process can be opened.
    const sockets = await Promise.all(['acme:a', 'acme:b', 'acme:c', 'acme:d'].map(id => joinDocument(server.url, id)));
    sockets.forEach(socket => socket.close());
  } finally {
    await stop(server);
  }
});
