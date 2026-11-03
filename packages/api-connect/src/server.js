/**
 * Aveon API Connect: the one backend contract every client's editor talks to, in the cloud or on
 * premises. It checks each client's (tenant's) tokens, stores uploaded images and documents per
 * tenant, can serve the editor files, and can host the collaboration WebSocket on the same port.
 *
 *   import { createApiConnect, DiskStore } from '@aveon/api-connect';
 *   const api = createApiConnect({
 *     store: new DiskStore('./api-data'),
 *     tenants: {
 *       acme: { secret: process.env.ACME_JWT_SECRET, origins: ['https://cms.acme.com'] },
 *       globex: { publicKey: fs.readFileSync('globex.pem', 'utf8'), issuer: 'https://erp.globex.com', origins: ['https://erp.globex.com'] }
 *     },
 *     editorDir: './release/editor',  // serves /editor/v0.1.0/aveon-editor.standalone.js
 *     collaboration: {}                // wss://host/v1/collab
 *   });
 *   await api.listen(8080);
 *
 * Tokens are JWTs signed by each client's backend with `tenant`, `sub` (user id), `name`, `exp` and,
 * optionally, `docs` (document ids the user may open; a trailing `*` matches a prefix).
 */

import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createCollaborationServer, MemoryStorage } from '@aveon/collab-server';
import { verifyJwt, peekClaims, TokenError } from './jwt.js';
import { readBody, parseMultipartFile, sniffImageType, BodyError } from './multipart.js';
import { sanitizeDocument } from './sanitize.js';

const DOCUMENT_ID = /^[\w.:-]{1,128}$/;
const EXTENSIONS = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/avif': 'avif' };
const STATIC_TYPES = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.map': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.html': 'text/html; charset=utf-8' };

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * Options: `tenants` (id → `{ secret | publicKey, issuer?, audience?, origins?, templates? }`),
 * `store` (a `DiskStore` or compatible object), `publicUrl` (base of file links; default from the
 * request), `maxUploadBytes` (default 10 MB), `uploadTypes` (default PNG, JPEG, GIF, WebP),
 * `editorDir` (folder with `v<version>/` editor releases, served at `/editor/`), `collaboration`
 * (collaboration server options, or false), `mergeData({ tenant, record, user })`,
 * `onDocumentSaved({ tenant, id, html, user })` and `log` (default console).
 */
