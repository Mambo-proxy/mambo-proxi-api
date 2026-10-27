import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Queue, type JobsOptions } from 'bullmq';
import type { Redis } from 'ioredis';
import { asObject } from '../../common/json/json-read.js';
import { DAY_MS } from '../../common/time/agency-day.js';
import { AppConfigService } from '../../config/app-config.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { MailQueueService } from '../mail/mail-queue.service.js';
import type { MailTemplateKey } from '../mail/mail.types.js';
import {
  QUEUE_NAMES,
  QUEUE_PREFIX,
  REDIS_CONNECTION,
  REMINDER_JOB_OPTIONS,
} from '../queue/queue.constants.js';
import { SETTING_KEYS } from '../settings/settings.constants.js';
import {
  SURVEY_CONTEXT_SELECT,
  isReachable,
  langOfLanguage,
  surveyService,
  type SurveyContextRow,
} from './survey-context.js';
import { SURVEY_VALIDITY_DAYS, surveyToken, surveyTokenHash } from './survey-token.js';

/** Étapes d'un questionnaire planifiées dans la file `survey-invitations`. */
export type SurveyStep = 'invitation' | 'reminder' | 'expiry';

/** Tâche différée (valeurs simples : sérialisée en JSON dans Redis, sans jeton ni donnée personnelle). */
export interface SurveyJob {
  surveyId: string;
  step: SurveyStep;
}

/** Partie de `Queue` utilisée (remplaçable dans les tests). */
export interface SurveyQueueClient {
  add(name: string, data: SurveyJob, opts: JobsOptions): Promise<unknown>;
  close(): Promise<void>;
}

export const SURVEY_QUEUE_FACTORY = Symbol('SURVEY_QUEUE_FACTORY');
export type SurveyQueueFactory = () => SurveyQueueClient;

/** Relance par défaut (paramètre `emails.surveyReminderDays`, docs/05 : J+3) ; `null` = pas de relance. */
export const DEFAULT_SURVEY_REMINDER_DAYS = 3;
/** Au-delà, l'action n'attend plus Redis (la tâche part au rétablissement ; rattrapage au démarrage du worker). */
export const SURVEY_QUEUE_TIMEOUT_MS = 3_000;
/** Lignes reprises au plus par rattrapage (démarrage du worker). */
const CATCH_UP_LIMIT = 500;

const STEP_SUFFIX: Record<SurveyStep, string> = {
  invitation: 'invitation',
  reminder: 'relance',
  expiry: 'expiration',
};

/** Identifiant stable : programmer deux fois la même étape n'ajoute rien (BullMQ ignore un identifiant présent). */
export function surveyJobId(surveyId: string, step: SurveyStep): string {
  return `questionnaire-${surveyId}-${STEP_SUFFIX[step]}`;
}

/** Page publique du questionnaire (le site anglais est sous `/en`). */
export const SURVEY_PAGE_PATH = '/questionnaire';

export type SurveyOutcome = 'sent' | 'reminded' | 'expired' | 'skipped';

/**
 * Invitations au questionnaire de satisfaction (docs/05 §7.2), par une file BullMQ à tâches différées et
 * idempotentes, comme les rappels de rendez-vous :
 * - `scheduleInvitation` : au passage d'un devis à « Prestation réalisée » (`AdminRequestsService`), une tâche
 *   attend `emails.surveyDelayHours` (ligne `surveys` `SCHEDULED` créée par la demande) ;
 * - invitation (worker) : réservation atomique `SCHEDULED → SENT` (une seule exécution envoie, même rejouée), lien à
 *   usage unique valable 30 jours, e-mail `survey-invitation` dans la langue de la demande, puis programmation de la
 *   relance (`emails.surveyReminderDays`, J+3 par défaut, `null` = aucune) et de l'expiration ;
 * - relance : seulement si le questionnaire est toujours sans réponse et ouvert (`SENT → REMINDED`), e-mail
 *   `survey-reminder` avec le même lien ;
 * - expiration : `SENT` / `REMINDED` dont le lien a expiré → `EXPIRED`.
 * Une demande revenue en arrière supprime la ligne `SCHEDULED` : la tâche ne trouve plus rien. Demande ou fiche
 * anonymisée : rien n'est envoyé. Les événements `SURVEY_SENT` / `SURVEY_REMINDED` de l'historique sont posés à
 * l'envoi effectif (`MailRecorder`). Redis indisponible : l'action rend la main après 3 s, et le worker reprend au
 * démarrage les questionnaires en attente (`catchUp`).
 */
