#!/usr/bin/env node
/**
 * Runs the collaboration server:  aveon-collab --port 1234 --data ./collab-data
 * Without --data, documents are kept in memory only.
 */

import { createCollaborationServer, FileStorage, MemoryStorage } from '../src/server.js';

const args = process.argv.slice(2);
const option = name => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? undefined : args[index + 1];
};

if (args.includes('--help')) {
  console.log('Usage: aveon-collab [--port 1234] [--data ./collab-data]');
  process.exit(0);
}

const port = Number(option('port') || process.env.PORT || 1234);
const dataDir = option('data') || process.env.AVEON_COLLAB_DATA;
const server = createCollaborationServer({ port, storage: dataDir ? new FileStorage(dataDir) : new MemoryStorage() });
await server.ready();
console.log(`Aveon collaboration server listening on ws://localhost:${server.port}${dataDir ? ` (documents in ${dataDir})` : ' (in memory)'}`);

const stop = async () => {
  await server.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
