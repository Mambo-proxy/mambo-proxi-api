import { createHmac, randomBytes } from 'node:crypto';
import { hmacDigest, safeEqual } from '../auth/tokens.js';

/** Usages des jetons de la newsletter (séparation des clés dérivées de `TOKEN_SIGNING_SECRET`). */
const PURPOSES = {
  confirm: 'newsletter-confirm',
  unsubscribe: 'newsletter-unsubscribe',
} as const;

/** Validité du lien de confirmation (double opt-in). */
export const CONFIRM_VALIDITY_DAYS = 7;

/** Lien de confirmation : 256 bits aléatoires ; la base n'en garde que le condensat (`confirm_token_hash`). */
export function newConfirmToken(): string {
  return randomBytes(32).toString('base64url');
}

export function confirmTokenHash(secret: string, token: string): string {
  return hmacDigest(secret, PURPOSES.confirm, token);
}

/** Forme d'un jeton de confirmation émis (base64url de 32 octets). */
export const CONFIRM_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const ID_PATTERN = /^[a-z0-9]{1,64}$/;

function signature(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(`${PURPOSES.unsubscribe}:${payload}`).digest('base64url');
}

/**
 * Lien de désinscription en un clic : identifiant de l'abonné (et de la campagne d'origine, pour ses statistiques)
 * signé par HMAC-SHA256. Sans état ni date d'expiration : un lien d'un ancien e-mail reste valable (RFC 8058),
 * et rien n'est stocké en clair.
 */
export function unsubscribeToken(secret: string, subscriberId: string, campaignId?: string | null): string {
  const payload = campaignId ? `${subscriberId}_${campaignId}` : subscriberId;
  return `${payload}.${signature(secret, payload)}`;
}

export interface UnsubscribeClaim {
  subscriberId: string;
  campaignId: string | null;
}

/** Jeton de désinscription vérifié (signature comparée à temps constant), sinon `null`. */
export function readUnsubscribeToken(secret: string, token: string): UnsubscribeClaim | null {
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  if (!safeEqual(token.slice(dot + 1), signature(secret, payload))) return null;
  const [subscriberId, campaignId, ...rest] = payload.split('_');
  if (subscriberId === undefined || !ID_PATTERN.test(subscriberId) || rest.length > 0) return null;
  if (campaignId !== undefined && !ID_PATTERN.test(campaignId)) return null;
  return { subscriberId, campaignId: campaignId ?? null };
}
