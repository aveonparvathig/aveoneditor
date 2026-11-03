import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { generateKeyPairSync, sign } from 'node:crypto';
import { WebSocket } from 'ws';
import { createApiConnect, DiskStore, signJwt, verifyJwt, sanitizeDocument } from '../src/index.js';

const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
const now = () => Math.floor(Date.now() / 1000);
const token = (claims, secret = 'acme-secret') => signJwt({ tenant: 'acme', sub: 'u1', name: 'Asha', exp: now() + 300, ...claims }, secret);

let dir;
let api;
let base;

before(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'api-connect-'));
  mkdirSync(path.join(dir, 'editor', 'v0.1.0'), { recursive: true });
  writeFileSync(path.join(dir, 'editor', 'v0.1.0', 'aveon-editor.standalone.js'), 'export {};');
  writeFileSync(path.join(dir, 'secret.txt'), 'do not serve');
  api = createApiConnect({
    store: new DiskStore(path.join(dir, 'data')),
    editorDir: path.join(dir, 'editor'),
    tenants: {
      acme: { secret: 'acme-secret', origins: ['https://cms.acme.test'], templates: [{ title: 'Quote', data: '<p>Q</p>' }] },
      globex: { secret: 'globex-secret', origins: ['https://erp.globex.test'] }
    },
    mergeData: async ({ record }) => (record === 'c-1' ? { customer: { name: 'Northwind' } } : null),
    log: { error() {}, info() {} }
  });
  base = `http://127.0.0.1:${await api.listen(0, '127.0.0.1')}`;
});

after(async () => {
  await api.close();
  rmSync(dir, { recursive: true, force: true });
});

function uploadBody(data, filename = 'a.png', type = 'image/png') {
  const form = new FormData();
  form.append('upload', new Blob([data], { type }), filename);
  return form;
}

test('tokens: HS256, expiry, wrong key and "alg: none" are checked', () => {
  assert.equal(verifyJwt(token(), { secret: 'acme-secret' }).sub, 'u1');
  assert.throws(() => verifyJwt(token({ exp: now() - 120 }), { secret: 'acme-secret' }), /expired/);
  assert.throws(() => verifyJwt(token(), { secret: 'other' }), /signature/);
  const none = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: 'x', exp: now() + 60 })).toString('base64url')}.`;
  assert.throws(() => verifyJwt(none, { secret: 'acme-secret' }), /algorithm/);
  assert.throws(() => verifyJwt(signJwt({ sub: 'x' }, 's'), { secret: 's' }), /expiry/);
});

test('tokens: RS256 and ES256 with public keys', () => {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const claims = { sub: 'u2', exp: now() + 60, iss: 'https://erp.example' };
  const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const rsData = `${encode({ alg: 'RS256' })}.${encode(claims)}`;
  const rsToken = `${rsData}.${sign('sha256', Buffer.from(rsData), rsa.privateKey).toString('base64url')}`;
  assert.equal(verifyJwt(rsToken, { publicKey: rsa.publicKey.export({ type: 'spki', format: 'pem' }), issuer: 'https://erp.example' }).sub, 'u2');
  assert.throws(() => verifyJwt(rsToken, { publicKey: rsa.publicKey.export({ type: 'spki', format: 'pem' }), issuer: 'https://other' }), /issuer/);

  const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const esData = `${encode({ alg: 'ES256' })}.${encode(claims)}`;
  const esToken = `${esData}.${sign('sha256', Buffer.from(esData), { key: ec.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
  assert.equal(verifyJwt(esToken, { publicKey: ec.publicKey.export({ type: 'spki', format: 'pem' }) }).sub, 'u2');
  // An RSA token is not accepted by an EC key.
  assert.throws(() => verifyJwt(rsToken, { publicKey: ec.publicKey.export({ type: 'spki', format: 'pem' }) }), /algorithm/);
});

test('uploads: stored per tenant and served back with safe headers', async () => {
  const response = await fetch(`${base}/v1/uploads`, { method: 'POST', headers: { Authorization: `Bearer ${token()}` }, body: uploadBody(PNG) });
  assert.equal(response.status, 201);
  const { url } = await response.json();
  assert.match(url, /\/v1\/files\/acme\/\d{4}\/\d{2}\/[0-9a-f-]+\.png$/);
  const file = await fetch(url);
  assert.equal(file.status, 200);
  assert.equal(file.headers.get('content-type'), 'image/png');
  assert.equal(file.headers.get('x-content-type-options'), 'nosniff');
  assert.match(file.headers.get('content-security-policy'), /sandbox/);
  assert.deepEqual(Buffer.from(await file.arrayBuffer()), PNG);
});

test('uploads: refused without a token, for non-images and when too large', async () => {
  let response = await fetch(`${base}/v1/uploads`, { method: 'POST', body: uploadBody(PNG) });
  assert.equal(response.status, 401);
  assert.match((await response.json()).error.message, /Sign-in/);

  // An HTML page that claims to be a PNG.
  response = await fetch(`${base}/v1/uploads`, { method: 'POST', headers: { Authorization: `Bearer ${token()}` }, body: uploadBody(Buffer.from('<script>alert(1)</script>'), 'x.png') });
  assert.equal(response.status, 415);

  const small = createApiConnect({ store: new DiskStore(path.join(dir, 'small')), tenants: { acme: { secret: 'acme-secret' } }, maxUploadBytes: 16, collaboration: false, log: { error() {} } });
  const smallBase = `http://127.0.0.1:${await small.listen(0, '127.0.0.1')}`;
  response = await fetch(`${smallBase}/v1/uploads`, { method: 'POST', headers: { Authorization: `Bearer ${token()}` }, body: uploadBody(Buffer.concat([PNG, Buffer.alloc(64)])) });
  assert.equal(response.status, 413);
  await small.close();
});

test('documents: saved sanitised, readable only by the same tenant and allowed users', async () => {
  const html = '<p onclick="steal()">Hi <a href="javascript:alert(1)">x</a><img src="x" onerror="alert(1)"></p><script>alert(1)</script><span class="merge-field" data-field="customer.name">{{customer.name}}</span><p style="color: red; position: fixed">c</p>';
  let response = await fetch(`${base}/v1/documents/quote-42`, { method: 'PUT', headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ html }) });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).changed, true);

  response = await fetch(`${base}/v1/documents/quote-42`, { headers: { Authorization: `Bearer ${token()}` } });
  const saved = (await response.json()).html;
  assert.doesNotMatch(saved, /onclick|onerror|javascript:|<script|position/);
  assert.match(saved, /data-field="customer.name"/);
  assert.match(saved, /color:red/);

  // Another client cannot read it, even with the same id.
  response = await fetch(`${base}/v1/documents/quote-42`, { headers: { Authorization: `Bearer ${signJwt({ tenant: 'globex', sub: 'g1', exp: now() + 60 }, 'globex-secret')}` } });
  assert.equal(response.status, 404);

  // A token limited to other documents.
  response = await fetch(`${base}/v1/documents/quote-42`, { headers: { Authorization: `Bearer ${token({ docs: ['invoice-*'] })}` } });
  assert.equal(response.status, 403);
  response = await fetch(`${base}/v1/documents/quote-42`, { headers: { Authorization: `Bearer ${token({ docs: ['quote-*'] })}` } });
  assert.equal(response.status, 200);
});

