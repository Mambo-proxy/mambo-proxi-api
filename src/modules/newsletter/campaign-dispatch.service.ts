import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Queue, type JobsOptions } from 'bullmq';
import type { Redis } from 'ioredis';
import { AppConfigService } from '../../config/app-config.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { MailQueueService } from '../mail/mail-queue.service.js';
import type { MailJob } from '../mail/mail.types.js';
import {
  QUEUE_NAMES,
  QUEUE_PREFIX,
  REDIS_CONNECTION,
  REMINDER_JOB_OPTIONS,
} from '../queue/queue.constants.js';
import { firstNameOf, oneClickUnsubscribeUrl, segmentWhere, unsubscribePageUrl } from './campaign.mapper.js';
import { unsubscribeToken } from './newsletter-token.js';

/**
 * Débit d'envoi : un lot de `CAMPAIGN_BATCH_SIZE` e-mails mis en file toutes les `CAMPAIGN_BATCH_INTERVAL_MS`
 * (3 000 e-mails par heure au plus, sous les limites courantes des fournisseurs SMTP), envoyés ensuite par le worker
 * des e-mails (réessais exponentiels).
 */
export const CAMPAIGN_BATCH_SIZE = 50;
export const CAMPAIGN_BATCH_INTERVAL_MS = 60_000;
/** Contrôle de fin d'envoi : toutes les minutes, au plus 2 heures après le dernier lot. */
const FINALIZE_INTERVAL_MS = 60_000;
const FINALIZE_MAX_ATTEMPTS = 120;
/** Abonnés matérialisés en envois individuels par requête. */
const MATERIALIZE_CHUNK = 1_000;
export const CAMPAIGN_QUEUE_TIMEOUT_MS = 3_000;

/** Étapes d'un envoi (tâche sérialisée en JSON dans Redis : identifiants seulement, aucune donnée personnelle). */
export type CampaignJob =
  | { campaignId: string; step: 'start'; run: string; scheduledAt: string | null }
  | { campaignId: string; step: 'batch'; run: string; after: string | null }
  | { campaignId: string; step: 'finalize'; run: string; attempt: number };

export type CampaignOutcome = 'started' | 'batched' | 'sent' | 'waiting' | 'skipped';

export interface CampaignQueueClient {
  add(name: string, data: CampaignJob, opts: JobsOptions): Promise<unknown>;
  close(): Promise<void>;
}

export const CAMPAIGN_QUEUE_FACTORY = Symbol('CAMPAIGN_QUEUE_FACTORY');
export type CampaignQueueFactory = () => CampaignQueueClient;

