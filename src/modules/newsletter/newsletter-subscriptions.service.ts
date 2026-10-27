import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { AntiSpamService } from '../../common/anti-spam/anti-spam.service.js';
import { DAY_MS } from '../../common/time/agency-day.js';
import { ProblemException } from '../../common/problem/problem.js';
import type { Lang } from '../../common/i18n/lang.js';
import { AppConfigService } from '../../config/app-config.service.js';
import type { Language, SubscriberSource } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { MailQueueService } from '../mail/mail-queue.service.js';
import { firstNameOf } from './campaign.mapper.js';
import {
  CONFIRM_TOKEN_PATTERN,
  CONFIRM_VALIDITY_DAYS,
  confirmTokenHash,
  newConfirmToken,
  readUnsubscribeToken,
} from './newsletter-token.js';
import type { SubscriptionInput, SubscriptionSource } from './newsletter.schemas.js';

/** Réponse `202` de `POST /v1/newsletter/subscriptions`. */
export interface SubscriptionAccepted {
  message: string;
  alreadySubscribed: boolean;
}

export interface SubscriptionMeta {
  ip?: string;
  lang: Lang;
}

const SUBSCRIBED_MESSAGE: Record<Lang, string> = {
  fr: 'Merci ! Confirmez votre inscription dans l’e-mail que nous venons de vous envoyer.',
  en: 'Thank you! Please confirm your subscription in the e-mail we have just sent you.',
};
const CONFIRMED_MESSAGE: Record<Lang, string> = {
  fr: 'Votre inscription à la newsletter est confirmée. À très vite !',
  en: 'Your newsletter subscription is confirmed. See you soon!',
};
const UNSUBSCRIBED_MESSAGE: Record<Lang, string> = {
  fr: 'Vous êtes bien désinscrit·e. Vous ne recevrez plus notre newsletter.',
  en: 'You have been unsubscribed. You will no longer receive our newsletter.',
};

const SOURCES: Record<SubscriptionSource, SubscriberSource> = {
  footer: 'FOOTER',
  'suivi-mambo': 'SUIVI_MAMBO',
  inscription: 'INSCRIPTION',
  autre: 'AUTRE',
};

const MAX_TAGS = 20;

function confirmExpiredException(): ProblemException {
  return new ProblemException({
    status: HttpStatus.GONE,
    type: 'link-expired',
    title: 'Lien expiré',
    detail: 'Ce lien de confirmation a expiré. Inscrivez-vous à nouveau depuis le pied de page.',
  });
}

function unsubscribeInvalidException(): ProblemException {
  return new ProblemException({
    status: HttpStatus.GONE,
    type: 'link-invalid',
    title: 'Lien invalide',
    detail: 'Ce lien de désinscription n’est pas valide.',
  });
}

