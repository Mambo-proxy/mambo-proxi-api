import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Queue, type JobsOptions } from 'bullmq';
import type { Redis } from 'ioredis';
import { asObject, readNullableNumber } from '../../common/json/json-read.js';
import { DAY_MS, addDays, doualaDate, doualaInstant } from '../../common/time/agency-day.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  QUEUE_NAMES,
  QUEUE_PREFIX,
  REDIS_CONNECTION,
  REMINDER_JOB_OPTIONS,
} from '../queue/queue.constants.js';
import { SETTING_KEYS } from '../settings/settings.constants.js';
import { APPOINTMENT_MAIL_SELECT, AppointmentMailService } from './appointment-mail.service.js';

/** Tâche différée de la file `appointment-reminders` (valeurs simples : sérialisée en JSON dans Redis). */
export interface ReminderJob {
  appointmentId: string;
  /** Début du rendez-vous au moment de la programmation (ISO 8601) : un report rend la tâche caduque. */
  startsAt: string;
}

/** Partie de `Queue` utilisée (remplaçable dans les tests). */
export interface ReminderQueueClient {
  add(name: string, data: ReminderJob, opts: JobsOptions): Promise<unknown>;
  remove(jobId: string): Promise<unknown>;
  close(): Promise<void>;
}

export const REMINDER_QUEUE_FACTORY = Symbol('REMINDER_QUEUE_FACTORY');
export type ReminderQueueFactory = () => ReminderQueueClient;

/** Heure du rappel par défaut (paramètre `emails.appointmentReminderHour`, docs/05 : la veille à 9 h). */
export const DEFAULT_REMINDER_HOUR = 9;
/** Au-delà, l'action du back-office n'attend plus Redis (le rappel part au rétablissement de la connexion). */
export const REMINDER_QUEUE_TIMEOUT_MS = 3_000;

/**
 * Identifiant de la tâche : rendez-vous et début. Programmer deux fois le même rappel n'ajoute rien (BullMQ ignore
 * un identifiant déjà présent) ; un report change le début, donc l'identifiant.
 */
export function reminderJobId(appointmentId: string, startsAt: Date): string {
  return `rappel-${appointmentId}-${String(startsAt.getTime())}`;
}

/** Instant du rappel : la veille du rendez-vous (jour de Douala), à `hour` heures, heure de Douala. */
export function reminderTime(startsAt: Date, hour: number): Date {
  return doualaInstant(addDays(doualaDate(startsAt), -1), hour * 60);
}

export type ReminderOutcome = 'sent' | 'skipped';

/**
 * Rappels des rendez-vous confirmés (e-mail `appointment-reminder`), par une file BullMQ à tâches différées :
 * - `schedule` : à la confirmation (saisie manuelle, confirmation, acceptation d'un créneau proposé), une tâche
 *   attend jusqu'à la veille à l'heure du paramètre `emails.appointmentReminderHour` (9 h par défaut) ; si ce moment
 *   est déjà passé, aucun rappel (la confirmation vient d'être envoyée) ;
 * - `cancel` : à l'annulation, à la proposition d'un autre créneau (report) ou à la fin du rendez-vous, la tâche est
 *   retirée ; un report confirmé programme une nouvelle tâche pour le nouveau créneau ;
 * - `deliver` (worker) : la tâche relit le rendez-vous et n'envoie le rappel que s'il est toujours confirmé, au même
 *   créneau, et pas encore rappelé (`reminderSentAt` posé de façon atomique) : une tâche restée dans la file malgré
 *   une annulation, ou rejouée, n'envoie rien.
 * La file est créée à la première utilisation ; Redis indisponible : l'action rend la main après 3 s (journalisé).
 */
@Injectable()
export class AppointmentRemindersService implements OnModuleDestroy {
  private readonly logger = new Logger(AppointmentRemindersService.name);
  private queue: ReminderQueueClient | undefined;

