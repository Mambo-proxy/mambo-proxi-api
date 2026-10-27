import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { recordAudit, type AuditActor } from '../../common/audit/audit-log.js';
import { asObject } from '../../common/json/json-read.js';
import { notFoundException, ProblemException, type ProblemFieldError } from '../../common/problem/problem.js';
import { DAY_MS } from '../../common/time/agency-day.js';
import { validationException } from '../../common/validation/validation-exception.js';
import { AppConfigService } from '../../config/app-config.service.js';
import type { CampaignSegmentKind, CampaignStatus, Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { MailContentService } from '../mail/mail-content.service.js';
import { MailQueueService } from '../mail/mail-queue.service.js';
import { renderMail } from '../mail/render-mail.js';
import { SETTING_KEYS } from '../settings/settings.constants.js';
import { CampaignDispatchService } from './campaign-dispatch.service.js';
import {
  CAMPAIGN_SELECT,
  isEditable,
  oneClickUnsubscribeUrl,
  segmentLabel,
  segmentWhere,
  toCampaign,
  toSegment,
  unsubscribePageUrl,
  type Campaign,
  type CampaignRow,
  type CampaignSegment,
} from './campaign.mapper.js';
import { htmlToText, sanitizeEmailHtml } from './email-html.js';
import type {
  CampaignInput,
  CampaignPatch,
  CampaignScheduleInput,
  CampaignTestInput,
} from './newsletter.schemas.js';

export const CAMPAIGN_NOT_FOUND = 'Cet envoi n’existe plus.';
/** Objet d'un brouillon créé sans objet (le panneau « Nouvel envoi » enregistre au fil de la saisie). */
export const UNTITLED_SUBJECT = 'Brouillon sans titre';
/** Prénom des aperçus et des envois de test. */
const SAMPLE_FIRST_NAME = 'Aurélie';
/** Segments par étiquette proposés au plus. */
const MAX_TAG_SEGMENTS = 20;

const STATUS_LABELS: Record<CampaignStatus, string> = {
  BROUILLON: 'Brouillon',
  PROGRAMMEE: 'Programmée',
  EN_COURS_ENVOI: 'En cours d’envoi',
  ENVOYEE: 'Envoyée',
  ANNULEE: 'Annulée',
};

/** Schéma `EmailPreview` du contrat. */
export interface EmailPreview {
  subject: string;
  html: string;
  text: string;
}

/** Schéma `NewsletterStats` du contrat (taux en pourcentage, une décimale). */
export interface NewsletterStats {
  subscribers: number;
  newThisMonth: number;
  campaignsSent: number;
  averageOpenRate: number | null;
  averageClickRate: number | null;
  unsubscribeRate: number | null;
  lastOpenRateDelta: number | null;
}

export interface SegmentCount {
  segment: CampaignSegment;
  label: string;
  count: number;
}

function conflict(detail: string): ProblemException {
  return new ProblemException({ status: HttpStatus.CONFLICT, type: 'conflict', title: 'Conflit', detail });
}

const rate = (value: number, total: number): number => Math.round((value / total) * 1000) / 10;

/** Objet et contenu exigés avant la programmation ou l'envoi. */
function contentErrors(row: Pick<CampaignRow, 'subject' | 'html'>): ProblemFieldError[] {
  const errors: ProblemFieldError[] = [];
  if (row.subject.trim() === '' || row.subject === UNTITLED_SUBJECT)
    errors.push({ path: 'subject', code: 'required_to_send', message: 'Renseignez l’objet de l’e-mail.' });
  if (htmlToText(row.html) === '' && !/<img\s/i.test(row.html))
    errors.push({ path: 'html', code: 'required_to_send', message: 'Rédigez le contenu de l’e-mail.' });
  return errors;
}

/**
 * Campagnes de la newsletter du back-office (tag « Admin — Newsletter ») : liste et indicateurs, segments et nombre
 * de destinataires, brouillon (HTML assaini, version texte générée), modification tant que la campagne n'est pas
 * partie (409 sinon), aperçu du rendu réel, envoi de test, programmation, annulation (retour au brouillon), envoi
 * immédiat par lots (`CampaignDispatchService`). Mesure d'ouverture et de clic : `opens` / `clicks` à `null` tant
 * que l'option `analytics.newsletterTracking` des paramètres est désactivée.
 */
@Injectable()
export class AdminCampaignsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CampaignDispatchService) private readonly dispatch: CampaignDispatchService,
    @Inject(MailQueueService) private readonly mailQueue: MailQueueService,
    @Inject(MailContentService) private readonly content: MailContentService,
    @Inject(AppConfigService) private readonly config: AppConfigService,
  ) {}

  private async tracking(): Promise<boolean> {
    const setting = await this.prisma.setting.findUnique({
      where: { key: SETTING_KEYS.analytics },
      select: { value: true },
    });
    return asObject(setting?.value)['newsletterTracking'] === true;
  }

  private countSegment(kind: CampaignSegmentKind, tags: readonly string[]): Promise<number> {
    return this.prisma.subscriber.count({ where: segmentWhere(kind, tags) });
  }

  private async toCampaign(row: CampaignRow, tracking?: boolean): Promise<Campaign> {
    const estimate =
      row.status === 'PROGRAMMEE' ? await this.countSegment(row.segmentKind, row.segmentTags) : undefined;
    return toCampaign(row, tracking ?? (await this.tracking()), estimate);
  }

  private async find(id: string): Promise<CampaignRow> {
    const row = await this.prisma.campaign.findUnique({ where: { id }, select: CAMPAIGN_SELECT });
    if (!row) throw notFoundException(CAMPAIGN_NOT_FOUND);
    return row;
  }

  /** `GET /v1/admin/campaigns` : programmées, puis parties (de la plus récente), puis brouillons. */
  async list(now: Date): Promise<{ data: Campaign[]; stats: NewsletterStats }> {
    const tracking = await this.tracking();
    const rows = await this.prisma.campaign.findMany({ select: CAMPAIGN_SELECT });
    const rank = (status: CampaignStatus): number =>
      status === 'PROGRAMMEE' ? 0 : status === 'EN_COURS_ENVOI' ? 1 : status === 'BROUILLON' ? 3 : 2;
    rows.sort(
      (a, b) =>
        rank(a.status) - rank(b.status) ||
        (b.sentAt ?? b.scheduledAt ?? b.updatedAt).getTime() -
          (a.sentAt ?? a.scheduledAt ?? a.updatedAt).getTime() ||
        a.id.localeCompare(b.id),
    );
    const estimates = new Map<string, number>();
    for (const row of rows) {
      if (row.status !== 'PROGRAMMEE') continue;
      const key = `${row.segmentKind}:${row.segmentTags.join(',')}`;
      if (!estimates.has(key)) estimates.set(key, await this.countSegment(row.segmentKind, row.segmentTags));
    }
    const data = rows.map((row) =>
      toCampaign(row, tracking, estimates.get(`${row.segmentKind}:${row.segmentTags.join(',')}`)),
    );
    return { data, stats: await this.stats(tracking, now) };
  }

  private async stats(tracking: boolean, now: Date): Promise<NewsletterStats> {
    const [subscribers, newThisMonth, sent] = await Promise.all([
      this.prisma.subscriber.count({ where: { status: 'CONFIRME' } }),
      this.prisma.subscriber.count({
        where: { status: 'CONFIRME', confirmedAt: { gte: new Date(now.getTime() - 30 * DAY_MS) } },
      }),
      this.prisma.campaign.findMany({
        where: { status: 'ENVOYEE', recipients: { gt: 0 } },
        orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
        select: { recipients: true, opens: true, clicks: true, unsubscribes: true },
      }),
    ]);
    const recipients = sent.reduce((total, item) => total + item.recipients, 0);
    const average = (pick: (item: (typeof sent)[number]) => number | null): number | null => {
      if (!tracking || sent.length === 0) return null;
      const rates = sent.map((item) => rate(pick(item) ?? 0, item.recipients));
      return Math.round((rates.reduce((total, value) => total + value, 0) / rates.length) * 10) / 10;
    };
    const [last, previous] = sent;
    const lastOpenRateDelta =
      tracking && last !== undefined && previous !== undefined
        ? Math.round(
            (rate(last.opens ?? 0, last.recipients) - rate(previous.opens ?? 0, previous.recipients)) * 10,
          ) / 10
        : null;
    return {
      subscribers,
      newThisMonth,
      campaignsSent: await this.prisma.campaign.count({ where: { status: 'ENVOYEE' } }),
      averageOpenRate: average((item) => item.opens),
      averageClickRate: average((item) => item.clicks),
      unsubscribeRate:
        recipients === 0
          ? null
          : rate(
              sent.reduce((total, item) => total + item.unsubscribes, 0),
              recipients,
            ),
      lastOpenRateDelta,
    };
  }

  /** `GET /v1/admin/campaigns/segments` : segments fixes, puis un segment par étiquette des abonnés confirmés. */
  async segments(): Promise<SegmentCount[]> {
    const fixed: CampaignSegmentKind[] = ['ALL', 'FRANCE', 'CAMEROUN', 'PROFESSIONNELS'];
    const result: SegmentCount[] = [];
    for (const kind of fixed)
      result.push({
        segment: toSegment(kind, []),
        label: segmentLabel(kind, []),
        count: await this.countSegment(kind, []),
      });
    const tagged = await this.prisma.subscriber.findMany({
      where: { status: 'CONFIRME', tags: { isEmpty: false } },
      select: { tags: true },
    });
    const counts = new Map<string, number>();
    for (const row of tagged)
      for (const tag of new Set(row.tags)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    [...counts.entries()]
      .sort(([a, countA], [b, countB]) => countB - countA || a.localeCompare(b, 'fr'))
      .slice(0, MAX_TAG_SEGMENTS)
      .forEach(([tag, count]) =>
        result.push({ segment: toSegment('TAGS', [tag]), label: segmentLabel('TAGS', [tag]), count }),
      );
    return result;
  }

  /** `POST /v1/admin/campaigns` */
  async create(input: CampaignInput, actor: AuditActor): Promise<Campaign> {
    const html = sanitizeEmailHtml(input.html);
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.campaign.create({
        data: {
          subject: input.subject === '' ? UNTITLED_SUBJECT : input.subject,
          preheader: input.preheader ?? null,
          html,
          text: htmlToText(html),
          segmentKind: input.segment.kind,
          segmentTags: input.segment.tags,
          status: 'BROUILLON',
          createdById: actor.userId,
        },
        select: CAMPAIGN_SELECT,
      });
      await recordAudit(tx, actor, {
        action: 'campaign.create',
        entity: 'Campaign',
        entityId: created.id,
        label: `A créé le brouillon de newsletter « ${created.subject} »`,
        after: { segment: created.segmentKind },
      });
      return created;
    });
    return this.toCampaign(row);
  }

  /** `GET /v1/admin/campaigns/{id}` */
  async detail(id: string): Promise<Campaign> {
    return this.toCampaign(await this.find(id));
  }

  /** `PATCH /v1/admin/campaigns/{id}` : brouillon ou campagne programmée (contenu relu à l'envoi). */
  async update(id: string, patch: CampaignPatch, actor: AuditActor): Promise<Campaign> {
    const current = await this.find(id);
    if (!isEditable(current.status))
      throw conflict('Cet envoi est déjà parti : il ne peut plus être modifié.');
    const data: Prisma.CampaignUpdateManyMutationInput = {};
    if (patch.subject !== undefined) data.subject = patch.subject === '' ? UNTITLED_SUBJECT : patch.subject;
    if (patch.preheader !== undefined) data.preheader = patch.preheader;
    if (patch.html !== undefined) {
      const html = sanitizeEmailHtml(patch.html);
      data.html = html;
      data.text = htmlToText(html);
    }
    if (patch.segment !== undefined) {
      data.segmentKind = patch.segment.kind;
      data.segmentTags = patch.segment.tags;
    }
    const row = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.campaign.updateMany({
        where: { id, status: { in: ['BROUILLON', 'PROGRAMMEE'] } },
        data,
      });
      if (claimed.count === 0) throw conflict('Cet envoi est déjà parti : il ne peut plus être modifié.');
      const updated = await tx.campaign.findUniqueOrThrow({ where: { id }, select: CAMPAIGN_SELECT });
      await recordAudit(tx, actor, {
        action: 'campaign.update',
        entity: 'Campaign',
        entityId: id,
        label: `A modifié la newsletter « ${updated.subject} »`,
        after: { fields: Object.keys(patch) },
      });
      return updated;
    });
    return this.toCampaign(row);
  }

  /** `DELETE /v1/admin/campaigns/{id}` : brouillon seulement. */
  async remove(id: string, actor: AuditActor): Promise<void> {
    const current = await this.find(id);
    if (current.status !== 'BROUILLON') throw conflict('Seul un brouillon peut être supprimé.');
    await this.prisma.$transaction(async (tx) => {
      const deleted = await tx.campaign.deleteMany({ where: { id, status: 'BROUILLON' } });
      if (deleted.count === 0) throw conflict('Seul un brouillon peut être supprimé.');
      await recordAudit(tx, actor, {
        action: 'campaign.delete',
        entity: 'Campaign',
        entityId: id,
        label: `A supprimé le brouillon de newsletter « ${current.subject} »`,
      });
    });
  }

  /** Rendu réel du gabarit `newsletter-campaign` (modèle et coordonnées en base), prénom d'exemple. */
  private async render(row: CampaignRow, lang: 'fr' | 'en' = 'fr'): Promise<EmailPreview> {
    const [template, settings] = await Promise.all([
      this.content.getTemplate('newsletter-campaign', lang),
      this.content.getSettings(lang),
    ]);
    const rendered = await renderMail({
      template: 'newsletter-campaign',
      lang,
      data: this.mailData(row, 'apercu', SAMPLE_FIRST_NAME, lang),
      content: template.content,
      context: settings.context,
    });
    return { subject: rendered.subject, html: rendered.html, text: rendered.text };
  }

  private mailData(
    row: CampaignRow,
    token: string,
    firstName: string,
    lang: 'fr' | 'en',
  ): Record<string, unknown> {
    const data: Record<string, unknown> = {
      subject: row.subject,
      html: row.html,
      firstName,
      unsubscribeUrl: unsubscribePageUrl(this.config.get('WEB_URL'), lang, token),
      oneClickUnsubscribeUrl: oneClickUnsubscribeUrl(this.config.get('API_URL'), token),
    };
    if (row.preheader !== null) data['preheader'] = row.preheader;
    if (row.text !== null) data['text'] = row.text;
    return data;
  }

  /** `GET /v1/admin/campaigns/{id}/preview` */
  async preview(id: string): Promise<EmailPreview> {
    return this.render(await this.find(id));
  }

  /** `POST /v1/admin/campaigns/{id}/test` : objet préfixé « [Test] », lien de désinscription inopérant. */
  async test(id: string, input: CampaignTestInput, actor: AuditActor): Promise<{ message: string }> {
    const row = await this.find(id);
    await this.mailQueue.enqueue({
      template: 'newsletter-campaign',
      to: input.email,
      lang: 'fr',
      data: { ...this.mailData(row, 'test', SAMPLE_FIRST_NAME, 'fr'), subject: `[Test] ${row.subject}` },
    });
    await recordAudit(this.prisma, actor, {
      action: 'campaign.test',
      entity: 'Campaign',
      entityId: id,
      // L'adresse de destination n'est pas inscrite au journal.
      label: `A envoyé un test de la newsletter « ${row.subject} »`,
    });
    return { message: `E-mail de test envoyé à ${input.email}.` };
  }

  /** `POST /v1/admin/campaigns/{id}/schedule` : date à venir, objet et contenu renseignés. */
  async schedule(id: string, input: CampaignScheduleInput, actor: AuditActor, now: Date): Promise<Campaign> {
    const current = await this.find(id);
    if (!isEditable(current.status)) throw conflict('Cet envoi est déjà parti.');
    const scheduledAt = new Date(input.scheduledAt);
    const errors = contentErrors(current);
    if (scheduledAt.getTime() <= now.getTime())
      errors.unshift({
        path: 'scheduledAt',
        code: 'in_the_past',
        message: 'Choisissez une date et une heure à venir.',
      });
    if (errors.length > 0) throw validationException(errors);
    const row = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.campaign.updateMany({
        where: { id, status: { in: ['BROUILLON', 'PROGRAMMEE'] } },
        data: { status: 'PROGRAMMEE', scheduledAt },
      });
      if (claimed.count === 0) throw conflict('Cet envoi est déjà parti.');
      await recordAudit(tx, actor, {
        action: 'campaign.schedule',
        entity: 'Campaign',
        entityId: id,
        label: `A programmé la newsletter « ${current.subject} »`,
        before: { status: current.status },
        after: { status: 'PROGRAMMEE', scheduledAt: scheduledAt.toISOString() },
      });
      return tx.campaign.findUniqueOrThrow({ where: { id }, select: CAMPAIGN_SELECT });
    });
    await this.dispatch.scheduleStart(id, scheduledAt, now);
    return this.toCampaign(row);
  }

  /** `POST /v1/admin/campaigns/{id}/cancel` : la tâche programmée sera ignorée (programmation effacée). */
  async cancel(id: string, actor: AuditActor): Promise<Campaign> {
    const current = await this.find(id);
    if (current.status !== 'PROGRAMMEE') throw conflict('Cet envoi n’est pas programmé.');
    const row = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.campaign.updateMany({
        where: { id, status: 'PROGRAMMEE' },
        data: { status: 'BROUILLON', scheduledAt: null },
      });
      if (claimed.count === 0) throw conflict('Cet envoi n’est pas programmé.');
      await recordAudit(tx, actor, {
        action: 'campaign.cancel',
        entity: 'Campaign',
        entityId: id,
        label: `A annulé la programmation de la newsletter « ${current.subject} »`,
        before: { status: 'PROGRAMMEE' },
        after: { status: 'BROUILLON' },
      });
      return tx.campaign.findUniqueOrThrow({ where: { id }, select: CAMPAIGN_SELECT });
    });
    return this.toCampaign(row);
  }

  /** `POST /v1/admin/campaigns/{id}/send-now` : `EN_COURS_ENVOI`, envoi par lots en arrière-plan. */
  async sendNow(id: string, actor: AuditActor, now: Date): Promise<Campaign> {
    const current = await this.find(id);
    if (!isEditable(current.status)) throw conflict('Cet envoi est déjà parti.');
    const errors = contentErrors(current);
    if (errors.length > 0) throw conflict(errors.map((error) => error.message).join(' '));
    const recipients = await this.countSegment(current.segmentKind, current.segmentTags);
    const row = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.campaign.updateMany({
        where: { id, status: { in: ['BROUILLON', 'PROGRAMMEE'] } },
        data: { status: 'EN_COURS_ENVOI', scheduledAt: null, startedAt: now, recipients },
      });
      if (claimed.count === 0) throw conflict('Cet envoi est déjà parti.');
      await recordAudit(tx, actor, {
        action: 'campaign.send',
        entity: 'Campaign',
        entityId: id,
        label: `A lancé l’envoi de la newsletter « ${current.subject} » (${STATUS_LABELS[current.status]})`,
        before: { status: current.status },
        after: { status: 'EN_COURS_ENVOI', recipients },
      });
      return tx.campaign.findUniqueOrThrow({ where: { id }, select: CAMPAIGN_SELECT });
    });
    await this.dispatch.startNow(id, now);
    return this.toCampaign(row);
  }
}
