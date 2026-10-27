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
  SurveyInvitationsService,
  type SurveyJob,
  type SurveyOutcome,
} from './survey-invitations.service.js';

/**
 * Worker de la file `survey-invitations` : invitation, relance et expiration des questionnaires à l'échéance de
 * leur tâche différée (`SurveyInvitationsService.run`). Démarré avec le worker des e-mails (`MAIL_WORKER=on`,
 * désactivé en test) ; au démarrage, reprend les questionnaires en attente (`catchUp`).
 */
@Injectable()
export class SurveyInvitationProcessor implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(SurveyInvitationProcessor.name);
  private worker: Worker<SurveyJob, SurveyOutcome> | undefined;

  constructor(
    @Inject(REDIS_CONNECTION) private readonly connection: Redis,
    @Inject(QUEUE_PREFIX) private readonly prefix: string,
    @Inject(SurveyInvitationsService) private readonly surveys: SurveyInvitationsService,
    @Inject(AppConfigService) private readonly config: AppConfigService,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.get('MAIL_WORKER') !== 'on') return;
    this.start();
    void this.surveys.catchUp(new Date());
  }

  start(): void {
    if (this.worker !== undefined) return;
    const worker = new Worker<SurveyJob, SurveyOutcome>(
      QUEUE_NAMES.surveyInvitations,
      (job) => this.process(job),
      { connection: this.connection, prefix: this.prefix, concurrency: 2 },
    );
    worker.on('error', (error: Error) => this.logger.warn(`Worker des questionnaires : ${error.message}`));
    worker.on('failed', (job: Job<SurveyJob, SurveyOutcome> | undefined, error: Error) => {
      if (job !== undefined)
        this.logger.warn(
          `Questionnaire (${job.data.step}) : tentative ${String(job.attemptsMade)} échouée (${error.message}).`,
        );
    });
    this.worker = worker;
    this.logger.log('Worker des questionnaires démarré.');
  }

  process(job: Pick<Job<SurveyJob, SurveyOutcome>, 'data'>): Promise<SurveyOutcome> {
    return this.surveys.run(job.data, new Date());
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    this.worker = undefined;
  }
}
