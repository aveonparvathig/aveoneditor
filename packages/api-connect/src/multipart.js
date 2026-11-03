/**
 * Reads request bodies: a size-limited buffer, and the one file of a `multipart/form-data` upload
 * (the editor sends a single file per request).
 */

export class BodyError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** The whole body, refusing it (413) as soon as it grows past `limit` bytes. */
export function readBody(request, limit) {
  return new Promise((resolve, reject) => {
    const declared = Number(request.headers['content-length']);
    if (declared > limit) {
      request.resume();
      return reject(new BodyError(413, 'File too large.'));
    }
    const chunks = [];
    let size = 0;
    request.on('data', chunk => {
      size += chunk.length;
      if (size > limit) {
        reject(new BodyError(413, 'File too large.'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

/** The named file field of a multipart body: `{ filename, contentType, data }` or null. */
export function parseMultipartFile(body, contentTypeHeader, fieldName) {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentTypeHeader || '');
  if (!/^multipart\/form-data/i.test(contentTypeHeader || '') || !match) throw new BodyError(400, 'Expected multipart/form-data.');
  const boundary = Buffer.from(`--${match[1] || match[2]}`);
  let start = body.indexOf(boundary);
  while (start !== -1) {
    const headersStart = start + boundary.length + 2; // after "\r\n"
    if (body.subarray(start + boundary.length, start + boundary.length + 2).toString() === '--') break;
    const headersEnd = body.indexOf('\r\n\r\n', headersStart);
    if (headersEnd === -1) break;
    const next = body.indexOf(boundary, headersEnd);
    if (next === -1) break;
    const headers = body.subarray(headersStart, headersEnd).toString('utf8');
    const disposition = /content-disposition:[^\r\n]*/i.exec(headers)?.[0] || '';
    const name = /\bname="([^"]*)"/i.exec(disposition)?.[1];
    if (name === fieldName) {
      return {
        filename: /\bfilename="([^"]*)"/i.exec(disposition)?.[1] || 'file',
        contentType: /content-type:\s*([^\r\n;]+)/i.exec(headers)?.[1]?.trim().toLowerCase() || 'application/octet-stream',
        // The part ends with "\r\n" before the next boundary.
        data: body.subarray(headersEnd + 4, next - 2)
      };
    }
    start = next;
  }
  return null;
}

/** The image type from the file's first bytes (what it really is, whatever it claims to be). */
export function sniffImageType(data) {
  const startsWith = (...bytes) => bytes.every((byte, i) => data[i] === byte);
  if (startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (startsWith(0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (data.subarray(0, 6).toString('latin1') === 'GIF87a' || data.subarray(0, 6).toString('latin1') === 'GIF89a') return 'image/gif';
  if (data.subarray(0, 4).toString('latin1') === 'RIFF' && data.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (data.subarray(4, 12).toString('latin1') === 'ftypavif') return 'image/avif';
  return null;
}
