import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Post, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { AuthCookiesService } from './auth-cookies.service.js';
import { AUTH_THROTTLES, COOKIES, CSRF_HEADER } from './auth.constants.js';
import { CurrentAuth, Public } from './auth.decorators.js';
import { csrfException, resendTooSoonException, unauthorizedException } from './auth.errors.js';
import {
  forgotPasswordInputSchema,
  loginInputSchema,
  resendOtpInputSchema,
  setPasswordInputSchema,
  verifyOtpInputSchema,
  type ForgotPasswordInput,
  type LoginInput,
  type ResendOtpInput,
  type SetPasswordInput,
  type VerifyOtpInput,
} from './auth.schemas.js';
import { AuthService, type LoginStep } from './auth.service.js';
import type { AuthContext, ClientInfo, CurrentUser, LoginResult } from './auth.types.js';
import { SessionsService } from './sessions.service.js';
import { toCurrentUser } from './user-identity.js';

/** Réponse de `POST /v1/auth/forgot-password` (identique que le compte existe ou non). */
export const FORGOT_PASSWORD_MESSAGE =
  'Si un compte correspond à cette adresse, vous allez recevoir un lien de réinitialisation.';

function clientOf(request: Request): ClientInfo {
  return { ip: request.ip ?? null, userAgent: request.get('user-agent')?.slice(0, 512) ?? null };
}

/**
 * Authentification du back-office (tag « Authentification » du contrat). Cookies `mp_at` (accès, 15 min),
 * `mp_rt` (rafraîchissement rotatif), `mp_csrf` (double-submit) et `mp_td` (appareil de confiance).
 * Réponses jamais mises en cache.
 */