function langOf(language: Language): Lang {
  return language === 'EN' ? 'en' : 'fr';
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Newsletter côté site (tag « Newsletter » du contrat), en double opt-in :
 * - inscription : abonnement « en attente » avec le consentement horodaté, lien de confirmation à usage unique
 *   (condensat en base, valable 7 jours) envoyé par l'e-mail `newsletter-confirm`. Même réponse pour une adresse
 *   déjà en attente ou désinscrite (nouveau lien) ; une adresse déjà confirmée ne reçoit rien
 *   (`alreadySubscribed: true`) ;
 * - confirmation : `EN_ATTENTE` → `CONFIRME` ; lien inconnu, déjà utilisé ou expiré → 410 ;
 * - désinscription en un clic : jeton signé des e-mails (`List-Unsubscribe` + `List-Unsubscribe-Post`, RFC 8058),
 *   idempotente ; comptée dans les statistiques de la campagne d'origine.
 * Aucun e-mail ni nom dans les journaux.
 */
@Injectable()
export class NewsletterSubscriptionsService {
  private readonly logger = new Logger(NewsletterSubscriptionsService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AntiSpamService) private readonly antiSpam: AntiSpamService,
    @Inject(MailQueueService) private readonly mailQueue: MailQueueService,
    @Inject(AppConfigService) private readonly config: AppConfigService,
  ) {}

  /** `POST /v1/newsletter/subscriptions` */
  async subscribe(
    input: SubscriptionInput,
    meta: SubscriptionMeta,
    now: Date,
  ): Promise<SubscriptionAccepted> {
    const accepted = { message: SUBSCRIBED_MESSAGE[meta.lang], alreadySubscribed: false };
    if ((await this.antiSpam.check(input.antiSpam, meta.ip, now)) === 'trapped') {
      this.logger.log('Inscription à la newsletter ignorée (champ piège rempli).');
      return accepted;
    }
    const existing = await this.prisma.subscriber.findUnique({
      where: { email: input.email },
      select: { id: true, status: true, tags: true, contactId: true, name: true },
    });
    const tags = [...new Set([...(existing?.tags ?? []), ...input.tags])].slice(0, MAX_TAGS);
    if (existing?.status === 'CONFIRME') {
      if (tags.length !== existing.tags.length)
        await this.prisma.subscriber.update({
          where: { id: existing.id },
          data: { tags },
          select: { id: true },
        });
      return { ...accepted, alreadySubscribed: true };
    }

    const contact = await this.prisma.contact.findUnique({
      where: { email: input.email },
      select: { id: true, anonymizedAt: true, subscriber: { select: { id: true } } },
    });
    const contactId =
      existing?.contactId ??
      (contact && contact.anonymizedAt === null && contact.subscriber === null ? contact.id : null);
    const token = newConfirmToken();
    const pending = {
      status: 'EN_ATTENTE' as const,
      name: input.name ?? existing?.name ?? null,
      phone: input.phone,
      language: meta.lang === 'en' ? ('EN' as const) : ('FR' as const),
      source: SOURCES[input.source],
      tags,
      consentAt: now,
      confirmTokenHash: confirmTokenHash(this.secret(), token),
      confirmTokenExpires: new Date(now.getTime() + CONFIRM_VALIDITY_DAYS * DAY_MS),
      unsubscribedAt: null,
      contactId,
    };
    const saved = existing
      ? await this.prisma.subscriber.update({
          where: { id: existing.id },
          data: pending,
          select: { name: true },
        })
      : await this.prisma.subscriber.create({
          data: { ...pending, email: input.email },
          select: { name: true },
        });
    await this.sendConfirmMail(input.email, meta.lang, token, saved.name);
    return accepted;
  }

  /**
   * Confirmation demandée par un autre formulaire (inscription avec la case « newsletter ») : l'abonnement est déjà
   * « en attente » (`ContactsService.prepareNewsletter`) ; un nouveau lien est émis et envoyé. Sans effet pour une
   * adresse qui n'est pas en attente. N'échoue jamais (l'envoi du formulaire est déjà enregistré).
   */
  async sendPendingConfirmation(email: string, now: Date): Promise<void> {
    try {
      const subscriber = await this.prisma.subscriber.findUnique({
        where: { email: email.trim().toLowerCase() },
        select: { id: true, status: true, language: true, name: true, email: true },
      });
      if (subscriber?.status !== 'EN_ATTENTE') return;
      const token = newConfirmToken();
      await this.prisma.subscriber.update({
        where: { id: subscriber.id },
        data: {
          confirmTokenHash: confirmTokenHash(this.secret(), token),
          confirmTokenExpires: new Date(now.getTime() + CONFIRM_VALIDITY_DAYS * DAY_MS),
        },
        select: { id: true },
      });
      await this.sendConfirmMail(subscriber.email, langOf(subscriber.language), token, subscriber.name);
    } catch (error) {
      this.logger.error(`Confirmation de la newsletter non envoyée (${messageOf(error)}).`);
    }
  }

  /** `POST /v1/newsletter/confirm` */
  async confirm(token: string, now: Date): Promise<{ message: string }> {
    if (!CONFIRM_TOKEN_PATTERN.test(token)) throw confirmExpiredException();
    const subscriber = await this.prisma.subscriber.findUnique({
      where: { confirmTokenHash: confirmTokenHash(this.secret(), token) },
      select: { id: true, status: true, confirmTokenExpires: true, language: true },
    });
    if (
      subscriber?.status !== 'EN_ATTENTE' ||
      subscriber.confirmTokenExpires === null ||
      subscriber.confirmTokenExpires.getTime() <= now.getTime()
    )
      throw confirmExpiredException();
    const claimed = await this.prisma.subscriber.updateMany({
      where: { id: subscriber.id, status: 'EN_ATTENTE' },
      data: {
        status: 'CONFIRME',
        confirmedAt: now,
        unsubscribedAt: null,
        confirmTokenHash: null,
        confirmTokenExpires: null,
      },
    });
    if (claimed.count === 0) throw confirmExpiredException();
    return { message: CONFIRMED_MESSAGE[langOf(subscriber.language)] };
  }

  /** `POST /v1/newsletter/unsubscribe` : idempotente (un abonné déjà désinscrit reçoit la même réponse). */
  async unsubscribe(token: string | undefined, now: Date): Promise<{ message: string }> {
    const claim = token ? readUnsubscribeToken(this.secret(), token) : null;
    if (claim === null) throw unsubscribeInvalidException();
    const subscriber = await this.prisma.subscriber.findUnique({
      where: { id: claim.subscriberId },
      select: { id: true, status: true, language: true },
    });
    if (subscriber === null) throw unsubscribeInvalidException();
    if (subscriber.status !== 'DESINSCRIT') {
      await this.prisma.$transaction(async (tx) => {
        const changed = await tx.subscriber.updateMany({
          where: { id: subscriber.id, status: { not: 'DESINSCRIT' } },
          data: {
            status: 'DESINSCRIT',
            unsubscribedAt: now,
            confirmTokenHash: null,
            confirmTokenExpires: null,
          },
        });
        if (changed.count > 0 && claim.campaignId !== null && subscriber.status === 'CONFIRME')
          await tx.campaign.updateMany({
            where: { id: claim.campaignId },
            data: { unsubscribes: { increment: 1 } },
          });
      });
      this.logger.log('Désinscription de la newsletter enregistrée.');
    }
    return { message: UNSUBSCRIBED_MESSAGE[langOf(subscriber.language)] };
  }

  private secret(): string {
    return this.config.get('TOKEN_SIGNING_SECRET');
  }

  /** Lien de la page de confirmation du site (`/newsletter/confirmation`, anglais sous `/en`). */
  private confirmUrl(lang: Lang, token: string): string {
    const base = this.config.get('WEB_URL').replace(/\/+$/, '');
    return `${base}${lang === 'en' ? '/en' : ''}/newsletter/confirmation?token=${encodeURIComponent(token)}`;
  }

  private async sendConfirmMail(
    email: string,
    lang: Lang,
    token: string,
    name: string | null,
  ): Promise<void> {
    const data: Record<string, string> = { actionUrl: this.confirmUrl(lang, token) };
    const firstName = firstNameOf(name);
    if (firstName !== undefined) data['firstName'] = firstName;
    try {
      await this.mailQueue.enqueue({ template: 'newsletter-confirm', to: email, lang, data });
    } catch (error) {
      this.logger.error(`E-mail de confirmation de la newsletter non mis en file (${messageOf(error)}).`);
    }
  }
}
