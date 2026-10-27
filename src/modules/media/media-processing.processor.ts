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
  MEDIA_JOB_OPTIONS,
  MediaProcessingService,
  type MediaJob,
  type MediaJobOutcome,
} from './media-processing.service.js';

/**
 * Worker de la file `media` : variantes des images envoyées et suppression différée des fichiers remplacés. Démarré
 * avec le worker des e-mails (`MAIL_WORKER=on`, désactivé en test) ; un seul traitement à la fois (encodage AVIF
 * gourmand en mémoire). Au démarrage : usages reconstruits et médias en attente repris (`catchUp`).
 */
@Injectable()
export class MediaProcessingProcessor implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(MediaProcessingProcessor.name);
  private worker: Worker<MediaJob, MediaJobOutcome> | undefined;

  constructor(
    @Inject(REDIS_CONNECTION) private readonly connection: Redis,
    @Inject(QUEUE_PREFIX) private readonly prefix: string,
    @Inject(MediaProcessingService) private readonly processing: MediaProcessingService,
    @Inject(AppConfigService) private readonly config: AppConfigService,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.get('MAIL_WORKER') !== 'on') return;
    this.start();
    void this.processing.catchUp();
  }

  start(): void {
    if (this.worker !== undefined) return;
    const worker = new Worker<MediaJob, MediaJobOutcome>(QUEUE_NAMES.media, (job) => this.process(job), {
      connection: this.connection,
      prefix: this.prefix,
      concurrency: 1,
    });
    worker.on('error', (error: Error) => this.logger.warn(`Worker de la médiathèque : ${error.message}`));
    worker.on('failed', (job: Job<MediaJob, MediaJobOutcome> | undefined, error: Error) => {
      if (job === undefined) return;
      this.logger.warn(
        `Médiathèque (${job.data.type}) : tentative ${String(job.attemptsMade)} échouée (${error.message}).`,
      );
      const attempts = job.opts.attempts ?? MEDIA_JOB_OPTIONS.attempts;
      if (job.data.type === 'variants' && job.attemptsMade >= attempts)
        void this.processing.markFailed(job.data.mediaId, job.data.storageKey).catch((failure: unknown) => {
          this.logger.error(
            `Média non marqué en échec : ${failure instanceof Error ? failure.message : String(failure)}`,
          );
        });
    });
    this.worker = worker;
    this.logger.log('Worker de la médiathèque démarré.');
  }

  process(job: Pick<Job<MediaJob, MediaJobOutcome>, 'data'>): Promise<MediaJobOutcome> {
    return this.processing.run(job.data);
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    this.worker = undefined;
  }
}
