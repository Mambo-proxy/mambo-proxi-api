import type { Role } from '../../generated/prisma/client.js';
import type { Permission } from './permissions.js';

/** Colonnes de l'utilisateur lues à chaque requête authentifiée (jamais le condensat du mot de passe). */
export const AUTH_USER_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  isActive: true,
  activatedAt: true,
  lastLoginAt: true,
  lastActiveAt: true,
} as const;

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  isActive: boolean;
  activatedAt: Date | null;
  lastLoginAt: Date | null;
  lastActiveAt: Date | null;
}

/** Session vérifiée d'une requête (posée par `AuthGuard`). */
export interface AuthContext {
  user: AuthUser;
  sessionId: string;
  permissions: Permission[];
}

/** Schéma `CurrentUser` du contrat. */
export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  firstName: string;
  initials: string;
  role: Role;
  permissions: Permission[];
  lastLoginAt: string | null;
}

/** Schéma `LoginResult` du contrat. */
export type LoginResult =
  | { status: 'AUTHENTICATED'; user: CurrentUser }
  | { status: 'OTP_REQUIRED'; challengeId: string; emailHint: string; resendAvailableAt: string };

/** Contexte réseau d'une requête d'authentification (enregistré avec la session, jamais journalisé). */
export interface ClientInfo {
  ip: string | null;
  userAgent: string | null;
}
