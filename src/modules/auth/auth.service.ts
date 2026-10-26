import { Inject, Injectable, Logger } from '@nestjs/common';
import { asObject } from '../../common/json/json-read.js';
import type { Role } from '../../generated/prisma/client.js';
import { AppConfigService } from '../../config/app-config.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AccountLinksService } from './account-links.service.js';
import type { SessionCookies } from './auth-cookies.service.js';
import {
  DEFAULT_TRUSTED_DEVICE_DAYS,
  LOCK_BASE_MS,
  LOCK_MAX_MS,
  LOCK_THRESHOLD,
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_DELAY_MS,
  OTP_TTL_MS,
} from './auth.constants.js';
import {
  accountLockedException,
  invalidCredentialsException,
  invitationExpiredException,
  otpAttemptsExhaustedException,
  otpExpiredException,
  resetLinkExpiredException,
  wrongOtpException,
} from './auth.errors.js';
import {
  compromisedPasswordException,
  type LoginInput,
  type ResendOtpInput,
  type SetPasswordInput,
  type VerifyOtpInput,
} from './auth.schemas.js';
import type { ClientInfo, LoginResult } from './auth.types.js';
import { deviceLabel } from './device-label.js';
import { isCompromisedPassword } from './password-policy.js';
import { PasswordService } from './password.service.js';
import { SessionsService } from './sessions.service.js';
import { TOKEN_PURPOSES, hmacDigest, randomOtpCode, randomToken, safeEqual } from './tokens.js';
import { emailHint, toCurrentUser } from './user-identity.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Colonnes lues à la connexion (le condensat du mot de passe ne sort jamais de ce service). */
const LOGIN_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  isActive: true,
  activatedAt: true,
  passwordHash: true,
  failedLoginCount: true,
  lockedUntil: true,
  lastLoginAt: true,
} as const;

interface LoginUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  isActive: boolean;
  activatedAt: Date | null;
  passwordHash: string | null;
  failedLoginCount: number;
  lockedUntil: Date | null;
  lastLoginAt: Date | null;
}

/** Réponse d'une étape de connexion : corps du contrat, cookies de session et d'appareil de confiance éventuels. */
export interface LoginStep {
  result: LoginResult;
  session?: SessionCookies;
  trustedDevice?: { token: string; expiresAt: Date };
}

/** Renvoi du code : nouveau défi, ou délai de 60 s pas encore écoulé (secondes restantes). */
export type ResendOutcome =
  { kind: 'sent'; result: LoginResult } | { kind: 'too-soon'; retryAfterSeconds: number };