test('a token signed for one tenant cannot claim another', async () => {
  const forged = signJwt({ tenant: 'globex', sub: 'u1', exp: now() + 60 }, 'acme-secret');
  const response = await fetch(`${base}/v1/templates`, { headers: { Authorization: `Bearer ${forged}` } });
  assert.equal(response.status, 401);
});

test('CORS: only the tenant\'s own pages may call with its tokens', async () => {
  let response = await fetch(`${base}/v1/uploads`, { method: 'OPTIONS', headers: { Origin: 'https://cms.acme.test', 'Access-Control-Request-Method': 'POST' } });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://cms.acme.test');
  response = await fetch(`${base}/v1/uploads`, { method: 'OPTIONS', headers: { Origin: 'https://evil.test' } });
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  response = await fetch(`${base}/v1/templates`, { headers: { Origin: 'https://erp.globex.test', Authorization: `Bearer ${token()}` } });
  assert.equal(response.status, 403);
  response = await fetch(`${base}/v1/templates`, { headers: { Origin: 'https://cms.acme.test', Authorization: `Bearer ${token()}` } });
  assert.deepEqual(await response.json(), [{ title: 'Quote', data: '<p>Q</p>' }]);
});

test('merge data comes from the host application', async () => {
  let response = await fetch(`${base}/v1/merge-data/c-1`, { headers: { Authorization: `Bearer ${token()}` } });
  assert.deepEqual(await response.json(), { customer: { name: 'Northwind' } });
  response = await fetch(`${base}/v1/merge-data/c-2`, { headers: { Authorization: `Bearer ${token()}` } });
  assert.equal(response.status, 404);
});

test('editor files: versioned, cacheable, CORS-enabled, nothing outside the folder', async () => {
  let response = await fetch(`${base}/editor/v0.1.0/aveon-editor.standalone.js`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /javascript/);
  assert.match(response.headers.get('cache-control'), /immutable/);
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
  response = await fetch(`${base}/editor/..%2Fsecret.txt`);
  assert.equal(response.status, 404);
});

test('co-editing socket: tenant tokens, document ids prefixed by tenant', async () => {
  const join = (documentId, jwt) =>
    new Promise(resolve => {
      const socket = new WebSocket(`${base.replace('http', 'ws')}/v1/collab?doc=${documentId}`);
      socket.on('open', () => socket.send(JSON.stringify({ type: 'join', documentId, token: jwt, initialData: '<p>x</p>' })));
      socket.on('message', raw => {
        const message = JSON.parse(String(raw));
        if (message.type === 'joined' || message.type === 'error') {
          socket.close();
          resolve(message.type);
        }
      });
    });
  assert.equal(await join('acme:quote-42', token()), 'joined');
  assert.equal(await join('globex:quote-42', token()), 'error');
  assert.equal(await join('acme:quote-42', 'not-a-token'), 'error');
});

test('sanitiser keeps what the editor produces', () => {
  const html =
    '<h2 id="intro">Intro</h2><figure class="table"><table><tbody><tr><td colspan="2">a</td></tr></tbody></table></figure>' +
    '<ul class="todo-list"><li><label class="todo-list__label"><input type="checkbox" disabled checked><span>Done</span></label></li></ul>' +
    '<span class="math-tex">\\(x^2\\)</span><ins class="suggestion-insert" data-author="u1">new</ins>' +
    '<figure class="sketch"><svg viewBox="0 0 10 10"><path d="M0 0L5 5" stroke="#000" fill="none"></path></svg></figure>';
  // Same markup; void elements come back self-closed.
  assert.equal(sanitizeDocument(html), html.replace('checked>', 'checked />'));
  assert.equal(sanitizeDocument('<input type="text" value="x">'), '');
});
