import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthContext } from './auth.types.js';
import type { Permission } from './permissions.js';

export const IS_PUBLIC_KEY = 'auth:public';
export const PERMISSIONS_KEY = 'auth:permissions';

/**
 * Route accessible sans session (site public, connexion, santé). Toutes les autres routes exigent une session
 * valide (`AuthGuard`, garde globale) : une route ajoutée sans ce décorateur est protégée par défaut.
 */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Permissions qui donnent accès à une opération du back-office (`x-permissions` du contrat) : une seule suffit.
 * Obligatoire sous `/v1/admin` : une route du back-office sans ce décorateur est refusée (403) pour tous.
 */
export const RequirePermissions = (
  ...permissions: [Permission, ...Permission[]]
): MethodDecorator & ClassDecorator => SetMetadata(PERMISSIONS_KEY, permissions);

/** Requête dont la session a été vérifiée par `AuthGuard`. */
export interface AuthenticatedRequest extends Request {
  auth?: AuthContext;
}

/** Utilisateur et session de la requête (routes protégées uniquement). */
export const CurrentAuth = createParamDecorator((_data: unknown, context: ExecutionContext): AuthContext => {
  const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
  if (!request.auth) throw new Error('CurrentAuth utilisé sur une route publique.');
  return request.auth;
});
