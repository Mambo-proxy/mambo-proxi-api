import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { recordAudit, type AuditActor } from '../../common/audit/audit-log.js';
import { asObject } from '../../common/json/json-read.js';
import { notFoundException, ProblemException } from '../../common/problem/problem.js';
import { validationException } from '../../common/validation/validation-exception.js';
import { AppConfigService } from '../../config/app-config.service.js';
import type { CampaignStatus, Language, Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { MailQueueService } from '../mail/mail-queue.service.js';
import { MediaService } from '../media/media.service.js';
import { oneClickUnsubscribeUrl, unsubscribePageUrl } from '../newsletter/campaign.mapper.js';
import { CampaignDispatchService } from '../newsletter/campaign-dispatch.service.js';
import { htmlToText, sanitizeEmailHtml } from '../newsletter/email-html.js';
import { SETTING_KEYS } from '../settings/settings.constants.js';
import {
  articleAnchor,
  displayedDate,
  editionCampaignLabel,
  editionHasEnglish,
  editionLabel,
  effectiveStatus,
  MAGAZINE_EDITION_SELECT,
  type EditionNewsletter,
  type MagazineEditionRow,
} from './magazine.mapper.js';

export const EDITION_NOT_FOUND = 'Cette édition n’existe plus.';

/** Prénom des envois de test (comme les tests des campagnes). */
const SAMPLE_FIRST_NAME = 'Aurélie';
const EDITABLE: CampaignStatus[] = ['BROUILLON', 'PROGRAMMEE'];
const LANGUAGES: readonly Language[] = ['FR', 'EN'];

/** Schéma `MagazineCampaignStats`. */
export interface MagazineCampaignStats {
  editionId: string;
  editionLabel: string;
  sent: number;
  openRate: number | null;
  openRateDelta: number | null;
  clicks: number | null;
  newSubscribers: number;
}

/** Contenu d'un e-mail d'édition. */
interface EditionEmail {
  subject: string;
  preheader: string | null;
  html: string;
  text: string;
}

export function conflict(detail: string): ProblemException {
  return new ProblemException({ status: HttpStatus.CONFLICT, type: 'conflict', title: 'Conflit', detail });
}

const rate = (value: number, total: number): number => Math.round((value / total) * 1000) / 10;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Envoi des éditions du magazine par la newsletter : une campagne par langue (`Campaign.magazineEditionId`,
 * `language`), destinataires = inscrits confirmés de cette langue, envoyée par la même file que les autres
 * campagnes (`CampaignDispatchService`) et visible dans la liste des envois. Les inscrits anglophones reçoivent la
 * version française tant que l'édition n'est pas complète en anglais. Le contenu (édito signé, sommaire des articles
 * avec liens vers `/magazine#article-{id}`) est généré à la programmation et régénéré à chaque modification de
 * l'édition tant que les campagnes ne sont pas parties (`refresh`).
 */
@Injectable()
export class MagazineNewsletterService {
  private readonly logger = new Logger(MagazineNewsletterService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CampaignDispatchService) private readonly dispatch: CampaignDispatchService,
    @Inject(MailQueueService) private readonly mailQueue: MailQueueService,
    @Inject(MediaService) private readonly media: MediaService,
    @Inject(AppConfigService) private readonly config: AppConfigService,
  ) {}

  async tracking(): Promise<boolean> {
    const setting = await this.prisma.setting.findUnique({
      where: { key: SETTING_KEYS.analytics },
      select: { value: true },
    });
    return asObject(setting?.value)['newsletterTracking'] === true;
  }

  private async find(id: string): Promise<MagazineEditionRow> {
    const row = await this.prisma.magazineEdition.findUnique({
      where: { id },
      select: MAGAZINE_EDITION_SELECT,
    });
    if (!row) throw notFoundException(EDITION_NOT_FOUND);
    return row;
  }

  // ─────────────────────────── Contenu des e-mails ───────────────────────────

  private magazineUrl(lang: 'fr' | 'en', hash?: string): string {
    const base = this.config.get('WEB_URL').replace(/\/+$/, '');
    return `${base}${lang === 'en' ? '/en' : ''}/magazine${hash ? `#${hash}` : ''}`;
  }

  /** Liens relatifs du texte riche rendus absolus (l'e-mail est lu hors du site). */
  private absoluteLinks(html: string, lang: 'fr' | 'en'): string {
    const base = this.config.get('WEB_URL').replace(/\/+$/, '');
    return html
      .replace(/href="\/(?!\/)/g, `href="${base}${lang === 'en' ? '/en' : ''}/`)
      .replace(/href="#/g, `href="${this.magazineUrl(lang)}#`);
  }

  /** E-mail d'une édition dans une langue (champs anglais repliés sur le français un par un). */
  emailContent(row: MagazineEditionRow, lang: 'fr' | 'en'): EditionEmail {
    const en = lang === 'en';
    const pick = (fr: string | null, english: string | null): string | null =>
      en && english !== null && english.trim() !== '' ? english : fr;
    const title = pick(row.title, row.titleEn) ?? row.title;
    const subtitle = pick(row.subtitle, row.subtitleEn);
    const editorial = pick(row.editorial, row.editorialEn);
    const signature = pick(row.signature, row.signatureEn);
    const label = editionLabel(row.number, lang);
    const cover = this.media.image(row.cover);

    const parts: string[] = [`<h2>${escapeHtml(title)}</h2>`];
    if (subtitle) parts.push(`<p><em>${escapeHtml(subtitle)}</em></p>`);
    if (cover) parts.push(`<p><img src="${escapeHtml(cover.url)}" alt="${escapeHtml(cover.alt ?? '')}"></p>`);
    if (editorial) parts.push(this.absoluteLinks(editorial, lang));
    if (signature) parts.push(`<p><em>${escapeHtml(signature)}</em></p>`);
    if (row.articles.length > 0) {
      parts.push(`<h3>${en ? 'In this issue' : 'Au sommaire'}</h3>`);
      for (const article of row.articles) {
        const articleTitle = pick(article.title, article.titleEn) ?? article.title;
        const theme = pick(article.theme, article.themeEn) ?? article.theme;
        const excerpt = pick(article.excerpt, article.excerptEn);
        const href = this.magazineUrl(lang, articleAnchor(article.id));
        parts.push(
          `<h4><a href="${escapeHtml(href)}">${escapeHtml(articleTitle)}</a></h4>`,
          `<p><em>${escapeHtml(theme)}</em></p>`,
        );
        if (excerpt) parts.push(`<p>${escapeHtml(excerpt)}</p>`);
      }
    }
    parts.push(
      `<p><a data-button href="${escapeHtml(this.magazineUrl(lang))}">${en ? 'Read the magazine' : 'Lire le magazine'}</a></p>`,
    );
    const html = sanitizeEmailHtml(parts.join('\n'));
    return {
      subject: en
        ? `Mambo Proxi Magazine — ${label}: ${title}`
        : `Magazine Mambo Proxi — ${label} : ${title}`,
      preheader: subtitle ?? row.themes,
      html,
      text: htmlToText(html),
    };
  }

  /** Contenu de chaque campagne : l'anglais seulement si l'édition est complète en anglais. */
  private contents(row: MagazineEditionRow): Record<Language, EditionEmail> {
    const fr = this.emailContent(row, 'fr');
    return { FR: fr, EN: editionHasEnglish(row, row.articles) ? this.emailContent(row, 'en') : fr };
  }

  // ─────────────────────────── Lecture ───────────────────────────

  /** Inscrits confirmés par langue. */
  async subscribers(): Promise<{ fr: number; en: number }> {
    const [fr, en] = await Promise.all([
      this.prisma.subscriber.count({ where: { status: 'CONFIRME', language: 'FR' } }),
      this.prisma.subscriber.count({ where: { status: 'CONFIRME', language: 'EN' } }),
    ]);
    return { fr, en };
  }

  /**
   * Programmation et envoi : date de programmation la plus proche des campagnes programmées, date du dernier envoi
   * terminé ; sans campagne, les colonnes de l'édition (données de démonstration).
   */
  async state(
    row: Pick<MagazineEditionRow, 'id' | 'newsletterScheduledAt' | 'newsletterSentAt'>,
    subscribers?: { fr: number; en: number },
  ): Promise<EditionNewsletter> {
    const campaigns = await this.prisma.campaign.findMany({
      where: { magazineEditionId: row.id },
      select: { status: true, scheduledAt: true, sentAt: true },
    });
    const counts = subscribers ?? (await this.subscribers());
    if (campaigns.length === 0)
      return {
        subscribers: counts,
        scheduledAt: row.newsletterScheduledAt?.toISOString() ?? null,
        sentAt: row.newsletterSentAt?.toISOString() ?? null,
      };
    const scheduled = campaigns
      .filter((campaign) => campaign.status === 'PROGRAMMEE' && campaign.scheduledAt !== null)
      .map((campaign) => campaign.scheduledAt?.getTime() ?? 0);
    const sent = campaigns
      .filter((campaign) => campaign.status === 'ENVOYEE' && campaign.sentAt !== null)
      .map((campaign) => campaign.sentAt?.getTime() ?? 0);
    return {
      subscribers: counts,
      scheduledAt: scheduled.length > 0 ? new Date(Math.min(...scheduled)).toISOString() : null,
      sentAt: sent.length > 0 ? new Date(Math.max(...sent)).toISOString() : null,
    };
  }

  /** Lecteurs par édition : ouvertures des e-mails de l'édition (0 si la mesure est désactivée). */
  async readers(editionIds: readonly string[]): Promise<Map<string, number>> {
    const result = new Map<string, number>(editionIds.map((id) => [id, 0]));
    if (editionIds.length === 0) return result;
    const groups = await this.prisma.campaign.groupBy({
      by: ['magazineEditionId'],
      where: { magazineEditionId: { in: [...editionIds] } },
      _sum: { opens: true },
    });
    for (const group of groups)
      if (group.magazineEditionId !== null) result.set(group.magazineEditionId, group._sum.opens ?? 0);
    return result;
  }

  /** Statistiques de la dernière édition envoyée (`AdminMagazineOverview.lastCampaign`). */
  async lastCampaign(): Promise<MagazineCampaignStats | null> {
    const last = await this.prisma.campaign.findFirst({
      where: { status: 'ENVOYEE', magazineEditionId: { not: null } },
      orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
      select: {
        sentAt: true,
        magazineEdition: { select: { id: true, number: true, publishAt: true, publishedAt: true } },
      },
    });
    const edition = last?.magazineEdition;
    if (!last || !edition) return null;
    const [tracking, campaigns, all] = await Promise.all([
      this.tracking(),
      this.prisma.campaign.findMany({
        where: { magazineEditionId: edition.id, status: 'ENVOYEE' },
        select: { recipients: true, opens: true, clicks: true },
      }),
      this.prisma.campaign.findMany({
        where: { status: 'ENVOYEE', recipients: { gt: 0 } },
        select: { recipients: true, opens: true },
      }),
    ]);
    const sent = campaigns.reduce((total, item) => total + item.recipients, 0);
    const opens = campaigns.reduce((total, item) => total + (item.opens ?? 0), 0);
    const clicks = campaigns.reduce((total, item) => total + (item.clicks ?? 0), 0);
    const openRate = tracking && sent > 0 ? rate(opens, sent) : null;
    const average =
      all.length > 0
        ? all.reduce((total, item) => total + rate(item.opens ?? 0, item.recipients), 0) / all.length
        : null;
    const since = displayedDate(edition) ?? last.sentAt;
    const newSubscribers =
      since === null
        ? 0
        : await this.prisma.subscriber.count({ where: { status: 'CONFIRME', confirmedAt: { gte: since } } });
    return {
      editionId: edition.id,
      editionLabel: editionCampaignLabel(edition.number),
      sent,
      openRate,
      openRateDelta:
        openRate !== null && average !== null ? Math.round((openRate - average) * 10) / 10 : null,
      clicks: tracking ? clicks : null,
      newSubscribers,
    };
  }

  // ─────────────────────────── Écriture ───────────────────────────

  /** `POST /v1/admin/magazine/editions/{id}/newsletter/test` : une version par langue complète. */
  async test(id: string, email: string, actor: AuditActor): Promise<{ message: string }> {
    const row = await this.find(id);
    const langs: ('fr' | 'en')[] = editionHasEnglish(row, row.articles) ? ['fr', 'en'] : ['fr'];
    const webUrl = this.config.get('WEB_URL');
    const apiUrl = this.config.get('API_URL');
    await this.mailQueue.enqueueMany(
      langs.map((lang) => {
        const content = this.emailContent(row, lang);
        const data: Record<string, unknown> = {
          subject: `[Test] ${content.subject}`,
          html: content.html,
          text: content.text,
          firstName: SAMPLE_FIRST_NAME,
          unsubscribeUrl: unsubscribePageUrl(webUrl, lang, 'test'),
          oneClickUnsubscribeUrl: oneClickUnsubscribeUrl(apiUrl, 'test'),
        };
        if (content.preheader !== null) data['preheader'] = content.preheader;
        return { template: 'newsletter-campaign' as const, to: email, lang, data };
      }),
    );
    await recordAudit(this.prisma, actor, {
      action: 'magazine.newsletter-test',
      entity: 'MagazineEdition',
      entityId: id,
      // L'adresse de destination n'est pas inscrite au journal.
      label: `A envoyé un test de l’édition « ${row.title} » (${editionLabel(row.number)})`,
      after: { languages: langs },
    });
    return {
      message:
        langs.length === 2
          ? `E-mails de test (français et anglais) envoyés à ${email}.`
          : `E-mail de test envoyé à ${email}.`,
    };
  }

  /**
   * `POST /v1/admin/magazine/editions/{id}/newsletter/schedule` : date à venir ; édition publiée, ou programmée au
   * plus tard à la date d'envoi (409 sinon) ; campagnes déjà parties → 409. Une campagne par langue, créée ou
   * reprogrammée, puis tâche de départ dans la file des campagnes.
   */
  async schedule(id: string, scheduledAtIso: string, actor: AuditActor, now: Date): Promise<void> {
    const row = await this.find(id);
    const scheduledAt = new Date(scheduledAtIso);
    if (scheduledAt.getTime() <= now.getTime())
      throw validationException([
        { path: 'scheduledAt', code: 'in_the_past', message: 'Choisissez une date et une heure à venir.' },
      ]);
    const status = effectiveStatus(row, now);
    const ready =
      status === 'PUBLISHED' ||
      (status === 'SCHEDULED' && row.publishAt !== null && row.publishAt.getTime() <= scheduledAt.getTime());
    if (!ready) throw conflict('Publiez ou programmez l’édition avant la date d’envoi.');
    const campaigns = await this.prisma.campaign.findMany({
      where: { magazineEditionId: id, status: { not: 'ANNULEE' } },
      orderBy: { createdAt: 'asc' },
      select: { id: true, status: true, language: true },
    });
    if (campaigns.some((campaign) => !EDITABLE.includes(campaign.status)))
      throw conflict('Cette édition a déjà été envoyée par la newsletter.');
    const contents = this.contents(row);

    const ids = await this.prisma.$transaction(async (tx) => {
      const scheduled: string[] = [];
      for (const language of LANGUAGES) {
        const content = contents[language];
        const data = {
          subject: content.subject,
          preheader: content.preheader,
          html: content.html,
          text: content.text,
          status: 'PROGRAMMEE' as const,
          scheduledAt,
        };
        const existing = campaigns.find((campaign) => campaign.language === language);
        if (existing) {
          const claimed = await tx.campaign.updateMany({
            where: { id: existing.id, status: { in: EDITABLE } },
            data,
          });
          if (claimed.count === 0) throw conflict('Cette édition a déjà été envoyée par la newsletter.');
          scheduled.push(existing.id);
        } else {
          const created = await tx.campaign.create({
            data: {
              ...data,
              segmentKind: 'ALL',
              language,
              magazineEditionId: id,
              createdById: actor.userId,
            },
            select: { id: true },
          });
          scheduled.push(created.id);
        }
      }
      await tx.magazineEdition.update({
        where: { id },
        data: { newsletterScheduledAt: scheduledAt },
        select: { id: true },
      });
      await recordAudit(tx, actor, {
        action: 'magazine.newsletter-schedule',
        entity: 'MagazineEdition',
        entityId: id,
        label: `A programmé l’envoi de l’édition « ${row.title} » (${editionLabel(row.number)}) par la newsletter`,
        after: { scheduledAt: scheduledAt.toISOString(), campaigns: scheduled },
      });
      return scheduled;
    });
    for (const campaignId of ids) await this.dispatch.scheduleStart(campaignId, scheduledAt, now);
  }

  /** Dépublication : les campagnes programmées de l'édition repassent en brouillon (tâches ignorées au départ). */
  async cancelScheduled(tx: Prisma.TransactionClient, editionId: string): Promise<number> {
    const cancelled = await tx.campaign.updateMany({
      where: { magazineEditionId: editionId, status: 'PROGRAMMEE' },
      data: { status: 'BROUILLON', scheduledAt: null },
    });
    await tx.magazineEdition.update({
      where: { id: editionId },
      data: { newsletterScheduledAt: null },
      select: { id: true },
    });
    return cancelled.count;
  }

  /**
   * Contenu des campagnes non parties régénéré après une modification de l'édition ou de ses articles. Sans effet
   * sur l'enregistrement s'il échoue (journalisé) : la campagne garde son contenu précédent.
   */
  async refresh(...editionIds: (string | null | undefined)[]): Promise<void> {
    for (const id of new Set(editionIds)) {
      if (!id) continue;
      try {
        const campaigns = await this.prisma.campaign.findMany({
          where: { magazineEditionId: id, status: { in: EDITABLE } },
          select: { id: true, language: true },
        });
        if (campaigns.length === 0) continue;
        const row = await this.prisma.magazineEdition.findUnique({
          where: { id },
          select: MAGAZINE_EDITION_SELECT,
        });
        if (!row) continue;
        const contents = this.contents(row);
        for (const campaign of campaigns) {
          const content = contents[campaign.language ?? 'FR'];
          await this.prisma.campaign.updateMany({
            where: { id: campaign.id, status: { in: EDITABLE } },
            data: {
              subject: content.subject,
              preheader: content.preheader,
              html: content.html,
              text: content.text,
            },
          });
        }
      } catch (error) {
        this.logger.warn(
          `Contenu des envois de l’édition ${id} non régénéré : ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
}
