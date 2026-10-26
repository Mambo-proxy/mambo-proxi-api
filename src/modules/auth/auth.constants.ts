/** Réglages de l'authentification du back-office (docs/05 §3.2, docs/07, contrat `Authentification`). */

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** Cookies du contrat : jeton d'accès, jeton de rafraîchissement, jeton CSRF lisible, appareil de confiance. */
export const COOKIES = {
  access: 'mp_at',
  refresh: 'mp_rt',
  csrf: 'mp_csrf',
  trustedDevice: 'mp_td',
} as const;

/** En-tête « double-submit » (recopie du cookie `mp_csrf`). */
export const CSRF_HEADER = 'x-csrf-token';

/** Jeton d'accès JWT : 15 minutes. */
export const ACCESS_TOKEN_TTL_MS = 15 * MINUTE_MS;
/** Session (jeton de rafraîchissement) : 7 jours, 30 avec « Rester connecté ». Durée fixée à la connexion. */
export const SESSION_TTL_MS = 7 * DAY_MS;
export const REMEMBER_ME_SESSION_TTL_MS = 30 * DAY_MS;
/**
 * Un jeton de rafraîchissement remplacé depuis moins de 10 s (deux onglets qui rafraîchissent en même temps) est
 * ignoré sans nouveaux cookies ; au-delà, sa réutilisation révoque toutes les sessions de l'utilisateur.
 */
export const REFRESH_REUSE_GRACE_MS = 10_000;

/** Code par e-mail : 6 chiffres, 10 minutes, 5 essais au total (renvois compris), renvoi après 60 s. */
export const OTP_TTL_MS = 10 * MINUTE_MS;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_DELAY_MS = MINUTE_MS;

/** Appareil de confiance : durée par défaut (paramètre `securite.trustedDeviceDays`, 0 = désactivé). */
export const DEFAULT_TRUSTED_DEVICE_DAYS = 30;

/**
 * Verrouillage progressif : toutes les 5 erreurs de mot de passe consécutives, le compte est verrouillé 15 min,
 * puis 30, 60… (plafond 24 h). Le compteur repart de zéro après un mot de passe correct ou une réinitialisation.
 */
export const LOCK_THRESHOLD = 5;
export const LOCK_BASE_MS = 15 * MINUTE_MS;
export const LOCK_MAX_MS = DAY_MS;

/** Lien de réinitialisation : 1 heure ; invitation : 7 jours (textes des e-mails `password-reset`, `user-invite`). */
export const PASSWORD_RESET_TTL_MS = HOUR_MS;
export const INVITATION_TTL_MS = 7 * DAY_MS;

/** Présence : activité écrite au plus une fois par minute et par session ; « en ligne » = moins de 5 minutes. */
export const ACTIVITY_WRITE_INTERVAL_MS = MINUTE_MS;
export const ONLINE_WINDOW_MINUTES = 5;

/** Écrans du back-office ouverts par les liens des e-mails (`?token=`). */
export const WEB_PATHS = {
  resetPassword: '/admin/nouveau-mot-de-passe',
  acceptInvite: '/admin/invitation',
} as const;

/** Limitation de débit des routes d'authentification (par adresse IP, en plus du verrouillage par compte). */
export const AUTH_THROTTLES = {
  login: { ttl: MINUTE_MS, limit: 10 },
  otp: { ttl: MINUTE_MS, limit: 10 },
  resend: { ttl: MINUTE_MS, limit: 5 },
  refresh: { ttl: MINUTE_MS, limit: 30 },
  email: { ttl: MINUTE_MS, limit: 5 },
  token: { ttl: MINUTE_MS, limit: 10 },
} as const;
