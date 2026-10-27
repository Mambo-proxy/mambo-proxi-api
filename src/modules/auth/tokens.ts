import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/**
 * Primitives des jetons d'authentification. Les jetons remis au navigateur ou envoyés par e-mail (rafraîchissement,
 * appareil de confiance, réinitialisation, invitation) sont des valeurs aléatoires de 256 bits ; la base n'en garde
 * qu'un condensat HMAC-SHA256 (clé secrète de la configuration) : une copie de la base ne permet ni de les
 * réutiliser ni de retrouver un code à 6 chiffres par force brute.
 */

/** Jeton aléatoire de 256 bits, encodé en base64url (43 caractères). */
export function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Code à 6 chiffres tiré uniformément (zéros initiaux compris). */
export function randomOtpCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

/** Condensat HMAC-SHA256 (hexadécimal) d'une valeur, avec un préfixe d'usage qui sépare les domaines. */
export function hmacDigest(secret: string, purpose: string, value: string): string {
  return createHmac('sha256', secret).update(`${purpose}:${value}`).digest('hex');
}

/** Comparaison à temps constant de deux chaînes (longueurs différentes : `false`). */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Usages des condensats (préfixes) : un jeton d'un usage n'est jamais accepté pour un autre. */
export const TOKEN_PURPOSES = {
  refresh: 'refresh',
  trustedDevice: 'trusted-device',
  otp: 'otp',
  passwordReset: 'password-reset',
  invitation: 'invitation',
  csrf: 'csrf',
  appointmentProposal: 'appointment-proposal',
  /** Lien du questionnaire de satisfaction (dérivé de l'invitation) et son condensat. */
  surveyLink: 'survey-link',
  survey: 'survey',
} as const;
