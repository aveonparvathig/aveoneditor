#!/usr/bin/env node
/**
 * Runs API Connect from a JSON configuration file:  aveon-api-connect --config api-connect.config.json
 *
 *   {
 *     "port": 8080,
 *     "dataDir": "./api-data",
 *     "publicUrl": "https://api.example.com",
 *     "editorDir": "./release/editor",
 *     "maxUploadBytes": 10485760,
 *     "collaboration": { "dataDir": "./collab-data" },
 *     "tenants": {
 *       "acme":   { "secretEnv": "ACME_JWT_SECRET", "origins": ["https://cms.acme.com"] },
 *       "globex": { "publicKeyFile": "./keys/globex.pem", "issuer": "https://erp.globex.com", "origins": ["https://erp.globex.com"] }
 *     }
 *   }
 *
 * Secrets are read from environment variables (`secretEnv`) or key files, never written in the file.
 * `"collaboration": false` turns the co-editing socket off; `--port` overrides the port.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { FileStorage } from '@aveon/collab-server';
import { createApiConnect, DiskStore } from '../src/index.js';

const args = process.argv.slice(2);
const option = name => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? undefined : args[index + 1];
};

if (args.includes('--help') || !option('config')) {
  console.log('Usage: aveon-api-connect --config api-connect.config.json [--port 8080]');
  process.exit(args.includes('--help') ? 0 : 1);
}

const configFile = path.resolve(option('config'));
const configDir = path.dirname(configFile);
const config = JSON.parse(readFileSync(configFile, 'utf8'));
const resolve = file => path.resolve(configDir, file);

const tenants = {};
for (const [id, tenant] of Object.entries(config.tenants || {})) {
  const { secretEnv, publicKeyFile, ...rest } = tenant;
  const secret = secretEnv ? process.env[secretEnv] : tenant.secret;
  const publicKey = publicKeyFile ? readFileSync(resolve(publicKeyFile), 'utf8') : tenant.publicKey;
  if (!secret && !publicKey) {
    console.error(`aveon-api-connect: tenant "${id}" has no key (set ${secretEnv ? `the ${secretEnv} environment variable` : '"secretEnv" or "publicKeyFile"'}).`);
    process.exit(1);
  }
  tenants[id] = { ...rest, secret, publicKey };
}

const collaboration =
  config.collaboration === false
    ? false
    : { ...(config.collaboration || {}), storage: config.collaboration?.dataDir ? new FileStorage(resolve(config.collaboration.dataDir)) : undefined };
if (collaboration && !collaboration.storage) delete collaboration.storage;

const api = createApiConnect({
  tenants,
  store: new DiskStore(resolve(config.dataDir || './api-data')),
  publicUrl: config.publicUrl,
  editorDir: config.editorDir ? resolve(config.editorDir) : undefined,
  maxUploadBytes: config.maxUploadBytes,
  collaboration
});

const port = await api.listen(Number(option('port') || process.env.PORT || config.port || 8080), config.host);
console.log(`Aveon API Connect listening on http://localhost:${port} (${Object.keys(tenants).length} client${Object.keys(tenants).length === 1 ? '' : 's'}${collaboration ? ', co-editing at /v1/collab' : ''})`);

const stop = async () => {
  await api.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
