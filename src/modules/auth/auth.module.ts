import { Module } from '@nestjs/common';
import { AccountLinksService } from './account-links.service.js';
import { AuthCookiesService } from './auth-cookies.service.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { PasswordService } from './password.service.js';
import { SessionsService } from './sessions.service.js';

/**
 * Authentification du back-office : connexion (mot de passe + code par e-mail), sessions, mot de passe oublié,
 * invitations. `AuthGuard` est déclarée comme garde globale dans `AppModule` (après la limitation de débit).
 */
@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    SessionsService,
    PasswordService,
    AuthCookiesService,
    AccountLinksService,
    AuthGuard,
  ],
  exports: [
    AuthService,
    SessionsService,
    PasswordService,
    AuthCookiesService,
    AccountLinksService,
    AuthGuard,
  ],
})
export class AuthModule {}
