/**
 * JSON Web Token verification (HS256, RS256, ES256) with Node's own crypto, so client backends
 * can sign tokens with any standard JWT library and API Connect needs no dependency to check them.
 */

import { createHmac, createPublicKey, timingSafeEqual, verify } from 'node:crypto';

export class TokenError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TokenError';
  }
}

function decodePart(part) {
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
  } catch {
    throw new TokenError('Malformed token.');
  }
}

/** The claims of a token without checking it: only to find which tenant's key to check it with. */
export function peekClaims(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new TokenError('Malformed token.');
  return decodePart(parts[1]);
}

/**
 * Checks the signature and the time claims and returns the claims.
 *
 * `key`: `{ secret }` for HS256, or `{ publicKey }` (PEM or JWK) for RS256 / ES256. `issuer` and
 * `audience`, when given, must match `iss` and `aud`. `leeway` allows clock drift (seconds).
 */
export function verifyJwt(token, { secret, publicKey, issuer, audience, leeway = 30, now = Date.now() / 1000 } = {}) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new TokenError('Malformed token.');
  const [headerPart, payloadPart, signaturePart] = parts;
  const header = decodePart(headerPart);
  const claims = decodePart(payloadPart);
  const data = Buffer.from(`${headerPart}.${payloadPart}`);
  const signature = Buffer.from(signaturePart, 'base64url');

  // The algorithm is decided by the key we hold, never by the token ("alg: none" and HS/RS confusion).
  if (secret) {
    if (header.alg !== 'HS256') throw new TokenError('Unexpected token algorithm.');
    const expected = createHmac('sha256', secret).update(data).digest();
    if (expected.length !== signature.length || !timingSafeEqual(expected, signature)) throw new TokenError('Invalid token signature.');
  } else if (publicKey) {
    const key = createPublicKey(typeof publicKey === 'string' ? publicKey : { key: publicKey, format: 'jwk' });
    if (header.alg === 'RS256' && key.asymmetricKeyType === 'rsa') {
      if (!verify('sha256', data, key, signature)) throw new TokenError('Invalid token signature.');
    } else if (header.alg === 'ES256' && key.asymmetricKeyType === 'ec') {
      if (!verify('sha256', data, { key, dsaEncoding: 'ieee-p1363' }, signature)) throw new TokenError('Invalid token signature.');
    } else {
      throw new TokenError('Unexpected token algorithm.');
    }
  } else {
    throw new TokenError('No key configured for this tenant.');
  }

  if (typeof claims.exp !== 'number') throw new TokenError('Token has no expiry.');
  if (claims.exp + leeway < now) throw new TokenError('Token expired.');
  if (typeof claims.nbf === 'number' && claims.nbf - leeway > now) throw new TokenError('Token not valid yet.');
  if (issuer && claims.iss !== issuer) throw new TokenError('Unexpected token issuer.');
  if (audience) {
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!audiences.includes(audience)) throw new TokenError('Unexpected token audience.');
  }
  return claims;
}

/** Signs an HS256 token (for tests and for client backends written in Node). */
export function signJwt(claims, secret) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signature = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}