/**
 * Parcours de connexion du back-office (contrat, tag « Authentification ») : mot de passe (argon2id, verrouillage
 * progressif), code à 6 chiffres par e-mail ou appareil de confiance, mot de passe oublié, invitation.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AppConfigService) private readonly config: AppConfigService,
    @Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(SessionsService) private readonly sessions: SessionsService,
    @Inject(AccountLinksService) private readonly links: AccountLinksService,
  ) {}

  private secretDigest(purpose: string, value: string): string {
    return hmacDigest(this.config.get('TOKEN_SIGNING_SECRET'), purpose, value);
  }

  /** Durée de confiance des appareils (paramètre `securite.trustedDeviceDays`, 0 à 90 ; 0 = toujours un code). */
  private async trustedDeviceDays(): Promise<number> {
    const row = await this.prisma.setting.findUnique({ where: { key: 'securite' }, select: { value: true } });
    const days = asObject(row?.value)['trustedDeviceDays'];
    return typeof days === 'number' && Number.isInteger(days) && days >= 0 && days <= 90
      ? days
      : DEFAULT_TRUSTED_DEVICE_DAYS;
  }

  /** `POST /v1/auth/login`. */
  async login(
    input: LoginInput,
    trustedDeviceToken: string | undefined,
    client: ClientInfo,
    now: Date,
  ): Promise<LoginStep> {
    const user: LoginUser | null = await this.prisma.user.findUnique({
      where: { email: input.email },
      select: LOGIN_SELECT,
    });
    if (user?.lockedUntil && user.lockedUntil > now)
      throw accountLockedException(user.lockedUntil.getTime() - now.getTime());

    // Calcul argon2 dans tous les cas (compte inconnu ou sans mot de passe compris) : même temps de réponse.
    const valid = await this.passwords.verify(user?.passwordHash, input.password);
    if (!user || !user.isActive || user.activatedAt === null || !valid) {
      if (user?.isActive && user.passwordHash !== null && !valid) await this.recordFailure(user.id, now);
      throw invalidCredentialsException();
    }
    await this.recordSuccess(user, input.password);

    const days = await this.trustedDeviceDays();
    const device = days > 0 ? await this.findTrustedDevice(user.id, trustedDeviceToken, days, now) : null;
    if (device) {
      await this.prisma.trustedDevice.update({ where: { id: device }, data: { lastUsedAt: now } });
      return this.openSession(user, { rememberMe: input.rememberMe, trustedDeviceId: device, client }, now);
    }
    return { result: await this.createChallenge(user, input.rememberMe, now) };
  }

  /** Erreur de mot de passe : toutes les 5 erreurs consécutives, verrouillage (15 min, 30, 60… plafond 24 h). */
  private async recordFailure(userId: string, now: Date): Promise<void> {
    const { failedLoginCount } = await this.prisma.user.update({
      where: { id: userId },
      data: { failedLoginCount: { increment: 1 } },
      select: { failedLoginCount: true },
    });
    if (failedLoginCount % LOCK_THRESHOLD !== 0) return;
    const level = failedLoginCount / LOCK_THRESHOLD;
    const duration = Math.min(LOCK_BASE_MS * 2 ** (level - 1), LOCK_MAX_MS);
    await this.prisma.user.update({
      where: { id: userId },
      data: { lockedUntil: new Date(now.getTime() + duration) },
    });
    this.logger.warn(
      `Compte ${userId} verrouillé après ${String(failedLoginCount)} erreurs de mot de passe.`,
    );
    throw accountLockedException(duration);
  }

  /** Mot de passe correct : compteur remis à zéro ; condensat recalculé si les paramètres argon2 ont changé. */
  private async recordSuccess(user: LoginUser, password: string): Promise<void> {
    const rehash = user.passwordHash !== null && this.passwords.needsRehash(user.passwordHash);
    if (user.failedLoginCount === 0 && user.lockedUntil === null && !rehash) return;
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: 0,
        lockedUntil: null,
        ...(rehash ? { passwordHash: await this.passwords.hash(password) } : {}),
      },
    });
  }

  /** Appareil de confiance valide pour cet utilisateur (cookie `mp_td`), dans la durée actuelle du paramètre. */
  private async findTrustedDevice(
    userId: string,
    token: string | undefined,
    days: number,
    now: Date,
  ): Promise<string | null> {
    if (!token) return null;
    const device = await this.prisma.trustedDevice.findUnique({
      where: { tokenHash: this.secretDigest(TOKEN_PURPOSES.trustedDevice, token) },
      select: { id: true, userId: true, expiresAt: true, revokedAt: true, createdAt: true },
    });
    if (!device || device.userId !== userId || device.revokedAt !== null || device.expiresAt <= now)
      return null;
    if (device.createdAt.getTime() + days * DAY_MS <= now.getTime()) return null;
    return device.id;
  }

  private otpHash(userId: string, code: string): string {
    return this.secretDigest(TOKEN_PURPOSES.otp, `${userId}:${code}`);
  }

  /** Nouveau défi (les précédents sont clos) et envoi du code (`otp-code`). */
  private async createChallenge(user: LoginUser, rememberMe: boolean, now: Date): Promise<LoginResult> {
    await this.prisma.otpChallenge.updateMany({
      where: { userId: user.id, consumedAt: null },
      data: { consumedAt: now },
    });
    const code = randomOtpCode();
    const resendAvailableAt = new Date(now.getTime() + OTP_RESEND_DELAY_MS);
    const challenge = await this.prisma.otpChallenge.create({
      data: {
        userId: user.id,
        codeHash: this.otpHash(user.id, code),
        rememberMe,
        attempts: 0,
        resendAvailableAt,
        expiresAt: new Date(now.getTime() + OTP_TTL_MS),
        consumedAt: null,
      },
      select: { id: true },
    });
    await this.links.send({ template: 'otp-code', to: user.email, lang: 'fr', data: { code } });
    return {
      status: 'OTP_REQUIRED',
      challengeId: challenge.id,
      emailHint: emailHint(user.email),
      resendAvailableAt: resendAvailableAt.toISOString(),
    };
  }

  /** `POST /v1/auth/verify-otp`. */
  async verifyOtp(input: VerifyOtpInput, client: ClientInfo, now: Date): Promise<LoginStep> {
    const challenge = await this.prisma.otpChallenge.findUnique({
      where: { id: input.challengeId },
      select: {
        id: true,
        userId: true,
        codeHash: true,
        rememberMe: true,
        attempts: true,
        expiresAt: true,
        consumedAt: true,
      },
    });
    if (!challenge || challenge.consumedAt !== null || challenge.expiresAt <= now)
      throw otpExpiredException();
    if (challenge.attempts >= OTP_MAX_ATTEMPTS) throw otpAttemptsExhaustedException();

    if (!safeEqual(this.otpHash(challenge.userId, input.code), challenge.codeHash)) {
      const { attempts } = await this.prisma.otpChallenge.update({
        where: { id: challenge.id },
        data: { attempts: { increment: 1 } },
        select: { attempts: true },
      });
      const left = OTP_MAX_ATTEMPTS - attempts;
      if (left > 0) throw wrongOtpException(left);
      await this.prisma.otpChallenge.update({ where: { id: challenge.id }, data: { consumedAt: now } });
      throw otpAttemptsExhaustedException();
    }

    // Usage unique, même pour deux vérifications simultanées.
    const claimed = await this.prisma.otpChallenge.updateMany({
      where: { id: challenge.id, consumedAt: null },
      data: { consumedAt: now },
    });
    if (claimed.count === 0) throw otpExpiredException();

    const user: LoginUser | null = await this.prisma.user.findUnique({
      where: { id: challenge.userId },
      select: LOGIN_SELECT,
    });
    if (!user || !user.isActive || user.activatedAt === null) throw otpExpiredException();
    if (user.lockedUntil && user.lockedUntil > now)
      throw accountLockedException(user.lockedUntil.getTime() - now.getTime());

    let trustedDevice: LoginStep['trustedDevice'];
    let trustedDeviceId: string | null = null;
    const days = input.trustDevice ? await this.trustedDeviceDays() : 0;
    if (days > 0) {
      const token = randomToken();
      const expiresAt = new Date(now.getTime() + days * DAY_MS);
      const device = await this.prisma.trustedDevice.create({
        data: {
          userId: user.id,
          tokenHash: this.secretDigest(TOKEN_PURPOSES.trustedDevice, token),
          label: deviceLabel(client.userAgent),
          lastUsedAt: now,
          expiresAt,
          revokedAt: null,
        },
        select: { id: true },
      });
      trustedDeviceId = device.id;
      trustedDevice = { token, expiresAt };
    }
    const step = await this.openSession(
      user,
      { rememberMe: challenge.rememberMe, trustedDeviceId, client },
      now,
    );
    return trustedDevice ? { ...step, trustedDevice } : step;
  }

  private async openSession(
    user: LoginUser,
    options: { rememberMe: boolean; trustedDeviceId: string | null; client: ClientInfo },
    now: Date,
  ): Promise<LoginStep> {
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: now, lastActiveAt: now } });
    const session = await this.sessions.open(user.id, options, now);
    return {
      result: { status: 'AUTHENTICATED', user: toCurrentUser({ ...user, lastLoginAt: now }) },
      session,
    };
  }

  /** `POST /v1/auth/resend-otp` : nouveau code pour le même défi, après 60 s ; le nombre d'essais n'est pas remis à zéro. */
  async resendOtp(input: ResendOtpInput, now: Date): Promise<ResendOutcome> {
    const challenge = await this.prisma.otpChallenge.findUnique({
      where: { id: input.challengeId },
      select: {
        id: true,
        userId: true,
        attempts: true,
        expiresAt: true,
        consumedAt: true,
        resendAvailableAt: true,
      },
    });
    if (
      !challenge ||
      challenge.consumedAt !== null ||
      challenge.expiresAt <= now ||
      challenge.attempts >= OTP_MAX_ATTEMPTS
    )
      throw otpExpiredException();
    if (challenge.resendAvailableAt > now)
      return {
        kind: 'too-soon',
        retryAfterSeconds: Math.ceil((challenge.resendAvailableAt.getTime() - now.getTime()) / 1000),
      };
    const user = await this.prisma.user.findUnique({
      where: { id: challenge.userId },
      select: { id: true, email: true, isActive: true },
    });
    if (!user?.isActive) throw otpExpiredException();

    const code = randomOtpCode();
    const resendAvailableAt = new Date(now.getTime() + OTP_RESEND_DELAY_MS);
    await this.prisma.otpChallenge.update({
      where: { id: challenge.id },
      data: {
        codeHash: this.otpHash(user.id, code),
        resendAvailableAt,
        expiresAt: new Date(now.getTime() + OTP_TTL_MS),
      },
    });
    await this.links.send({ template: 'otp-code', to: user.email, lang: 'fr', data: { code } });
    return {
      kind: 'sent',
      result: {
        status: 'OTP_REQUIRED',
        challengeId: challenge.id,
        emailHint: emailHint(user.email),
        resendAvailableAt: resendAvailableAt.toISOString(),
      },
    };
  }

  /**
   * `POST /v1/auth/forgot-password` : même réponse, et sans attendre l'envoi, que le compte existe ou non. Tout
   * compte actif reçoit un lien, y compris un compte sans mot de passe (administratrice initiale créée par le
   * seed, invitation expirée) : le lien n'arrive qu'à l'adresse du compte. Compte désactivé : rien n'est envoyé.
   */
  async forgotPassword(email: string, now: Date): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, name: true, isActive: true },
    });
    if (!user?.isActive) return;
    void this.links.sendPasswordReset(user, null, now).catch(() => {
      this.logger.error('Lien de réinitialisation non créé.');
    });
  }

  /** `POST /v1/auth/reset-password` : nouveau mot de passe ; sessions, appareils de confiance et codes révoqués. */
  async resetPassword(input: SetPasswordInput, now: Date): Promise<void> {
    const reset = await this.prisma.passwordReset.findUnique({
      where: { tokenHash: this.links.tokenHash('passwordReset', input.token) },
      select: { id: true, userId: true, expiresAt: true, usedAt: true },
    });
    if (!reset || reset.usedAt !== null || reset.expiresAt <= now) throw resetLinkExpiredException();
    const user = await this.prisma.user.findUnique({
      where: { id: reset.userId },
      select: { id: true, email: true, isActive: true, activatedAt: true },
    });
    if (!user?.isActive) throw resetLinkExpiredException();
    if (isCompromisedPassword(input.password, user.email)) throw compromisedPasswordException();

    const passwordHash = await this.passwords.hash(input.password);
    const claimed = await this.prisma.passwordReset.updateMany({
      where: { id: reset.id, usedAt: null },
      data: { usedAt: now },
    });
    if (claimed.count === 0) throw resetLinkExpiredException();
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        passwordChangedAt: now,
        failedLoginCount: 0,
        lockedUntil: null,
        activatedAt: user.activatedAt ?? now,
      },
    });
    await this.revokeCredentials(user.id, now);
  }

  /** Sessions, appareils de confiance et codes en cours d'un utilisateur révoqués. */
  async revokeCredentials(userId: string, now: Date): Promise<void> {
    await this.sessions.revokeAllForUser(userId, now);
    await this.prisma.trustedDevice.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now },
    });
    await this.prisma.otpChallenge.updateMany({
      where: { userId, consumedAt: null },
      data: { consumedAt: now },
    });
  }

  /** `POST /v1/auth/accept-invite` : premier mot de passe ; le compte devient actif (connexion ensuite). */
  async acceptInvite(input: SetPasswordInput, now: Date): Promise<void> {
    const invitation = await this.prisma.invitation.findUnique({
      where: { tokenHash: this.links.tokenHash('invitation', input.token) },
      select: { id: true, userId: true, expiresAt: true, acceptedAt: true, revokedAt: true },
    });
    if (
      !invitation ||
      invitation.acceptedAt !== null ||
      invitation.revokedAt !== null ||
      invitation.expiresAt <= now
    )
      throw invitationExpiredException();
    const user = await this.prisma.user.findUnique({
      where: { id: invitation.userId },
      select: { id: true, email: true, isActive: true, activatedAt: true },
    });
    if (!user?.isActive || user.activatedAt !== null) throw invitationExpiredException();
    if (isCompromisedPassword(input.password, user.email)) throw compromisedPasswordException();

    const passwordHash = await this.passwords.hash(input.password);
    const claimed = await this.prisma.invitation.updateMany({
      where: { id: invitation.id, acceptedAt: null, revokedAt: null },
      data: { acceptedAt: now },
    });
    if (claimed.count === 0) throw invitationExpiredException();
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        passwordChangedAt: now,
        activatedAt: now,
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });
  }
}