@ApiTags('Authentification')
@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(SessionsService) private readonly sessions: SessionsService,
    @Inject(AuthCookiesService) private readonly cookies: AuthCookiesService,
  ) {}

  /** Dépose les cookies d'une étape de connexion réussie et renvoie le corps du contrat. */
  private respond(step: LoginStep, response: Response, now: Date): LoginResult {
    if (step.session) this.cookies.setSession(response, step.session, now);
    if (step.trustedDevice)
      this.cookies.setTrustedDevice(response, step.trustedDevice.token, step.trustedDevice.expiresAt, now);
    response.status(step.result.status === 'AUTHENTICATED' ? HttpStatus.OK : HttpStatus.ACCEPTED);
    response.setHeader('Cache-Control', 'no-store');
    return step.result;
  }

  @Post('login')
  @Public()
  @Throttle({ default: AUTH_THROTTLES.login })
  @ApiOperation({ operationId: 'login', summary: 'Connexion (e-mail + mot de passe)' })
  async login(
    @Body(new ZodValidationPipe(loginInputSchema)) body: LoginInput,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LoginResult> {
    const now = new Date();
    const step = await this.auth.login(
      body,
      this.cookies.read(request, COOKIES.trustedDevice),
      clientOf(request),
      now,
    );
    return this.respond(step, response, now);
  }

  @Post('verify-otp')
  @Public()
  @Throttle({ default: AUTH_THROTTLES.otp })
  @ApiOperation({ operationId: 'verifyOtp', summary: 'Vérification du code reçu par e-mail' })
  async verifyOtp(
    @Body(new ZodValidationPipe(verifyOtpInputSchema)) body: VerifyOtpInput,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LoginResult> {
    const now = new Date();
    return this.respond(await this.auth.verifyOtp(body, clientOf(request), now), response, now);
  }

  @Post('resend-otp')
  @Public()
  @Throttle({ default: AUTH_THROTTLES.resend })
  @ApiOperation({ operationId: 'resendOtp', summary: 'Renvoi du code (après 60 s)' })
  async resendOtp(
    @Body(new ZodValidationPipe(resendOtpInputSchema)) body: ResendOtpInput,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LoginResult> {
    const outcome = await this.auth.resendOtp(body, new Date());
    if (outcome.kind === 'too-soon') {
      response.setHeader('Retry-After', String(outcome.retryAfterSeconds));
      throw resendTooSoonException();
    }
    response.status(HttpStatus.ACCEPTED);
    response.setHeader('Cache-Control', 'no-store');
    return outcome.result;
  }

  /**
   * Rotation des jetons. Jeton remplacé il y a moins de 10 s (onglets simultanés) : 204 sans nouveaux cookies,
   * ceux de la première rotation suffisent. Refus : 401 et cookies de session effacés.
   */
  @Post('refresh')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: AUTH_THROTTLES.refresh })
  @ApiOperation({ operationId: 'refreshSession', summary: 'Rotation des jetons (cookie `mp_rt`)' })
  async refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<void> {
    const now = new Date();
    const outcome = await this.sessions.refresh(
      this.cookies.read(request, COOKIES.refresh),
      clientOf(request),
      now,
    );
    response.setHeader('Cache-Control', 'no-store');
    if (outcome.kind === 'rejected') {
      this.cookies.clearSession(response);
      throw unauthorizedException();
    }
    if (outcome.kind === 'rotated') this.cookies.setSession(response, outcome.cookies, now);
  }

  /**
   * Déconnexion : session désignée par le jeton d'accès, ou à défaut par le jeton de rafraîchissement (jeton
   * d'accès expiré) ; jeton CSRF exigé dans les deux cas. Le cookie d'appareil de confiance est conservé.
   */
  @Post('logout')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ operationId: 'logout', summary: 'Déconnexion (révoque la session)' })
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<void> {
    const now = new Date();
    const auth = await this.sessions.authenticate(this.cookies.read(request, COOKIES.access), now);
    const target = auth
      ? { id: auth.sessionId, userId: auth.user.id }
      : await this.sessions.findByRefreshToken(this.cookies.read(request, COOKIES.refresh), now);
    if (!target) {
      this.cookies.clearSession(response);
      throw unauthorizedException();
    }
    if (
      !this.sessions.verifyCsrfToken(
        target.userId,
        request.get(CSRF_HEADER),
        this.cookies.read(request, COOKIES.csrf),
      )
    )
      throw csrfException();
    await this.sessions.revoke(target.id, now);
    this.cookies.clearSession(response);
  }

  @Get('me')
  @ApiOperation({ operationId: 'getMe', summary: 'Utilisateur connecté' })
  me(@CurrentAuth() auth: AuthContext, @Res({ passthrough: true }) response: Response): CurrentUser {
    response.setHeader('Cache-Control', 'no-store');
    return toCurrentUser(auth.user);
  }

  @Post('forgot-password')
  @Public()
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: AUTH_THROTTLES.email })
  @ApiOperation({ operationId: 'forgotPassword', summary: 'Demande de réinitialisation du mot de passe' })
  async forgotPassword(
    @Body(new ZodValidationPipe(forgotPasswordInputSchema)) body: ForgotPasswordInput,
  ): Promise<{ message: string }> {
    await this.auth.forgotPassword(body.email, new Date());
    return { message: FORGOT_PASSWORD_MESSAGE };
  }

  @Post('reset-password')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: AUTH_THROTTLES.token })
  @ApiOperation({ operationId: 'resetPassword', summary: 'Nouveau mot de passe (lien reçu par e-mail)' })
  async resetPassword(
    @Body(new ZodValidationPipe(setPasswordInputSchema)) body: SetPasswordInput,
  ): Promise<void> {
    await this.auth.resetPassword(body, new Date());
  }

  @Post('accept-invite')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: AUTH_THROTTLES.token })
  @ApiOperation({ operationId: 'acceptInvite', summary: "Acceptation d'une invitation au back-office" })
  async acceptInvite(
    @Body(new ZodValidationPipe(setPasswordInputSchema)) body: SetPasswordInput,
  ): Promise<void> {
    await this.auth.acceptInvite(body, new Date());
  }
}