export function createApiConnect(options = {}) {
  const tenants = options.tenants || {};
  const store = options.store;
  if (!store) throw new Error('api-connect: a `store` is required (e.g. new DiskStore("./api-data")).');
  const maxUploadBytes = options.maxUploadBytes ?? 10 * 1024 * 1024;
  const uploadTypes = options.uploadTypes ?? ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
  const log = options.log ?? console;
  const allOrigins = new Set(Object.values(tenants).flatMap(tenant => tenant.origins || []));

  /** The caller from its bearer token: `{ tenant, user, claims }`. */
  function authenticate(token) {
    if (!token) throw new HttpError(401, 'Sign-in required.');
    try {
      const tenantId = peekClaims(token).tenant;
      const tenant = typeof tenantId === 'string' && Object.hasOwn(tenants, tenantId) ? tenants[tenantId] : null;
      if (!tenant) throw new TokenError('Unknown tenant.');
      const claims = verifyJwt(token, tenant);
      if (!claims.sub) throw new TokenError('Token has no user.');
      return { tenant: tenantId, user: { id: String(claims.sub), name: String(claims.name || claims.sub) }, claims };
    } catch (error) {
      if (error instanceof TokenError) throw new HttpError(401, error.message);
      throw error;
    }
  }

  function canOpen(caller, documentId) {
    const allowed = caller.claims.docs;
    if (!Array.isArray(allowed)) return true;
    return allowed.some(pattern => (String(pattern).endsWith('*') ? documentId.startsWith(String(pattern).slice(0, -1)) : pattern === documentId));
  }

  function bearer(request) {
    const match = /^Bearer\s+(.+)$/i.exec(request.headers.authorization || '');
    return match ? match[1].trim() : null;
  }

  function publicBase(request) {
    if (options.publicUrl) return options.publicUrl.replace(/\/$/, '');
    const proto = String(request.headers['x-forwarded-proto'] || (request.socket.encrypted ? 'https' : 'http')).split(',')[0].trim();
    const host = String(request.headers['x-forwarded-host'] || request.headers.host || 'localhost').split(',')[0].trim();
    return `${proto}://${host}`;
  }

  function setCors(request, response, caller) {
    const origin = request.headers.origin;
    if (!origin) return;
    // Before sign-in (preflight) any client's origin is answered; afterwards only the caller's own.
    const allowed = caller ? (tenants[caller.tenant].origins || []).includes(origin) : allOrigins.has(origin);
    if (!allowed) return;
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
    response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
    response.setHeader('Access-Control-Max-Age', '600');
  }

  function sendJson(response, status, body) {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(body));
  }

  async function handle(request, response) {
    const url = new URL(request.url, 'http://localhost');
    const route = url.pathname;
    let caller = null;
    try {
      setCors(request, response, null);
      if (request.method === 'OPTIONS') {
        response.writeHead(204);
        return response.end();
      }
      if (route === '/health') return sendJson(response, 200, { status: 'ok' });
      if (route.startsWith('/editor/') && request.method === 'GET') return await serveEditorFile(route.slice('/editor/'.length), response);
      if (route.startsWith('/v1/files/') && request.method === 'GET') return await serveUpload(route.slice('/v1/files/'.length), response);

      if (!route.startsWith('/v1/')) throw new HttpError(404, 'Not found.');
      caller = authenticate(bearer(request));
      // The token decides the tenant; a page of another client must not use it.
      response.removeHeader('Access-Control-Allow-Origin');
      setCors(request, response, caller);
      if (request.headers.origin && tenants[caller.tenant].origins && !tenants[caller.tenant].origins.includes(request.headers.origin)) {
        throw new HttpError(403, 'This page is not allowed to use this client account.');
      }

      if (route === '/v1/uploads' && request.method === 'POST') return await upload(request, response, caller);
      if (route === '/v1/templates' && request.method === 'GET') return sendJson(response, 200, tenants[caller.tenant].templates || []);
      const mergeMatch = /^\/v1\/merge-data\/([^/]+)$/.exec(route);
      if (mergeMatch && request.method === 'GET') {
        const data = options.mergeData ? await options.mergeData({ tenant: caller.tenant, record: decodeURIComponent(mergeMatch[1]), user: caller.user }) : null;
        if (!data) throw new HttpError(404, 'No such record.');
        return sendJson(response, 200, data);
      }
      const documentMatch = /^\/v1\/documents\/([^/]+)$/.exec(route);
      if (documentMatch) {
        const id = decodeURIComponent(documentMatch[1]);
        if (!DOCUMENT_ID.test(id)) throw new HttpError(400, 'Invalid document id.');
        if (!canOpen(caller, id)) throw new HttpError(403, 'Not allowed to open this document.');
        if (request.method === 'GET') {
          const record = await store.loadDocument(caller.tenant, id);
          if (!record) throw new HttpError(404, 'No such document.');
          return sendJson(response, 200, { id, ...record });
        }
        if (request.method === 'PUT') return await saveDocument(request, response, caller, id);
      }
      throw new HttpError(404, 'Not found.');
    } catch (error) {
      const status = error instanceof HttpError || error instanceof BodyError ? error.status : 500;
      if (status === 500) log.error('api-connect:', error);
      if (!response.headersSent) sendJson(response, status, { error: { message: status === 500 ? 'Server error.' : error.message } });
      else response.end();
    }
  }

  async function upload(request, response, caller) {
    // Room for the multipart envelope around the file.
    const body = await readBody(request, maxUploadBytes + 64 * 1024);
    const file = parseMultipartFile(body, request.headers['content-type'], options.uploadField || 'upload');
    if (!file || !file.data.length) throw new HttpError(400, 'No file in the "upload" field.');
    if (file.data.length > maxUploadBytes) throw new HttpError(413, 'File too large.');
    // What the bytes are, not what the browser says they are.
    const type = sniffImageType(file.data);
    if (!type || !uploadTypes.includes(type)) throw new HttpError(415, 'Only images can be uploaded (PNG, JPEG, GIF, WebP).');
    const now = new Date();
    const key = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}.${EXTENSIONS[type]}`;
    await store.saveFile(caller.tenant, key, file.data, type);
    log.info?.(`api-connect: ${caller.tenant}/${caller.user.id} uploaded ${key} (${file.data.length} bytes)`);
    sendJson(response, 201, { url: `${publicBase(request)}/v1/files/${encodeURIComponent(caller.tenant)}/${key}` });
  }

  async function saveDocument(request, response, caller, id) {
    const body = (await readBody(request, options.maxDocumentBytes ?? 20 * 1024 * 1024)).toString('utf8');
    let html = body;
    if (/application\/json/i.test(request.headers['content-type'] || '')) {
      try {
        html = JSON.parse(body).html;
      } catch {
        throw new HttpError(400, 'Invalid JSON.');
      }
    }
    if (typeof html !== 'string') throw new HttpError(400, 'Send the document as { "html": "…" } or text/html.');
    const clean = sanitizeDocument(html);
    const record = { html: clean, savedAt: new Date().toISOString(), savedBy: caller.user };
    await store.saveDocument(caller.tenant, id, record);
    await options.onDocumentSaved?.({ tenant: caller.tenant, id, html: clean, user: caller.user });
    sendJson(response, 200, { id, savedAt: record.savedAt, changed: clean !== html });
  }

  async function serveUpload(rest, response) {
    const [tenant, ...keyParts] = rest.split('/');
    const found = keyParts.length ? await store.readFile(decodeURIComponent(tenant), keyParts.join('/')) : null;
    if (!found) throw new HttpError(404, 'Not found.');
    response.writeHead(200, {
      'Content-Type': found.contentType,
      'Content-Length': found.data.length,
      // Keys are random and files never change.
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Access-Control-Allow-Origin': '*',
      'Cross-Origin-Resource-Policy': 'cross-origin'
    });
    response.end(found.data);
  }

  async function serveEditorFile(rest, response) {
    if (!options.editorDir) throw new HttpError(404, 'Not found.');
    const root = path.resolve(options.editorDir);
    const file = path.resolve(root, decodeURIComponent(rest));
    if (!file.startsWith(root + path.sep) || file.endsWith('.map')) throw new HttpError(404, 'Not found.');
    let data;
    try {
      data = await fs.readFile(file);
    } catch {
      throw new HttpError(404, 'Not found.');
    }
    const versioned = /^v\d+\.\d+\.\d+[^/]*\//.test(rest);
    response.writeHead(200, {
      'Content-Type': STATIC_TYPES[path.extname(file)] || 'application/octet-stream',
      'Content-Length': data.length,
      // A version folder never changes; anything else (e.g. a "latest" alias) is checked again.
      'Cache-Control': versioned ? 'public, max-age=31536000, immutable' : 'public, max-age=300',
      // Module scripts and their lazily loaded chunks are fetched with CORS.
      'Access-Control-Allow-Origin': '*',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'X-Content-Type-Options': 'nosniff'
    });
    response.end(data);
  }

  const server = options.server || http.createServer();
  server.on('request', (request, response) => void handle(request, response));

  let collaboration = null;
  if (options.collaboration !== false) {
    const collabOptions = options.collaboration || {};
    collaboration = createCollaborationServer({
      storage: new MemoryStorage(),
      ...collabOptions,
      server,
      path: collabOptions.path || '/v1/collab',
      // Same tokens as the HTTP API; a document belongs to the tenant named before its first ":".
      authenticate: async ({ token, documentId }) => {
        let caller;
        try {
          caller = authenticate(token);
        } catch {
          return null;
        }
        if (!documentId.startsWith(`${caller.tenant}:`) || !canOpen(caller, documentId.slice(caller.tenant.length + 1))) return null;
        return caller.user;
      },
      onSnapshot: async snapshot => {
        // The latest co-edited copy is saved like any other document save.
        const [tenant, ...rest] = snapshot.documentId.split(':');
        if (options.saveSnapshots !== false && Object.hasOwn(tenants, tenant)) {
          const html = sanitizeDocument(snapshot.data);
          await store.saveDocument(tenant, rest.join(':'), { html, savedAt: new Date().toISOString(), savedBy: { id: 'collaboration', name: 'Co-editing' }, version: snapshot.version });
          await options.onDocumentSaved?.({ tenant, id: rest.join(':'), html, user: null });
        }
        await collabOptions.onSnapshot?.(snapshot);
      }
    });
  }

  return {
    server,
    collaboration,
    /** The request handler, for mounting inside an existing Node server or Express app. */
    handle,
    listen(port = 8080, host) {
      return new Promise(resolve => server.listen(port, host, () => resolve(server.address().port)));
    },
    async close() {
      if (collaboration) await collaboration.close();
      await new Promise(resolve => server.close(() => resolve()));
    }
  };
}
