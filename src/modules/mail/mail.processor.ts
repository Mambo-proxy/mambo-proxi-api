import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { UnrecoverableError, Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import { AppConfigService } from '../../config/app-config.service.js';
import {
  MAIL_WORKER_CONCURRENCY,
  QUEUE_NAMES,
  QUEUE_PREFIX,
  REDIS_CONNECTION,
} from '../queue/queue.constants.js';
import { MailRecorder } from './mail-recorder.service.js';
import { isPermanentMailError, MailSender, type MailSendResult } from './mail-sender.service.js';
import type { MailJob } from './mail.types.js';

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Worker BullMQ de la file `mail` : rend le gabarit et envoie l'e-mail (`MailSender`). Démarré au lancement de
 * l'application si `MAIL_WORKER=on` (désactivé en test). Une erreur passagère (SMTP, base) est réessayée selon
 * `MAIL_JOB_OPTIONS` ; une tâche invalide ou incomplète échoue aussitôt, sans réessai.
 */
@Injectable()
export class MailProcessor implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(MailProcessor.name);
  private worker: Worker<MailJob, MailSendResult> | undefined;

  constructor(
    @Inject(REDIS_CONNECTION) private readonly connection: Redis,
    @Inject(QUEUE_PREFIX) private readonly prefix: string,
    @Inject(MailSender) private readonly sender: MailSender,
    @Inject(MailRecorder) private readonly recorder: MailRecorder,
    @Inject(AppConfigService) private readonly config: AppConfigService,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.get('MAIL_WORKER') === 'on') this.start();
  }

  /** Démarre le worker (sans effet s'il tourne déjà). */
  start(): void {
    if (this.worker !== undefined) return;
    const worker = new Worker<MailJob, MailSendResult>(QUEUE_NAMES.mail, (job) => this.process(job), {
      connection: this.connection,
      prefix: this.prefix,
      concurrency: MAIL_WORKER_CONCURRENCY,
    });
    worker.on('error', (error: Error) => this.logger.warn(`Worker des e-mails : ${error.message}`));
    worker.on('failed', (job: Job<MailJob, MailSendResult> | undefined, error: Error) => {
      if (job === undefined) return;
      const final = error instanceof UnrecoverableError || job.attemptsMade >= (job.opts.attempts ?? 1);
      const template = job.data.template;
      if (!final) {
        this.logger.warn(
          `E-mail « ${template} » : tentative ${job.attemptsMade} échouée (${error.message}).`,
        );
        return;
      }
      this.logger.error(`E-mail « ${template} » abandonné : ${error.message}`);
      void this.recorder.recordFailure(job.data, error.message);
    });
    this.worker = worker;
    this.logger.log('Worker des e-mails démarré.');
  }

  async process(job: Job<MailJob, MailSendResult>): Promise<MailSendResult> {
    try {
      return await this.sender.send(job.data);
    } catch (error) {
      if (isPermanentMailError(error)) throw new UnrecoverableError(messageOf(error));
      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    // Attend la fin des envois en cours (la connexion partagée est fermée ensuite par le module des files).
    await this.worker?.close();
    this.worker = undefined;
  }
}
