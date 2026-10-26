import { Inject, Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { signAccessToken, verifyAccessToken } from './access-token.js';
import type { SessionCookies } from './auth-cookies.service.js';
import {
  ACCESS_TOKEN_TTL_MS,
  ACTIVITY_WRITE_INTERVAL_MS,
  REFRESH_REUSE_GRACE_MS,
  REMEMBER_ME_SESSION_TTL_MS,
  SESSION_TTL_MS,
} from './auth.constants.js';
import { AUTH_USER_SELECT, type AuthContext, type AuthUser, type ClientInfo } from './auth.types.js';
import { permissionsOf } from './permissions.js';
import { TOKEN_PURPOSES, hmacDigest, randomToken, safeEqual } from './tokens.js';

/** Résultat d'un rafraîchissement : nouveaux cookies, réutilisation tolérée (aucun cookie) ou refus. */
export type RefreshOutcome =
  { kind: 'rotated'; cookies: SessionCookies } | { kind: 'concurrent' } | { kind: 'rejected' };

const SESSION_SELECT = {
  id: true,
  userId: true,
  rememberMe: true,
  trustedDeviceId: true,
  lastActiveAt: true,
  expiresAt: true,
  revokedAt: true,
  replacedById: true,
} as const;

/**
 * Sessions du back-office : ouverture (jetons d'accès, de rafraîchissement et CSRF), vérification de chaque
 * requête, rotation du jeton de rafraîchissement avec détection de réutilisation, révocation.
 *
 * Chaque rotation crée une nouvelle ligne `sessions` (l'ancienne est révoquée et pointe sur la suivante par
 * `replacedById`). Un jeton déjà remplacé présenté de nouveau (vol probable) révoque toutes les sessions de
 * l'utilisateur, sauf dans les 10 s qui suivent la rotation (requêtes simultanées de deux onglets).
 */
@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AppConfigService) private readonly config: AppConfigService,
  ) {}

  private refreshHash(token: string): string {
    return hmacDigest(this.config.get('JWT_REFRESH_SECRET'), TOKEN_PURPOSES.refresh, token);
  }

  /**
   * Jeton CSRF « double-submit » signé : `<aléa>.<HMAC(utilisateur, aléa)>`. Lié à l'utilisateur, il reste valable
   * après une rotation ; un cookie planté par un tiers (autre compte, valeur inventée) est refusé.
   */
  issueCsrfToken(userId: string): string {
    const nonce = randomToken();
    return `${nonce}.${hmacDigest(this.config.get('TOKEN_SIGNING_SECRET'), TOKEN_PURPOSES.csrf, `${userId}:${nonce}`)}`;
  }

  /** En-tête et cookie identiques, et signature valable pour l'utilisateur de la session. */
  verifyCsrfToken(userId: string, header: string | undefined, cookie: string | undefined): boolean {
    if (!header || !cookie || !safeEqual(header, cookie)) return false;
    const [nonce, mac, ...rest] = cookie.split('.');
    if (!nonce || !mac || rest.length > 0) return false;
    const expected = hmacDigest(
      this.config.get('TOKEN_SIGNING_SECRET'),
      TOKEN_PURPOSES.csrf,
      `${userId}:${nonce}`,
    );
    return safeEqual(mac, expected);
  }

  private cookiesFor(
    session: { id: string; userId: string; expiresAt: Date; rememberMe: boolean },
    refreshToken: string,
    now: Date,
  ): SessionCookies {
    return {
      accessToken: signAccessToken(
        this.config.get('JWT_ACCESS_SECRET'),
        { sub: session.userId, sid: session.id },
        now,
        ACCESS_TOKEN_TTL_MS,
      ),
      refreshToken,
      csrfToken: this.issueCsrfToken(session.userId),
      expiresAt: session.expiresAt,
      rememberMe: session.rememberMe,
    };
  }

  /** Ouvre une session (après mot de passe + code, ou mot de passe sur un appareil de confiance). */
  async open(
    userId: string,
    options: { rememberMe: boolean; trustedDeviceId: string | null; client: ClientInfo },
    now: Date,
  ): Promise<SessionCookies> {
    const refreshToken = randomToken();
    const session = await this.prisma.session.create({
      data: {
        userId,
        refreshTokenHash: this.refreshHash(refreshToken),
        rememberMe: options.rememberMe,
        trustedDeviceId: options.trustedDeviceId,
        userAgent: options.client.userAgent,
        ip: options.client.ip,
        lastActiveAt: now,
        expiresAt: new Date(
          now.getTime() + (options.rememberMe ? REMEMBER_ME_SESSION_TTL_MS : SESSION_TTL_MS),
        ),
        revokedAt: null,
        replacedById: null,
      },
      select: { id: true, userId: true, expiresAt: true, rememberMe: true },
    });
    return this.cookiesFor(session, refreshToken, now);
  }

  /**
   * Vérifie le jeton d'accès, la session (non révoquée, non expirée) et l'utilisateur (actif). Écrit l'activité au
   * plus une fois par minute et par session (présence de l'équipe).
   */
  async authenticate(accessToken: string | undefined, now: Date): Promise<AuthContext | null> {
    if (!accessToken) return null;
    const claims = verifyAccessToken(this.config.get('JWT_ACCESS_SECRET'), accessToken, now);
    if (!claims) return null;
    const session = await this.prisma.session.findUnique({
      where: { id: claims.sid },
      select: SESSION_SELECT,
    });
    if (!session || session.userId !== claims.sub || session.revokedAt !== null || session.expiresAt <= now)
      return null;
    const user = await this.findActiveUser(session.userId);
    if (!user) return null;

    if (
      session.lastActiveAt === null ||
      now.getTime() - session.lastActiveAt.getTime() >= ACTIVITY_WRITE_INTERVAL_MS
    ) {
      await this.prisma.session.update({ where: { id: session.id }, data: { lastActiveAt: now } });
      await this.prisma.user.update({ where: { id: user.id }, data: { lastActiveAt: now } });
      user.lastActiveAt = now;
    }
    return { user, sessionId: session.id, permissions: permissionsOf(user.role) };
  }

  private async findActiveUser(userId: string): Promise<AuthUser | null> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: AUTH_USER_SELECT });
    return user && user.isActive && user.activatedAt !== null ? user : null;
  }

  /** `POST /v1/auth/refresh` : rotation du jeton de rafraîchissement. */
  async refresh(refreshToken: string | undefined, client: ClientInfo, now: Date): Promise<RefreshOutcome> {
    if (!refreshToken) return { kind: 'rejected' };
    const current = await this.prisma.session.findUnique({
      where: { refreshTokenHash: this.refreshHash(refreshToken) },
      select: SESSION_SELECT,
    });
    if (!current) return { kind: 'rejected' };

    if (current.revokedAt !== null) {
      // Révoquée sans remplaçante (déconnexion, désactivation, mot de passe changé) : refus, sans délai de grâce.
      if (current.replacedById !== null) {
        if (now.getTime() - current.revokedAt.getTime() < REFRESH_REUSE_GRACE_MS)
          return { kind: 'concurrent' };
        // Jeton déjà échangé, présenté de nouveau : toutes les sessions de l'utilisateur sont révoquées.
        const { count } = await this.revokeAllForUser(current.userId, now);
        this.logger.warn(
          `Réutilisation d'un jeton de rafraîchissement remplacé (session ${current.id}) : ${String(count)} session(s) révoquée(s).`,
        );
      }
      return { kind: 'rejected' };
    }
    if (current.expiresAt <= now) return { kind: 'rejected' };
    if (!(await this.findActiveUser(current.userId))) {
      await this.revoke(current.id, now);
      return { kind: 'rejected' };
    }

    const nextToken = randomToken();
    return this.prisma.$transaction(async (tx) => {
      // Réservation atomique : une seule rotation par jeton, même pour deux requêtes simultanées.
      const claimed = await tx.session.updateMany({
        where: { id: current.id, revokedAt: null },
        data: { revokedAt: now },
      });
      if (claimed.count === 0) return { kind: 'concurrent' } as const;
      const next = await tx.session.create({
        data: {
          userId: current.userId,
          refreshTokenHash: this.refreshHash(nextToken),
          rememberMe: current.rememberMe,
          trustedDeviceId: current.trustedDeviceId,
          userAgent: client.userAgent,
          ip: client.ip,
          lastActiveAt: current.lastActiveAt,
          // La durée de vie est fixée à la connexion : la rotation ne la prolonge pas.
          expiresAt: current.expiresAt,
          revokedAt: null,
          replacedById: null,
        },
        select: { id: true, userId: true, expiresAt: true, rememberMe: true },
      });
      await tx.session.update({ where: { id: current.id }, data: { replacedById: next.id } });
      return { kind: 'rotated', cookies: this.cookiesFor(next, nextToken, now) } as const;
    });
  }

  /** Session ouverte désignée par un jeton de rafraîchissement (déconnexion avec un jeton d'accès expiré). */
  async findByRefreshToken(
    refreshToken: string | undefined,
    now: Date,
  ): Promise<{ id: string; userId: string } | null> {
    if (!refreshToken) return null;
    const session = await this.prisma.session.findUnique({
      where: { refreshTokenHash: this.refreshHash(refreshToken) },
      select: SESSION_SELECT,
    });
    if (!session || session.revokedAt !== null || session.expiresAt <= now) return null;
    return { id: session.id, userId: session.userId };
  }

  async revoke(sessionId: string, now: Date): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: now },
    });
  }

  /** Révoque toutes les sessions ouvertes d'un utilisateur (mot de passe changé, compte désactivé, vol de jeton). */
  revokeAllForUser(userId: string, now: Date): Promise<{ count: number }> {
    return this.prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } });
  }
}
