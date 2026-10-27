import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import { AppConfigService } from '../../config/app-config.service.js';
import { QUEUE_NAMES, QUEUE_PREFIX, REDIS_CONNECTION } from '../queue/queue.constants.js';
import {
  AppointmentRemindersService,
  type ReminderJob,
  type ReminderOutcome,
} from './appointment-reminders.service.js';

/**
 * Worker de la file `appointment-reminders` : à l'échéance d'une tâche différée, relit le rendez-vous et met le
 * rappel en file d'envoi (`AppointmentRemindersService.deliver`). Démarré avec le worker des e-mails
 * (`MAIL_WORKER=on`, désactivé en test).
 */
@Injectable()
export class AppointmentReminderProcessor implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(AppointmentReminderProcessor.name);
  private worker: Worker<ReminderJob, ReminderOutcome> | undefined;

  constructor(
    @Inject(REDIS_CONNECTION) private readonly connection: Redis,
    @Inject(QUEUE_PREFIX) private readonly prefix: string,
    @Inject(AppointmentRemindersService) private readonly reminders: AppointmentRemindersService,
    @Inject(AppConfigService) private readonly config: AppConfigService,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.get('MAIL_WORKER') === 'on') this.start();
  }

  start(): void {
    if (this.worker !== undefined) return;
    const worker = new Worker<ReminderJob, ReminderOutcome>(
      QUEUE_NAMES.appointmentReminders,
      (job) => this.process(job),
      { connection: this.connection, prefix: this.prefix, concurrency: 2 },
    );
    worker.on('error', (error: Error) => this.logger.warn(`Worker des rappels : ${error.message}`));
    worker.on('failed', (job: Job<ReminderJob, ReminderOutcome> | undefined, error: Error) => {
      if (job !== undefined)
        this.logger.warn(`Rappel de rendez-vous : tentative ${job.attemptsMade} échouée (${error.message}).`);
    });
    this.worker = worker;
    this.logger.log('Worker des rappels de rendez-vous démarré.');
  }

  process(job: Pick<Job<ReminderJob, ReminderOutcome>, 'data'>): Promise<ReminderOutcome> {
    return this.reminders.deliver(job.data, new Date());
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    this.worker = undefined;
  }
}