  constructor(
    @Inject(REMINDER_QUEUE_FACTORY) private readonly createQueue: ReminderQueueFactory,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AppointmentMailService) private readonly mails: AppointmentMailService,
  ) {}

  private async reminderHour(): Promise<number> {
    const setting = await this.prisma.setting.findUnique({
      where: { key: SETTING_KEYS.emails },
      select: { value: true },
    });
    const hour = readNullableNumber(asObject(setting?.value), 'appointmentReminderHour');
    return hour !== null && Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : DEFAULT_REMINDER_HOUR;
  }

  /** Programme le rappel d'un rendez-vous confirmé (sans effet si le moment du rappel est passé). */
  async schedule(appointment: { id: string; startsAt: Date }, now: Date): Promise<boolean> {
    try {
      const at = reminderTime(appointment.startsAt, await this.reminderHour());
      const delay = at.getTime() - now.getTime();
      if (delay <= 0 || appointment.startsAt.getTime() - now.getTime() > 400 * DAY_MS) return false;
      const jobId = reminderJobId(appointment.id, appointment.startsAt);
      const data: ReminderJob = {
        appointmentId: appointment.id,
        startsAt: appointment.startsAt.toISOString(),
      };
      await this.withQueue('programmé', (queue) => queue.add('appointment-reminder', data, { jobId, delay }));
      return true;
    } catch (error) {
      this.logger.error(`Rappel du rendez-vous non programmé : ${messageOf(error)}`);
      return false;
    }
  }

  /** Retire le rappel programmé pour ce créneau (sans effet s'il n'y en a pas). */
  async cancel(appointment: { id: string; startsAt: Date }): Promise<void> {
    try {
      const jobId = reminderJobId(appointment.id, appointment.startsAt);
      await this.withQueue('retiré', (queue) => queue.remove(jobId));
    } catch (error) {
      this.logger.error(`Rappel du rendez-vous non retiré : ${messageOf(error)}`);
    }
  }

  /** Exécution de la tâche (worker) : rappel envoyé, ou ignoré si le rendez-vous a changé. */
  async deliver(job: ReminderJob, now: Date): Promise<ReminderOutcome> {
    const startsAt = new Date(job.startsAt);
    if (Number.isNaN(startsAt.getTime()) || startsAt.getTime() <= now.getTime()) return 'skipped';
    // Réservation atomique de l'envoi : un seul worker passe, même si la tâche est rejouée.
    const claimed = await this.prisma.appointment.updateMany({
      where: { id: job.appointmentId, status: 'CONFIRME', startsAt, reminderSentAt: null },
      data: { reminderSentAt: now },
    });
    if (claimed.count === 0) return 'skipped';
    const row = await this.prisma.appointment.findUnique({
      where: { id: job.appointmentId },
      select: APPOINTMENT_MAIL_SELECT,
    });
    if (row === null) return 'skipped';
    await this.mails.reminder(row);
    this.logger.log(`Rappel du rendez-vous ${row.reference} mis en file.`);
    return 'sent';
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close();
  }

  private async withQueue(
    action: string,
    run: (queue: ReminderQueueClient) => Promise<unknown>,
  ): Promise<void> {
    this.queue ??= this.createQueue();
    const pending = run(this.queue).then(
      () => 'done' as const,
      (error: unknown) => {
        this.logger.error(`Rappel de rendez-vous non ${action} : ${messageOf(error)}`);
        return 'failed' as const;
      },
    );
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), REMINDER_QUEUE_TIMEOUT_MS);
      timer.unref();
    });
    const outcome = await Promise.race([pending, timeout]);
    clearTimeout(timer);
    if (outcome === 'timeout')
      this.logger.warn(`Redis ne répond pas : rappel de rendez-vous ${action} au rétablissement.`);
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Fabrique par défaut : `Queue` BullMQ sur la connexion partagée. */
export const reminderQueueFactoryProvider = {
  provide: REMINDER_QUEUE_FACTORY,
  inject: [REDIS_CONNECTION, QUEUE_PREFIX],
  useFactory:
    (connection: Redis, prefix: string): ReminderQueueFactory =>
    () => {
      const queue = new Queue<ReminderJob>(QUEUE_NAMES.appointmentReminders, {
        connection,
        prefix,
        defaultJobOptions: REMINDER_JOB_OPTIONS,
      });
      const logger = new Logger(AppointmentRemindersService.name);
      queue.on('error', (error: Error) => logger.warn(`File des rappels : ${error.message}`));
      return queue;
    },
};
