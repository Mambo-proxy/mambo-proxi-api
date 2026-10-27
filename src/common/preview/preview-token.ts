import { createHmac } from 'node:crypto';
import { safeEqual } from '../../modules/auth/tokens.js';

/**
 * Jetons de prévisualisation du back-office (`GET /v1/admin/services/{id}/preview-token`,
 * `GET /v1/admin/pages/{key}/preview-token`, `GET /v1/admin/magazine/editions/{id}/preview-token`), lus par les
 * routes publiques (`?preview=`) : charge utile JSON `{ k, id, exp }` encodée en base64url, puis signature
 * HMAC-SHA256 (`TOKEN_SIGNING_SECRET`, préfixe d'usage `preview`). Valables 30 minutes, sans état en base ; un jeton ne vaut que pour le contenu pour lequel il a été émis.
 */

export const PREVIEW_TOKEN_TTL_MS = 30 * 60_000;

export type PreviewKind = 'service' | 'page' | 'magazine';

export interface PreviewClaims {
  kind: PreviewKind;
  /** Identifiant du service ou de l'édition du magazine, ou clé de la page. */
  id: string;
  expiresAt: Date;
}

function signature(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(`preview:${payload}`).digest('base64url');
}

export function signPreviewToken(secret: string, claims: PreviewClaims): string {
  const payload = Buffer.from(
    JSON.stringify({ k: claims.kind, id: claims.id, exp: claims.expiresAt.getTime() }),
  ).toString('base64url');
  return `${payload}.${signature(secret, payload)}`;
}

/** Jeton valide, non expiré, émis pour ce type de contenu : ses informations ; sinon `null`. */
export function verifyPreviewToken(
  secret: string,
  token: string,
  kind: PreviewKind,
  now: Date,
): PreviewClaims | null {
  const [payload, signed, extra] = token.split('.');
  if (payload === undefined || signed === undefined || extra !== undefined) return null;
  if (!safeEqual(signed, signature(secret, payload))) return null;
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof decoded !== 'object' || decoded === null) return null;
  const { k, id, exp } = decoded as Record<string, unknown>;
  if (k !== kind || typeof id !== 'string' || typeof exp !== 'number' || exp <= now.getTime()) return null;
  return { kind, id, expiresAt: new Date(exp) };
}

/** Schéma `PreviewToken` du contrat. */
export interface PreviewToken {
  token: string;
  url: string;
  expiresAt: string;
}

/** Adresse d'aperçu sur le site : `?preview=` avant l'éventuelle ancre (`#formules`). */
export function previewUrl(webUrl: string, path: string, token: string): string {
  const [pathname = '', hash] = path.split('#');
  const url = new URL(pathname, webUrl);
  url.searchParams.set('preview', token);
  if (hash !== undefined) url.hash = hash;
  return url.toString();
}
