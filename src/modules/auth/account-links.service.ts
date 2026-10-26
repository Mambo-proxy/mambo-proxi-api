import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Role } from '../../generated/prisma/client.js';
import { AppConfigService } from '../../config/app-config.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { MailQueueService } from '../mail/mail-queue.service.js';
import type { MailJob } from '../mail/mail.types.js';
import { INVITATION_TTL_MS, PASSWORD_RESET_TTL_MS, WEB_PATHS } from './auth.constants.js';
import { TOKEN_PURPOSES, hmacDigest, randomToken } from './tokens.js';
import { userFirstName } from './user-identity.js';

/** Destinataire d'un lien (invitation, réinitialisation). */
export interface LinkRecipient {
  id: string;
  email: string;
  name: string;
}

/**
 * Liens à usage unique envoyés par e-mail : réinitialisation du mot de passe (1 h) et invitation au back-office
 * (7 jours). Le jeton n'apparaît que dans l'e-mail ; la base garde son condensat. Un nouveau lien annule les
 * précédents du même type.
 */
@Injectable()
export class AccountLinksService {
  private readonly logger = new Logger(AccountLinksService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AppConfigService) private readonly config: AppConfigService,
    @Inject(MailQueueService) private readonly mail: MailQueueService,
  ) {}

  tokenHash(purpose: 'passwordReset' | 'invitation', token: string): string {
    return hmacDigest(this.config.get('TOKEN_SIGNING_SECRET'), TOKEN_PURPOSES[purpose], token);
  }

  private link(path: string, token: string): string {
    const url = new URL(path, this.config.get('WEB_URL'));
    url.searchParams.set('token', token);
    return url.toString();
  }

  /** Crée un lien de réinitialisation et l'envoie (`password-reset`). `requestedBy` : administrateur à l'origine. */
  async sendPasswordReset(user: LinkRecipient, requestedBy: string | null, now: Date): Promise<void> {
    const token = randomToken();
    await this.prisma.passwordReset.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: now },
    });
    await this.prisma.passwordReset.create({
      data: {
        userId: user.id,
        tokenHash: this.tokenHash('passwordReset', token),
        requestedBy,
        expiresAt: new Date(now.getTime() + PASSWORD_RESET_TTL_MS),
        usedAt: null,
      },
      select: { id: true },
    });
    await this.send({
      template: 'password-reset',
      to: user.email,
      lang: 'fr',
      data: { firstName: userFirstName(user.name), actionUrl: this.link(WEB_PATHS.resetPassword, token) },
    });
  }

  /** Crée une invitation et l'envoie (`user-invite`) ; les invitations encore ouvertes sont révoquées. */
  async sendInvitation(
    user: LinkRecipient,
    role: Role,
    invitedById: string | null,
    now: Date,
  ): Promise<void> {
    const token = randomToken();
    await this.prisma.invitation.updateMany({
      where: { userId: user.id, acceptedAt: null, revokedAt: null },
      data: { revokedAt: now },
    });
    await this.prisma.invitation.create({
      data: {
        userId: user.id,
        role,
        tokenHash: this.tokenHash('invitation', token),
        invitedById,
        expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
        acceptedAt: null,
        revokedAt: null,
      },
      select: { id: true },
    });
    await this.send({
      template: 'user-invite',
      to: user.email,
      lang: 'fr',
      data: { firstName: userFirstName(user.name), actionUrl: this.link(WEB_PATHS.acceptInvite, token) },
    });
  }

  /** Mise en file ; un échec est journalisé (sans adresse) sans faire échouer l'opération déjà enregistrée. */
  async send(job: MailJob): Promise<void> {
    try {
      await this.mail.enqueue(job);
    } catch {
      this.logger.error(`E-mail « ${job.template} » non mis en file.`);
    }
  }
}
