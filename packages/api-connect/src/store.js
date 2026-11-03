/**
 * Where API Connect keeps uploaded files and saved documents. `DiskStore` keeps them in a folder,
 * one sub-folder per tenant; any object with the same four methods can replace it (S3, Azure Blob,
 * a database), so cloud and on-premises installs differ only in configuration.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

// Letters, digits, `_ . -` and `%` (document ids are URI-encoded: `:` is not allowed in Windows file names).
const SAFE_SEGMENT = /^[\w.%-]{1,200}$/;

function safeJoin(root, ...segments) {
  for (const segment of segments) {
    for (const part of String(segment).split('/')) {
      if (!SAFE_SEGMENT.test(part) || part === '.' || part === '..') throw new Error(`Unsafe path segment: ${part}`);
    }
  }
  return path.join(root, ...segments.flatMap(segment => String(segment).split('/')));
}

export class DiskStore {
  constructor(directory) {
    this.directory = directory;
  }

  /** Stores an uploaded file under `<tenant>/files/<key>`. */
  async saveFile(tenant, key, data, contentType) {
    const file = safeJoin(this.directory, tenant, 'files', key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, data);
    await fs.writeFile(`${file}.type`, contentType);
  }

  /** `{ data, contentType }`, or null when there is no such file. */
  async readFile(tenant, key) {
    let file;
    try {
      file = safeJoin(this.directory, tenant, 'files', key);
    } catch {
      return null;
    }
    try {
      const [data, contentType] = await Promise.all([fs.readFile(file), fs.readFile(`${file}.type`, 'utf8')]);
      return { data, contentType };
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  /** Stores a document (`{ html, savedAt, savedBy }`) under `<tenant>/documents/<id>.json`. */
  async saveDocument(tenant, id, record) {
    const file = safeJoin(this.directory, tenant, 'documents', `${encodeURIComponent(id)}.json`);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(`${file}.tmp`, JSON.stringify(record));
    await fs.rename(`${file}.tmp`, file);
  }

  async loadDocument(tenant, id) {
    const file = safeJoin(this.directory, tenant, 'documents', `${encodeURIComponent(id)}.json`);
    try {
      return JSON.parse(await fs.readFile(file, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }
}