/** Identifiant stable de chaque étape : une étape rejouée (ou programmée deux fois) n'est exécutée qu'une fois. */
export function campaignJobId(job: CampaignJob): string {
  const base = `campagne-${job.campaignId}-${job.run}`;
  switch (job.step) {
    case 'start':
      return `${base}-debut`;
    case 'batch':
      return `${base}-lot-${job.after ?? 'premier'}`;
    case 'finalize':
      return `${base}-fin-${String(job.attempt)}`;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Envoi des campagnes par lots, par la file BullMQ `newsletter-campaigns` (tâches différées et idempotentes) :
 * - `start` (à l'heure programmée, ou tout de suite pour « Envoyer maintenant ») : passage atomique
 *   `PROGRAMMEE → EN_COURS_ENVOI` (la programmation doit être celle de la tâche : une campagne reprogrammée ou
 *   annulée ignore l'ancienne tâche), puis matérialisation des destinataires en envois individuels
 *   (`campaign_deliveries`, unicité campagne + abonné : jamais deux envois au même abonné) ;
 * - `batch` : les envois `PENDING` suivants (curseur sur l'identifiant), mis en file des e-mails avec un identifiant
 *   par envoi (`campagne-envoi-{id}`), puis le lot suivant après `CAMPAIGN_BATCH_INTERVAL_MS` ; un abonné désinscrit
 *   entre-temps est écarté ;
 * - `finalize` : quand plus aucun envoi n'est en attente (`MailRecorder` passe chaque envoi à `SENT` ou `FAILED`),
 *   `EN_COURS_ENVOI → ENVOYEE` avec la date d'envoi.
 * Reprise au démarrage du worker (`catchUp`) : campagnes programmées reprogrammées, campagnes en cours relancées avec
 * un nouveau passage (les envois déjà partis ou en file ne sont pas renvoyés).
 */
@Injectable()
export class CampaignDispatchService implements OnModuleDestroy {
  private readonly logger = new Logger(CampaignDispatchService.name);
  private queue: CampaignQueueClient | undefined;

  constructor(
    @Inject(CAMPAIGN_QUEUE_FACTORY) private readonly createQueue: CampaignQueueFactory,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MailQueueService) private readonly mailQueue: MailQueueService,
    @Inject(AppConfigService) private readonly config: AppConfigService,
  ) {}

  /** Programmation (ou envoi immédiat si `scheduledAt` est passé). */
  async scheduleStart(campaignId: string, scheduledAt: Date, now: Date): Promise<void> {
    await this.add(
      {
        campaignId,
        step: 'start',
        run: String(scheduledAt.getTime()),
        scheduledAt: scheduledAt.toISOString(),
      },
      Math.max(0, scheduledAt.getTime() - now.getTime()),
    );
  }

  /** « Envoyer maintenant » : la campagne est déjà `EN_COURS_ENVOI` (`startedAt` = identifiant du passage). */
  async startNow(campaignId: string, startedAt: Date): Promise<void> {
    await this.add({ campaignId, step: 'start', run: String(startedAt.getTime()), scheduledAt: null }, 0);
  }

  /** Exécution d'une étape (worker). */
  async run(job: CampaignJob, now: Date): Promise<CampaignOutcome> {
    switch (job.step) {
      case 'start':
        return this.start(job, now);
      case 'batch':
        return this.batch(job);
      case 'finalize':
        return this.finalize(job, now);
    }
  }

  async catchUp(now: Date): Promise<void> {
    try {
      const campaigns = await this.prisma.campaign.findMany({
        where: { status: { in: ['PROGRAMMEE', 'EN_COURS_ENVOI'] } },
        select: { id: true, status: true, scheduledAt: true },
        take: 200,
      });
      for (const campaign of campaigns) {
        if (campaign.status === 'PROGRAMMEE' && campaign.scheduledAt !== null)
          await this.scheduleStart(campaign.id, campaign.scheduledAt, now);
        else if (campaign.status === 'EN_COURS_ENVOI') await this.startNow(campaign.id, now);
      }
      if (campaigns.length > 0) this.logger.log(`Campagnes reprises : ${String(campaigns.length)}.`);
    } catch (error) {
      this.logger.error(`Reprise des campagnes impossible : ${messageOf(error)}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close();
  }

  private async start(job: Extract<CampaignJob, { step: 'start' }>, now: Date): Promise<CampaignOutcome> {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: job.campaignId },
      select: {
        id: true,
        status: true,
        scheduledAt: true,
        segmentKind: true,
        segmentTags: true,
        language: true,
      },
    });
    if (campaign === null) return 'skipped';
    if (campaign.status === 'PROGRAMMEE') {
      if (job.scheduledAt === null || campaign.scheduledAt?.toISOString() !== job.scheduledAt)
        return 'skipped';
      const claimed = await this.prisma.campaign.updateMany({
        where: { id: campaign.id, status: 'PROGRAMMEE', scheduledAt: campaign.scheduledAt },
        data: { status: 'EN_COURS_ENVOI', startedAt: now },
      });
      if (claimed.count === 0) return 'skipped';
    } else if (campaign.status !== 'EN_COURS_ENVOI') return 'skipped';

    const existing = await this.prisma.campaignDelivery.count({ where: { campaignId: campaign.id } });
    if (existing === 0)
      await this.materialize(campaign.id, campaign.segmentKind, campaign.segmentTags, campaign.language);
    const recipients = await this.prisma.campaignDelivery.count({ where: { campaignId: campaign.id } });
    await this.prisma.campaign.update({
      where: { id: campaign.id },
      data: { recipients },
      select: { id: true },
    });
    this.logger.log(`Campagne ${campaign.id} : envoi lancé (${String(recipients)} destinataires).`);
    await this.add({ campaignId: campaign.id, step: 'batch', run: job.run, after: null }, 0);
    return 'started';
  }

  /**
   * Envois individuels des abonnés confirmés du segment, de la langue de la campagne s'il y en a une (par tranches,
   * sans doublon).
   */
  private async materialize(
    campaignId: string,
    kind: Parameters<typeof segmentWhere>[0],
    tags: readonly string[],
    language: Parameters<typeof segmentWhere>[2],
  ): Promise<void> {
    let cursor: string | undefined;
    for (;;) {
      const subscribers = await this.prisma.subscriber.findMany({
        where: segmentWhere(kind, tags, language),
        orderBy: { id: 'asc' },
        take: MATERIALIZE_CHUNK,
        ...(cursor === undefined ? {} : { skip: 1, cursor: { id: cursor } }),
        select: { id: true },
      });
      if (subscribers.length === 0) return;
      await this.prisma.campaignDelivery.createMany({
        data: subscribers.map((subscriber) => ({ campaignId, subscriberId: subscriber.id })),
        skipDuplicates: true,
      });
      if (subscribers.length < MATERIALIZE_CHUNK) return;
      cursor = subscribers[subscribers.length - 1]?.id;
    }
  }

  private async batch(job: Extract<CampaignJob, { step: 'batch' }>): Promise<CampaignOutcome> {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: job.campaignId },
      select: { id: true, status: true, subject: true, preheader: true, html: true, text: true },
    });
    if (campaign?.status !== 'EN_COURS_ENVOI') return 'skipped';
    const deliveries = await this.prisma.campaignDelivery.findMany({
      where: { campaignId: campaign.id, status: 'PENDING', ...(job.after ? { id: { gt: job.after } } : {}) },
      orderBy: { id: 'asc' },
      take: CAMPAIGN_BATCH_SIZE,
      select: {
        id: true,
        subscriber: { select: { id: true, email: true, name: true, status: true, language: true } },
      },
    });

    const secret = this.config.get('TOKEN_SIGNING_SECRET');
    const webUrl = this.config.get('WEB_URL');
    const apiUrl = this.config.get('API_URL');
    const jobs: MailJob[] = [];
    const skipped: string[] = [];
    for (const delivery of deliveries) {
      const { subscriber } = delivery;
      if (subscriber.status !== 'CONFIRME') {
        skipped.push(delivery.id);
        continue;
      }
      const lang = subscriber.language === 'EN' ? 'en' : 'fr';
      const token = unsubscribeToken(secret, subscriber.id, campaign.id);
      const data: Record<string, unknown> = {
        subject: campaign.subject,
        html: campaign.html,
        unsubscribeUrl: unsubscribePageUrl(webUrl, lang, token),
        oneClickUnsubscribeUrl: oneClickUnsubscribeUrl(apiUrl, token),
        deliveryId: delivery.id,
      };
      if (campaign.preheader !== null) data['preheader'] = campaign.preheader;
      if (campaign.text !== null) data['text'] = campaign.text;
      const firstName = firstNameOf(subscriber.name);
      if (firstName !== undefined) data['firstName'] = firstName;
      jobs.push({ template: 'newsletter-campaign', to: subscriber.email, lang, data });
    }
    if (skipped.length > 0)
      await this.prisma.campaignDelivery.updateMany({
        where: { id: { in: skipped }, status: 'PENDING' },
        data: { status: 'FAILED', error: 'Désinscrit avant l’envoi.' },
      });
    await this.mailQueue.enqueueMany(jobs);

    const last = deliveries[deliveries.length - 1]?.id;
    if (deliveries.length === CAMPAIGN_BATCH_SIZE && last !== undefined)
      await this.add(
        { campaignId: campaign.id, step: 'batch', run: job.run, after: last },
        CAMPAIGN_BATCH_INTERVAL_MS,
      );
    else await this.add({ campaignId: campaign.id, step: 'finalize', run: job.run, attempt: 1 }, 0);
    return 'batched';
  }

  private async finalize(
    job: Extract<CampaignJob, { step: 'finalize' }>,
    now: Date,
  ): Promise<CampaignOutcome> {
    const pending = await this.prisma.campaignDelivery.count({
      where: { campaignId: job.campaignId, status: 'PENDING' },
    });
    if (pending > 0 && job.attempt < FINALIZE_MAX_ATTEMPTS) {
      await this.add({ ...job, attempt: job.attempt + 1 }, FINALIZE_INTERVAL_MS);
      return 'waiting';
    }
    const done = await this.prisma.campaign.updateMany({
      where: { id: job.campaignId, status: 'EN_COURS_ENVOI' },
      data: { status: 'ENVOYEE', sentAt: now },
    });
    if (done.count === 0) return 'skipped';
    if (pending > 0)
      this.logger.warn(
        `Campagne ${job.campaignId} : ${String(pending)} envois toujours en attente à la clôture.`,
      );
    this.logger.log(`Campagne ${job.campaignId} envoyée.`);
    return 'sent';
  }

  private async add(data: CampaignJob, delay: number): Promise<void> {
    const pending = (async () => {
      this.queue ??= this.createQueue();
      await this.queue.add(`campaign-${data.step}`, data, { jobId: campaignJobId(data), delay });
      return 'done' as const;
    })().catch((error: unknown) => {
      this.logger.error(
        `Campagne ${data.campaignId} : étape « ${data.step} » non programmée (${messageOf(error)}).`,
      );
      return 'failed' as const;
    });
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), CAMPAIGN_QUEUE_TIMEOUT_MS);
      timer.unref();
    });
    const outcome = await Promise.race([pending, timeout]);
    clearTimeout(timer);
    if (outcome === 'timeout')
      this.logger.warn(
        `Redis ne répond pas : étape « ${data.step} » de la campagne programmée au rétablissement.`,
      );
  }
}

/** Fabrique par défaut : `Queue` BullMQ sur la connexion partagée. */
export const campaignQueueFactoryProvider = {
  provide: CAMPAIGN_QUEUE_FACTORY,
  inject: [REDIS_CONNECTION, QUEUE_PREFIX],
  useFactory:
    (connection: Redis, prefix: string): CampaignQueueFactory =>
    () => {
      const queue = new Queue<CampaignJob>(QUEUE_NAMES.newsletterCampaigns, {
        connection,
        prefix,
        defaultJobOptions: REMINDER_JOB_OPTIONS,
      });
      const logger = new Logger(CampaignDispatchService.name);
      queue.on('error', (error: Error) => logger.warn(`File des campagnes : ${error.message}`));
      return queue;
    },
};
