import { createHmac } from 'node:crypto';
import { safeEqual } from '../auth/tokens.js';

/**
 * Liens de téléchargement signés des fichiers privés (`SignedUrl` du contrat) : charge utile JSON `{ a, exp }`
 * (identifiant de la pièce jointe, expiration en ms) encodée en base64url, puis signature HMAC-SHA256
 * (`TOKEN_SIGNING_SECRET`, préfixe d'usage `file-download`). Valables 5 minutes, sans état en base : la pièce jointe
 * est relue à chaque téléchargement (fichier anonymisé ou supprimé entre-temps → introuvable).
 */

export const DOWNLOAD_TOKEN_TTL_MS = 5 * 60_000;

export interface DownloadClaims {
  attachmentId: string;
  expiresAt: Date;
}

function signature(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(`file-download:${payload}`).digest('base64url');
}

export function signDownloadToken(secret: string, claims: DownloadClaims): string {
  const payload = Buffer.from(
    JSON.stringify({ a: claims.attachmentId, exp: claims.expiresAt.getTime() }),
  ).toString('base64url');
  return `${payload}.${signature(secret, payload)}`;
}

/** Jeton signé par l'API : ses informations (même expirées, pour distinguer un lien périmé) ; sinon `null`. */
export function readDownloadToken(secret: string, token: string): DownloadClaims | null {
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
  const { a, exp } = decoded as Record<string, unknown>;
  if (typeof a !== 'string' || typeof exp !== 'number') return null;
  return { attachmentId: a, expiresAt: new Date(exp) };
}
