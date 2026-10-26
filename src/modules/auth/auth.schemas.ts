import { HttpStatus } from '@nestjs/common';
import { z } from 'zod';
import { ProblemException } from '../../common/problem/problem.js';
import {
  COMPROMISED_PASSWORD_MESSAGE,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  isCompromisedPassword,
} from './password-policy.js';

/**
 * Corps des opérations d'authentification (contrat : `LoginInput`, `SetPasswordInput`, corps de `verify-otp`,
 * `resend-otp`, `forgot-password`). Messages en français ; propriétés inconnues ignorées.
 */

/** Adresse e-mail (schéma `Email`), normalisée en minuscules comme la colonne `users.email`. */
export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

/** Identifiant opaque (schéma `Id`). */
export const idSchema = z.string().min(1).max(64);

export const loginInputSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(256),
  rememberMe: z.boolean().default(false),
});
export type LoginInput = z.output<typeof loginInputSchema>;

export const verifyOtpInputSchema = z.object({
  challengeId: idSchema,
  code: z.string().regex(/^\d{6}$/, { error: 'Saisissez les 6 chiffres du code reçu par e-mail.' }),
  trustDevice: z.boolean().default(false),
});
export type VerifyOtpInput = z.output<typeof verifyOtpInputSchema>;

export const resendOtpInputSchema = z.object({ challengeId: idSchema });
export type ResendOtpInput = z.output<typeof resendOtpInputSchema>;

export const forgotPasswordInputSchema = z.object({ email: emailSchema });
export type ForgotPasswordInput = z.output<typeof forgotPasswordInputSchema>;

/** `SetPasswordInput` : 12 à 256 caractères, refusé s'il figure dans la liste des mots de passe compromis. */
export const setPasswordInputSchema = z.object({
  token: z.string().min(1).max(512),
  password: z
    .string()
    .min(PASSWORD_MIN_LENGTH, {
      error: `Choisissez un mot de passe d'au moins ${String(PASSWORD_MIN_LENGTH)} caractères.`,
    })
    .max(PASSWORD_MAX_LENGTH)
    .refine((password) => !isCompromisedPassword(password), {
      error: COMPROMISED_PASSWORD_MESSAGE,
      params: { code: 'compromised_password' },
    }),
});
export type SetPasswordInput = z.output<typeof setPasswordInputSchema>;

/** 422 sur le mot de passe, quand la règle dépend du compte (mot de passe identique à l'adresse e-mail). */
export function compromisedPasswordException(): ProblemException {
  return new ProblemException({
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    type: 'validation-error',
    title: 'Certaines informations sont à corriger',
    detail: 'Vérifiez les champs signalés puis renvoyez le formulaire.',
    errors: [{ path: 'password', code: 'compromised_password', message: COMPROMISED_PASSWORD_MESSAGE }],
  });
}
