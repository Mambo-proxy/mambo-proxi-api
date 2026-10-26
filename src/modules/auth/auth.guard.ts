import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GLOBAL_PREFIX } from '../../app.setup.js';
import { AuthCookiesService } from './auth-cookies.service.js';
import { COOKIES, CSRF_HEADER } from './auth.constants.js';
import { IS_PUBLIC_KEY, PERMISSIONS_KEY, type AuthenticatedRequest } from './auth.decorators.js';
import { csrfException, forbiddenException, unauthorizedException } from './auth.errors.js';
import { hasAnyPermission, type Permission } from './permissions.js';
import { SessionsService } from './sessions.service.js';

/** Méthodes sans effet : pas de contrôle CSRF. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Préfixe des routes du back-office : permissions obligatoires. */
const ADMIN_PATH_PREFIX = `/${GLOBAL_PREFIX}/admin`;

function isAdminPath(path: string): boolean {
  return path === ADMIN_PATH_PREFIX || path.startsWith(`${ADMIN_PATH_PREFIX}/`);
}

/**
 * Garde globale (après la limitation de débit), fermée par défaut :
 * 1. route `@Public()` → accès libre ;
 * 2. sinon, session valide exigée (cookie `mp_at`, session non révoquée, utilisateur actif) → 401 ;
 * 3. mutation (`POST`, `PUT`, `PATCH`, `DELETE`) → jeton CSRF « double-submit » signé exigé → 403 ;
 * 4. sous `/v1/admin` → une des permissions de `@RequirePermissions` exigée ; une route du back-office qui n'en
 *    déclare aucune est refusée à tous (403), pour qu'un oubli ne l'ouvre jamais.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(SessionsService) private readonly sessions: SessionsService,
    @Inject(AuthCookiesService) private readonly cookies: AuthCookiesService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, targets) === true) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const auth = await this.sessions.authenticate(this.cookies.read(request, COOKIES.access), new Date());
    if (!auth) throw unauthorizedException();
    request.auth = auth;

    if (!SAFE_METHODS.has(request.method.toUpperCase())) {
      const header = request.get(CSRF_HEADER);
      if (!this.sessions.verifyCsrfToken(auth.user.id, header, this.cookies.read(request, COOKIES.csrf)))
        throw csrfException();
    }

    const required = this.reflector.getAllAndOverride<Permission[] | undefined>(PERMISSIONS_KEY, targets);
    if (required !== undefined && required.length > 0) {
      if (!hasAnyPermission(auth.user.role, required)) throw forbiddenException();
    } else if (isAdminPath(request.path)) {
      throw forbiddenException();
    }
    return true;
  }
}
