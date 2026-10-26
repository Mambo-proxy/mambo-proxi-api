import { createHmac } from 'node:crypto';
import { safeEqual } from './tokens.js';

/**
 * Jeton d'accès (cookie `mp_at`) : JWT HS256 de 15 minutes, `{ sub: utilisateur, sid: session, iat, exp }`.
 * L'algorithme est fixé (en-tête comparé octet par octet) : `alg: none` ou un autre algorithme est refusé.
 * La session est relue en base à chaque requête : une déconnexion ou une désactivation prend effet aussitôt.
 */
export interface AccessTokenClaims {
  sub: string;
  sid: string;
  iat: number;
  exp: number;
}

const HEADER = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');

function sign(secret: string, content: string): string {
  return createHmac('sha256', secret).update(content).digest('base64url');
}

export function signAccessToken(
  secret: string,
  claims: { sub: string; sid: string },
  now: Date,
  ttlMs: number,
): string {
  const iat = Math.floor(now.getTime() / 1000);
  const payload = Buffer.from(
    JSON.stringify({ sub: claims.sub, sid: claims.sid, iat, exp: iat + Math.floor(ttlMs / 1000) }),
  ).toString('base64url');
  const content = `${HEADER}.${payload}`;
  return `${content}.${sign(secret, content)}`;
}

/** Revendications d'un jeton valide et non expiré, sinon `null`. */
export function verifyAccessToken(secret: string, token: string, now: Date): AccessTokenClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts as [string, string, string];
  if (header !== HEADER || !safeEqual(signature, sign(secret, `${header}.${payload}`))) return null;
  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof claims !== 'object' || claims === null) return null;
  const { sub, sid, iat, exp } = claims as Record<string, unknown>;
  if (typeof sub !== 'string' || typeof sid !== 'string') return null;
  if (typeof iat !== 'number' || typeof exp !== 'number') return null;
  if (exp <= Math.floor(now.getTime() / 1000)) return null;
  return { sub, sid, iat, exp };
}