@Injectable()
export class SurveyInvitationsService implements OnModuleDestroy {
  private readonly logger = new Logger(SurveyInvitationsService.name);
  private queue: SurveyQueueClient | undefined;

  constructor(
    @Inject(SURVEY_QUEUE_FACTORY) private readonly createQueue: SurveyQueueFactory,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MailQueueService) private readonly mailQueue: MailQueueService,
    @Inject(AppConfigService) private readonly config: AppConfigService,
  ) {}

  /** Programme l'envoi de l'invitation à `scheduledFor` (tout de suite si l'instant est passé). */
  async scheduleInvitation(survey: { id: string; scheduledFor: Date | null }, now: Date): Promise<void> {
    await this.schedule(survey.id, 'invitation', survey.scheduledFor ?? now, now);
  }

  /** Exécution d'une tâche (worker). */
  async run(job: SurveyJob, now: Date): Promise<SurveyOutcome> {
    switch (job.step) {
      case 'invitation':
        return this.deliverInvitation(job.surveyId, now);
      case 'reminder':
        return this.deliverReminder(job.surveyId, now);
      case 'expiry':
        return this.expire(job.surveyId, now);
    }
  }

  /**
   * Reprise au démarrage du worker : invitations en attente, relances et expirations des questionnaires envoyés
   * (identifiants stables : rien n'est programmé deux fois), expiration des liens déjà échus.
   */
  async catchUp(now: Date): Promise<void> {
    try {
      await this.prisma.survey.updateMany({
        where: { status: { in: ['SENT', 'REMINDED'] }, expiresAt: { lte: now } },
        data: { status: 'EXPIRED' },
      });
      const scheduled = await this.prisma.survey.findMany({
        where: { status: 'SCHEDULED' },
        orderBy: { scheduledFor: 'asc' },
        take: CATCH_UP_LIMIT,
        select: { id: true, scheduledFor: true },
      });
      for (const survey of scheduled) await this.scheduleInvitation(survey, now);
      const open = await this.prisma.survey.findMany({
        where: { status: { in: ['SENT', 'REMINDED'] }, expiresAt: { gt: now } },
        orderBy: { expiresAt: 'asc' },
        take: CATCH_UP_LIMIT,
        select: { id: true, status: true, sentAt: true, expiresAt: true },
      });
      const reminderDays = await this.reminderDays();
      for (const survey of open) {
        if (survey.status === 'SENT' && survey.sentAt !== null && reminderDays !== null)
          await this.schedule(survey.id, 'reminder', reminderAt(survey.sentAt, reminderDays), now);
        await this.schedule(survey.id, 'expiry', survey.expiresAt, now);
      }
      if (scheduled.length + open.length > 0)
        this.logger.log(
          `Questionnaires repris : ${String(scheduled.length)} à envoyer, ${String(open.length)} ouverts.`,
        );
    } catch (error) {
      this.logger.error(`Reprise des questionnaires impossible : ${messageOf(error)}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close();
  }

  private async deliverInvitation(surveyId: string, now: Date): Promise<SurveyOutcome> {
    const row = await this.prisma.survey.findUnique({
      where: { id: surveyId },
      select: SURVEY_CONTEXT_SELECT,
    });
    if (row === null || row.status !== 'SCHEDULED') return 'skipped';
    if (!isReachable(row) || !['PRESTATION_REALISEE', 'CLOTUREE'].includes(row.request.status))
      return 'skipped';
    const secret = this.config.get('TOKEN_SIGNING_SECRET');
    const token = surveyToken(secret, row.id, now);
    const expiresAt = new Date(now.getTime() + SURVEY_VALIDITY_DAYS * DAY_MS);
    // Réservation atomique : une seule exécution passe, même si la tâche est rejouée.
    const claimed = await this.prisma.survey.updateMany({
      where: { id: row.id, status: 'SCHEDULED' },
      data: {
        status: 'SENT',
        sentAt: now,
        expiresAt,
        tokenHash: surveyTokenHash(secret, token),
        language: row.request.language,
      },
    });
    if (claimed.count === 0) return 'skipped';
    await this.sendMail('survey-invitation', row, token);
    const reminderDays = await this.reminderDays();
    if (reminderDays !== null) await this.schedule(row.id, 'reminder', reminderAt(now, reminderDays), now);
    await this.schedule(row.id, 'expiry', expiresAt, now);
    this.logger.log(`Questionnaire de la demande ${row.request.reference} envoyé.`);
    return 'sent';
  }

  private async deliverReminder(surveyId: string, now: Date): Promise<SurveyOutcome> {
    const row = await this.prisma.survey.findUnique({
      where: { id: surveyId },
      select: SURVEY_CONTEXT_SELECT,
    });
    if (row === null || row.status !== 'SENT' || row.sentAt === null || row.completedAt !== null)
      return 'skipped';
    if (row.expiresAt.getTime() <= now.getTime() || !isReachable(row)) return 'skipped';
    const claimed = await this.prisma.survey.updateMany({
      where: { id: row.id, status: 'SENT', remindedAt: null, completedAt: null },
      data: { status: 'REMINDED', remindedAt: now },
    });
    if (claimed.count === 0) return 'skipped';
    await this.sendMail(
      'survey-reminder',
      row,
      surveyToken(this.config.get('TOKEN_SIGNING_SECRET'), row.id, row.sentAt),
    );
    this.logger.log(`Relance du questionnaire de la demande ${row.request.reference} mise en file.`);
    return 'reminded';
  }

  private async expire(surveyId: string, now: Date): Promise<SurveyOutcome> {
    const expired = await this.prisma.survey.updateMany({
      where: { id: surveyId, status: { in: ['SENT', 'REMINDED'] }, expiresAt: { lte: now } },
      data: { status: 'EXPIRED' },
    });
    return expired.count > 0 ? 'expired' : 'skipped';
  }

  private async sendMail(template: MailTemplateKey, row: SurveyContextRow, token: string): Promise<void> {
    const lang = langOfLanguage(row.request.language);
    const { contact } = row.request;
    const data: Record<string, string> = {
      firstName: contact.firstName ?? contact.fullName,
      reference: row.request.reference,
      serviceName: surveyService(row, lang).name,
      actionUrl: `${this.config.get('WEB_URL').replace(/\/$/, '')}${lang === 'en' ? '/en' : ''}${SURVEY_PAGE_PATH}/${token}`,
    };
    if (row.request.completedAt !== null) data['serviceDate'] = row.request.completedAt.toISOString();
    try {
      await this.mailQueue.enqueue({
        template,
        to: contact.email,
        lang,
        data,
        reference: row.request.reference,
      });
    } catch (error) {
      this.logger.error(
        `E-mail « ${template} » de la demande ${row.request.reference} non mis en file (${messageOf(error)}).`,
      );
    }
  }

  private async reminderDays(): Promise<number | null> {
    const setting = await this.prisma.setting.findUnique({
      where: { key: SETTING_KEYS.emails },
      select: { value: true },
    });
    const value = asObject(setting?.value)['surveyReminderDays'];
    if (value === null) return null;
    return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 30
      ? value
      : DEFAULT_SURVEY_REMINDER_DAYS;
  }

  private async schedule(surveyId: string, step: SurveyStep, at: Date, now: Date): Promise<void> {
    const delay = Math.max(0, at.getTime() - now.getTime());
    const data: SurveyJob = { surveyId, step };
    const pending = (async () => {
      this.queue ??= this.createQueue();
      await this.queue.add(`survey-${step}`, data, { jobId: surveyJobId(surveyId, step), delay });
      return 'done' as const;
    })().catch((error: unknown) => {
      this.logger.error(`Questionnaire : étape « ${step} » non programmée (${messageOf(error)}).`);
      return 'failed' as const;
    });
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), SURVEY_QUEUE_TIMEOUT_MS);
      timer.unref();
    });
    const outcome = await Promise.race([pending, timeout]);
    clearTimeout(timer);
    if (outcome === 'timeout')
      this.logger.warn(
        `Redis ne répond pas : étape « ${step} » du questionnaire programmée au rétablissement.`,
      );
  }
}

function reminderAt(sentAt: Date, days: number): Date {
  return new Date(sentAt.getTime() + days * DAY_MS);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Fabrique par défaut : `Queue` BullMQ sur la connexion partagée. */
export const surveyQueueFactoryProvider = {
  provide: SURVEY_QUEUE_FACTORY,
  inject: [REDIS_CONNECTION, QUEUE_PREFIX],
  useFactory:
    (connection: Redis, prefix: string): SurveyQueueFactory =>
    () => {
      const queue = new Queue<SurveyJob>(QUEUE_NAMES.surveyInvitations, {
        connection,
        prefix,
        defaultJobOptions: REMINDER_JOB_OPTIONS,
      });
      const logger = new Logger(SurveyInvitationsService.name);
      queue.on('error', (error: Error) => logger.warn(`File des questionnaires : ${error.message}`));
      return queue;
    },
};
