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
  CampaignDispatchService,
  type CampaignJob,
  type CampaignOutcome,
} from './campaign-dispatch.service.js';

/**
 * Worker de la file `newsletter-campaigns` (`CampaignDispatchService.run`). Démarré avec le worker des e-mails
 * (`MAIL_WORKER=on`, désactivé en test) ; une étape à la fois (le débit est réglé par l'intervalle entre les lots) ;
 * au démarrage, reprend les campagnes programmées ou en cours (`catchUp`).
 */
@Injectable()
export class CampaignDispatchProcessor implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(CampaignDispatchProcessor.name);
  private worker: Worker<CampaignJob, CampaignOutcome> | undefined;

  constructor(
    @Inject(REDIS_CONNECTION) private readonly connection: Redis,
    @Inject(QUEUE_PREFIX) private readonly prefix: string,
    @Inject(CampaignDispatchService) private readonly dispatch: CampaignDispatchService,
    @Inject(AppConfigService) private readonly config: AppConfigService,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.get('MAIL_WORKER') !== 'on') return;
    this.start();
    void this.dispatch.catchUp(new Date());
  }

  start(): void {
    if (this.worker !== undefined) return;
    const worker = new Worker<CampaignJob, CampaignOutcome>(
      QUEUE_NAMES.newsletterCampaigns,
      (job) => this.dispatch.run(job.data, new Date()),
      { connection: this.connection, prefix: this.prefix, concurrency: 1 },
    );
    worker.on('error', (error: Error) => this.logger.warn(`Worker des campagnes : ${error.message}`));
    worker.on('failed', (job: Job<CampaignJob, CampaignOutcome> | undefined, error: Error) => {
      if (job !== undefined)
        this.logger.warn(
          `Campagne (${job.data.step}) : tentative ${String(job.attemptsMade)} échouée (${error.message}).`,
        );
    });
    this.worker = worker;
    this.logger.log('Worker des campagnes démarré.');
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    this.worker = undefined;
  }
}
