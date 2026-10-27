import { createHmac } from 'node:crypto';
import { TOKEN_PURPOSES, hmacDigest } from '../auth/tokens.js';

/**
 * Lien du questionnaire (`/questionnaire/{token}`) : jeton de 256 bits dérivé de l'invitation (HMAC-SHA256 de
 * l'identifiant du questionnaire et de l'instant d'envoi, clé `TOKEN_SIGNING_SECRET`). La base n'en garde que le
 * condensat (`surveys.token_hash`) ; la relance recalcule le même lien sans qu'il soit stocké en clair, ni en base
 * ni dans Redis. Un nouvel envoi (autre instant) donnerait un autre lien.
 */
export function surveyToken(secret: string, surveyId: string, sentAt: Date): string {
  return createHmac('sha256', secret)
    .update(`${TOKEN_PURPOSES.surveyLink}:${surveyId}:${String(sentAt.getTime())}`)
    .digest('base64url');
}

/** Condensat stocké du jeton (recherche du questionnaire à l'ouverture du lien). */
export function surveyTokenHash(secret: string, token: string): string {
  return hmacDigest(secret, TOKEN_PURPOSES.survey, token);
}

/** Forme d'un jeton émis (base64url de 32 octets) : tout autre jeton est inconnu sans requête en base. */
export const SURVEY_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** Validité du lien après l'envoi (docs/05 : jeton unique valable 30 jours). */
export const SURVEY_VALIDITY_DAYS = 30;
