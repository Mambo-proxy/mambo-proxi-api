import { HttpStatus } from '@nestjs/common';
import { ProblemException } from '../../common/problem/problem.js';

/** Erreurs de l'authentification (exemples du contrat ; textes du back-office simulé du site). */

/** 401 de la réponse `Unauthorized` : session absente, expirée ou révoquée. */
export function unauthorizedException(): ProblemException {
  return new ProblemException({
    status: HttpStatus.UNAUTHORIZED,
    type: 'unauthorized',
    title: 'Session expirée',
    detail: 'Veuillez vous reconnecter.',
  });
}

/** 403 de la réponse `Forbidden` : rôle insuffisant. */
export function forbiddenException(
  detail = "Votre rôle ne permet pas d'effectuer cette action.",
): ProblemException {
  return new ProblemException({
    status: HttpStatus.FORBIDDEN,
    type: 'forbidden',
    title: 'Action non autorisée',
    detail,
  });
}

/** 403 de la réponse `Forbidden` : jeton CSRF absent ou invalide. */
export function csrfException(): ProblemException {
  return new ProblemException({
    status: HttpStatus.FORBIDDEN,
    type: 'csrf-token-invalid',
    title: 'Action non autorisée',
    detail: 'Le jeton de sécurité est absent ou invalide. Rechargez la page puis réessayez.',
  });
}

export function invalidCredentialsException(): ProblemException {
  return new ProblemException({
    status: HttpStatus.UNAUTHORIZED,
    type: 'invalid-credentials',
    title: 'Identifiants incorrects',
    detail: "L'adresse e-mail ou le mot de passe est incorrect.",
  });
}

/** 423 : compte verrouillé, avec le délai restant arrondi à la minute supérieure. */
export function accountLockedException(remainingMs: number): ProblemException {
  const minutes = Math.max(1, Math.ceil(remainingMs / 60_000));
  const delay =
    minutes >= 120 && minutes % 60 === 0
      ? `${String(minutes / 60)} heures`
      : `${String(minutes)} minute${minutes > 1 ? 's' : ''}`;
  return new ProblemException({
    status: HttpStatus.LOCKED,
    type: 'account-locked',
    title: 'Compte verrouillé',
    detail: `Trop de tentatives. Réessayez dans ${delay} ou réinitialisez votre mot de passe.`,
  });
}

function invalidOtp(detail: string): ProblemException {
  return new ProblemException({
    status: HttpStatus.UNAUTHORIZED,
    type: 'invalid-otp',
    title: 'Code incorrect',
    detail,
  });
}

/** Code faux : essais restants. */
export function wrongOtpException(attemptsLeft: number): ProblemException {
  return invalidOtp(
    `Ce code est incorrect. Il vous reste ${String(attemptsLeft)} essai${attemptsLeft > 1 ? 's' : ''}.`,
  );
}

/** Code épuisé (5 essais). */
export function otpAttemptsExhaustedException(): ProblemException {
  return invalidOtp('Trop d’essais. Reconnectez-vous pour recevoir un nouveau code.');
}

/** Défi inconnu, expiré ou déjà utilisé. */
export function otpExpiredException(): ProblemException {
  return invalidOtp('Ce code a expiré. Reconnectez-vous pour en recevoir un nouveau.');
}

/** 429 : renvoi du code demandé avant 60 s. */
export function resendTooSoonException(): ProblemException {
  return new ProblemException({
    status: HttpStatus.TOO_MANY_REQUESTS,
    type: 'rate-limited',
    title: 'Trop de tentatives',
    detail: 'Patientez quelques secondes avant de demander un nouveau code.',
  });
}

/** 410 : lien de réinitialisation invalide, utilisé ou expiré. */
export function resetLinkExpiredException(): ProblemException {
  return new ProblemException({
    status: HttpStatus.GONE,
    type: 'link-expired',
    title: 'Lien expiré',
    detail: 'Ce lien a expiré. Demandez un nouveau lien de réinitialisation.',
  });
}

/** 410 : invitation invalide, acceptée, révoquée ou expirée. */
export function invitationExpiredException(): ProblemException {
  return new ProblemException({
    status: HttpStatus.GONE,
    type: 'invitation-expired',
    title: 'Invitation expirée',
    detail: 'Cette invitation a expiré. Demandez à un administrateur de vous inviter à nouveau.',
  });
}
