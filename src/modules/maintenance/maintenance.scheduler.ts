import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { Queue, Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import { AppConfigService } from '../../config/app-config.service.js';
import { QUEUE_NAMES, QUEUE_PREFIX, REDIS_CONNECTION } from '../queue/queue.constants.js';
import { BackupService } from './backup.service.js';
import { GdprCleanupService } from './gdpr-cleanup.service.js';
import { MagazinePublicationService } from './magazine-publication.service.js';
import { RevalidationDispatchService } from './revalidation-dispatch.service.js';

/** Tâches planifiées de la file `maintenance`. */
export const MAINTENANCE_JOBS = {
  revalidation: 'revalidation',
  magazinePublication: 'magazine-publication',
  gdprCleanup: 'gdpr-cleanup',
  backup: 'database-backup',
} as const;
export type MaintenanceJobName = (typeof MAINTENANCE_JOBS)[keyof typeof MAINTENANCE_JOBS];

/** Fuseau des tâches quotidiennes (heure de l'agence). */
const AGENCY_TIME_ZONE = 'Africa/Douala';

/** Planification : revalidation toutes les 15 s, éditions du magazine arrivées à leur date toutes les 5 min, sauvegarde à 2 h, nettoyage RGPD à 3 h 30 (heure de Douala). */
export const MAINTENANCE_SCHEDULES: Record<
  MaintenanceJobName,
  { every?: number; pattern?: string; tz?: string }
> = {
  [MAINTENANCE_JOBS.revalidation]: { every: 15_000 },
  [MAINTENANCE_JOBS.magazinePublication]: { every: 5 * 60_000 },
  [MAINTENANCE_JOBS.backup]: { pattern: '0 2 * * *', tz: AGENCY_TIME_ZONE },
  [MAINTENANCE_JOBS.gdprCleanup]: { pattern: '30 3 * * *', tz: AGENCY_TIME_ZONE },
};

const JOB_OPTIONS = {
  attempts: 1,
  removeOnComplete: { count: 50 },
  removeOnFail: { count: 200 },
} as const;

/**
 * Tâches planifiées (« job schedulers » BullMQ, une seule exécution par échéance même avec plusieurs instances) :
 * envoi des revalidations du site, sauvegarde quotidienne de la base, nettoyage RGPD quotidien. Démarrées avec le
 * worker des e-mails (`MAIL_WORKER=on`, désactivé en test). Une tâche en échec est journalisée ; la suivante repart à
 * l'échéance suivante (les revalidations gardent leurs propres réessais en base).
 */
@Injectable()
export class MaintenanceScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(MaintenanceScheduler.name);
  private queue: Queue | undefined;
  private worker: Worker | undefined;

  constructor(
    @Inject(REDIS_CONNECTION) private readonly connection: Redis,
    @Inject(QUEUE_PREFIX) private readonly prefix: string,
    @Inject(AppConfigService) private readonly config: AppConfigService,
    @Inject(RevalidationDispatchService) private readonly revalidation: RevalidationDispatchService,
    @Inject(GdprCleanupService) private readonly cleanup: GdprCleanupService,
    @Inject(MagazinePublicationService) private readonly magazine: MagazinePublicationService,
    @Inject(BackupService) private readonly backup: BackupService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.config.get('MAIL_WORKER') !== 'on') return;
    try {
      await this.start();
    } catch (error) {
      this.logger.error(
        `Tâches planifiées non démarrées : ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async start(): Promise<void> {
    if (this.worker !== undefined) return;
    const recovered = await this.revalidation.recoverInterrupted();
    if (recovered > 0)
      this.logger.warn(`${String(recovered)} revalidation(s) interrompue(s) remise(s) en attente.`);

    const queue = new Queue(QUEUE_NAMES.maintenance, { connection: this.connection, prefix: this.prefix });
    this.queue = queue;
    for (const [name, schedule] of Object.entries(MAINTENANCE_SCHEDULES))
      await queue.upsertJobScheduler(name, schedule, { name, data: {}, opts: JOB_OPTIONS });

    const worker = new Worker(QUEUE_NAMES.maintenance, (job: Job) => this.process(job.name), {
      connection: this.connection,
      prefix: this.prefix,
      concurrency: 1,
    });
    worker.on('error', (error: Error) => this.logger.warn(`Worker des tâches planifiées : ${error.message}`));
    worker.on('failed', (job: Job | undefined, error: Error) => {
      if (job !== undefined) this.logger.error(`Tâche planifiée « ${job.name} » en échec : ${error.message}`);
    });
    this.worker = worker;
    this.logger.log('Tâches planifiées démarrées (revalidation, magazine, sauvegarde, nettoyage RGPD).');
  }

  /** Exécute une tâche (aussi appelable directement : tests, commande d'exploitation). */
  async process(name: string): Promise<unknown> {
    const now = new Date();
    switch (name) {
      case MAINTENANCE_JOBS.magazinePublication:
        return this.magazine.revalidateDueEditions(now);
      case MAINTENANCE_JOBS.revalidation:
        return this.revalidation.dispatch(now);
      case MAINTENANCE_JOBS.backup:
        return this.backup.run(now);
      case MAINTENANCE_JOBS.gdprCleanup:
        return this.cleanup.run(now);
      default:
        this.logger.warn(`Tâche planifiée inconnue ignorée : ${name}`);
        return null;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    this.worker = undefined;
    this.queue = undefined;
  }
}
