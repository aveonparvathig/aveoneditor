#!/usr/bin/env node
/**
 * Builds one release for every client, cloud and on-premises:
 *
 *   node scripts/release.mjs [--skip-build] [--skip-tests]
 *
 * release/<version>/
 *   editor/v<version>/                 files for the central host (or a client's own web server)
 *   editor/v<version>/integrity.json   SHA-384 of each file, for <script integrity="…">
 *   editor/v<version>/snippet.html     the two tags clients paste, with integrity attributes
 *   packages/*.tgz                     @aveon/editor, @aveon/collab-server, @aveon/api-connect, aveon-angular for npm registries
 *   angular-11-13/, angular-14-21/     forms support for the <aveon-editor> element in Angular 11–21
 *   aveon-offline-v<version>.zip       everything above plus deploy files, for air-gapped installs
 *   SHA256SUMS                         checksums of the archives
 */

import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync } from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const run = (command, cwd = root) => {
  console.log(`> ${command}`);
  execSync(command, { cwd, stdio: 'inherit' });
};

const version = JSON.parse(readFileSync(path.join(root, 'packages/aveon-editor/package.json'), 'utf8')).version;
const out = path.join(root, 'release', version);
const editorOut = path.join(out, 'editor', `v${version}`);

if (!args.includes('--skip-tests')) {
  run('npm test -w @aveon/editor');
  run('npm test -w @aveon/collab-server');
  run('npm test -w @aveon/api-connect');
}
if (!args.includes('--skip-build')) run('npm run build -w @aveon/editor');

rmSync(out, { recursive: true, force: true });
mkdirSync(editorOut, { recursive: true });

// 1. Editor files, without source maps (they expose the source and are not needed to run).
const standalone = path.join(root, 'packages/aveon-editor/dist/standalone');
if (!existsSync(standalone)) throw new Error('No standalone build: run without --skip-build.');
cpSync(standalone, editorOut, { recursive: true, filter: source => !source.endsWith('.map') });

const files = walk(editorOut).map(file => path.relative(editorOut, file).split(path.sep).join('/'));
const integrity = Object.fromEntries(files.map(file => [file, `sha384-${createHash('sha384').update(readFileSync(path.join(editorOut, file))).digest('base64')}`]));
writeFileSync(path.join(editorOut, 'integrity.json'), `${JSON.stringify({ version, files: integrity }, null, 2)}\n`);
writeFileSync(
  path.join(editorOut, 'snippet.html'),
  [
    `<!-- Aveon Editor ${version}: replace https://editor.example.com with your central host. -->`,
    `<link rel="stylesheet" href="https://editor.example.com/v${version}/aveon-editor.standalone.css" integrity="${integrity['aveon-editor.standalone.css']}" crossorigin="anonymous">`,
    `<script type="module" src="https://editor.example.com/v${version}/aveon-editor.standalone.js" integrity="${integrity['aveon-editor.standalone.js']}" crossorigin="anonymous"></script>`,
    ''
  ].join('\n')
);

// 2. npm packages for private registries (or `npm install ./file.tgz`).
const packagesOut = path.join(out, 'packages');
mkdirSync(packagesOut, { recursive: true });
for (const workspace of ['packages/aveon-editor', 'packages/collab-server', 'packages/api-connect']) {
  run(`npm pack --pack-destination "${packagesOut}"`, path.join(root, workspace));
}

// The Angular component (its workspace installs its own dependencies), and forms support for Angular 11–21.
const angularApp = path.join(root, 'apps/cms-angular');
if (existsSync(path.join(angularApp, 'node_modules'))) {
  if (!args.includes('--skip-build')) run('npx ng build aveon-angular', angularApp);
  run(`npm pack --pack-destination "${packagesOut}"`, path.join(angularApp, 'dist/aveon-angular'));
} else {
  console.warn('\n! aveon-angular left out: run `npm install` in apps/cms-angular first.\n');
}
const angularForms = ['angular-11-13', 'angular-14-21'];
for (const folder of angularForms) cpSync(path.join(root, 'docs', folder), path.join(out, folder), { recursive: true });

// 3. One archive for air-gapped clients: unzip, copy editor/ to a web server, install the servers.
const zipName = `aveon-offline-v${version}.zip`;
const entries = [
  ...walk(path.join(out, 'editor')).map(file => [`editor/${path.relative(path.join(out, 'editor'), file)}`, file]),
  ...walk(packagesOut).map(file => [`packages/${path.relative(packagesOut, file)}`, file]),
  ...angularForms.flatMap(folder => walk(path.join(out, folder)).map(file => [`${folder}/${path.relative(path.join(out, folder), file)}`, file])),
  ...['INTEGRATION_KIT.md', 'DEPLOYMENT.md'].map(file => [`docs/${file}`, path.join(root, 'docs', file)]),
  ...walk(path.join(root, 'deploy')).map(file => [`deploy/${path.relative(path.join(root, 'deploy'), file)}`, file]),
  ['README.md', path.join(root, 'README.md')]
].map(([name, file]) => [name.split(path.sep).join('/'), file]);
writeFileSync(path.join(out, zipName), zip(entries));

const sums = [zipName, ...readdirSync(packagesOut).map(file => `packages/${file}`)].map(file => `${createHash('sha256').update(readFileSync(path.join(out, file))).digest('hex')}  ${file}`);
writeFileSync(path.join(out, 'SHA256SUMS'), `${sums.join('\n')}\n`);

console.log(`\nRelease ${version} in ${path.relative(root, out)}:`);
for (const file of ['aveon-editor.standalone.js', 'aveon-editor.standalone.css']) console.log(`  ${file}  ${integrity[file]}`);
console.log(`  ${zipName}  ${(statSync(path.join(out, zipName)).size / 1e6).toFixed(1)} MB`);

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

/** A standard .zip (deflate), readable by Windows Explorer, macOS and `unzip`, without a dependency. */
function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, file] of entries) {
    const data = readFileSync(file);
    const packed = deflateRawSync(data, { level: 9 });
    const nameBytes = Buffer.from(name, 'utf8');
    const checksum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt32LE(0x00210000, 10); // 1 Jan 1980 (fixed, so the archive is reproducible)
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, packed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(0x00210000, 12);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + packed.length;
  }
  const centralSize = centrals.reduce((size, buffer) => size + buffer.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}
