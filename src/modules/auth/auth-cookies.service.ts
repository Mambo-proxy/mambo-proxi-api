import { Inject, Injectable } from '@nestjs/common';
import type { CookieOptions, Request, Response } from 'express';
import { AppConfigService } from '../../config/app-config.service.js';
import { ACCESS_TOKEN_TTL_MS, COOKIES } from './auth.constants.js';

/** Jetons d'une session ouverte ou renouvelée, à déposer en cookies. */
export interface SessionCookies {
  accessToken: string;
  refreshToken: string;
  csrfToken: string;
  /** Fin de la session (cookies persistants avec « Rester connecté », sinon cookies de session du navigateur). */
  expiresAt: Date;
  rememberMe: boolean;
}

/**
 * Cookies de l'authentification : `httpOnly` (sauf `mp_csrf`, lu par le site pour l'en-tête `X-CSRF-Token`),
 * `SameSite=Lax`, `Secure` dès que l'API est servie en https, domaine partagé site/API (`COOKIE_DOMAIN`).
 */
@Injectable()
export class AuthCookiesService {
  constructor(@Inject(AppConfigService) private readonly config: AppConfigService) {}

  private base(): CookieOptions {
    const domain = this.config.get('COOKIE_DOMAIN');
    return {
      path: '/',
      sameSite: 'lax',
      secure: this.config.get('API_URL').startsWith('https://'),
      ...(domain === undefined ? {} : { domain }),
    };
  }

  read(request: Request, name: string): string | undefined {
    const cookies = request.cookies as Record<string, unknown> | undefined;
    const value = cookies?.[name];
    return typeof value === 'string' && value !== '' ? value : undefined;
  }

  setSession(response: Response, cookies: SessionCookies, now: Date): void {
    const persistent = cookies.rememberMe
      ? { maxAge: Math.max(0, cookies.expiresAt.getTime() - now.getTime()) }
      : {};
    response.cookie(COOKIES.access, cookies.accessToken, {
      ...this.base(),
      httpOnly: true,
      maxAge: ACCESS_TOKEN_TTL_MS,
    });
    response.cookie(COOKIES.refresh, cookies.refreshToken, { ...this.base(), httpOnly: true, ...persistent });
    response.cookie(COOKIES.csrf, cookies.csrfToken, { ...this.base(), httpOnly: false, ...persistent });
  }

  /** Efface les cookies de session ; le cookie d'appareil de confiance est conservé. */
  clearSession(response: Response): void {
    for (const name of [COOKIES.access, COOKIES.refresh, COOKIES.csrf])
      response.clearCookie(name, this.base());
  }

  setTrustedDevice(response: Response, token: string, expiresAt: Date, now: Date): void {
    response.cookie(COOKIES.trustedDevice, token, {
      ...this.base(),
      httpOnly: true,
      maxAge: Math.max(0, expiresAt.getTime() - now.getTime()),
    });
  }

  clearTrustedDevice(response: Response): void {
    response.clearCookie(COOKIES.trustedDevice, this.base());
  }
}
