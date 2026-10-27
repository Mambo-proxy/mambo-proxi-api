import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Queue, type BulkJobOptions } from 'bullmq';
import type { Redis } from 'ioredis';
import { createHash } from 'node:crypto';
import { MAIL_JOB_OPTIONS, QUEUE_NAMES, QUEUE_PREFIX, REDIS_CONNECTION } from '../queue/queue.constants.js';
import { mailJobSchema } from './mail-sender.service.js';
import type { MailJob } from './mail.types.js';

/** Au-delà, la requête HTTP n'attend plus Redis : la tâche part dès le retour de la connexion. */
export const ENQUEUE_TIMEOUT_MS = 3_000;

/** Partie de `Queue` utilisée (remplaçable dans les tests). */
export interface MailQueueClient {
  addBulk(jobs: { name: string; data: MailJob; opts?: BulkJobOptions }[]): Promise<unknown>;
  close(): Promise<void>;
}

/** Jeton d'injection de la fabrique de la file (`Queue` BullMQ sur la connexion partagée). */
export const MAIL_QUEUE_FACTORY = Symbol('MAIL_QUEUE_FACTORY');
export type MailQueueFactory = () => MailQueueClient;

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * Identifiant stable d'une tâche liée à une demande (`reference`) : la même tâche ajoutée deux fois (double envoi
 * du formulaire, nouvelle tentative du code appelant) n'est envoyée qu'une fois tant que la première est
 * conservée par BullMQ. Condensat : aucune adresse e-mail en clair dans les clés Redis.
 * Envoi d'une campagne (`data.deliveryId`) : une tâche par envoi individuel, même si le lot est rejoué (reprise).
 */
export function mailJobId(job: MailJob): string | undefined {
  const deliveryId = job.data['deliveryId'];
  if (typeof deliveryId === 'string' && deliveryId !== '') return `campagne-envoi-${deliveryId}`;
  if (job.reference === undefined) return undefined;
  const digest = createHash('sha256')
    .update(stableJson({ template: job.template, to: job.to.toLowerCase(), lang: job.lang, data: job.data }))
    .digest('hex')
    .slice(0, 24);
  return `${job.template}-${job.reference}-${digest}`;
}

/**
 * Producteur de la file `mail` : les e-mails partent en arrière-plan (worker), avec réessais. La file est créée à
 * la première utilisation (aucune connexion à Redis tant qu'aucun e-mail n'est demandé).
 *
 * Redis indisponible : après `ENQUEUE_TIMEOUT_MS`, `enqueue` rend la main sans erreur (la demande de l'internaute
 * est déjà enregistrée) et la tâche reste en attente dans la connexion, envoyée à son rétablissement ; si le
 * processus s'arrête avant, elle est perdue (journalisé).
 */
@Injectable()
export class MailQueueService implements OnModuleDestroy {
  private readonly logger = new Logger(MailQueueService.name);
  private queue: MailQueueClient | undefined;

  constructor(@Inject(MAIL_QUEUE_FACTORY) private readonly createQueue: MailQueueFactory) {}

  enqueue(job: MailJob): Promise<void> {
    return this.enqueueMany([job]);
  }

  async enqueueMany(jobs: MailJob[]): Promise<void> {
    if (jobs.length === 0) return;
    const entries = jobs.map((job) => {
      // Erreur de programmation (adresse non validée, clé inconnue) : signalée tout de suite à l'appelant.
      const parsed = mailJobSchema.parse(job);
      const jobId = mailJobId(parsed);
      return { name: parsed.template, data: parsed, opts: jobId === undefined ? {} : { jobId } };
    });
    this.queue ??= this.createQueue();

    const templates = [...new Set(jobs.map((job) => job.template))].join(', ');
    const adding = this.queue.addBulk(entries).then(
      () => 'added' as const,
      (error: unknown) => {
        this.logger.error(
          `E-mails non mis en file (${templates}) : ${error instanceof Error ? error.message : String(error)}`,
        );
        return 'failed' as const;
      },
    );
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), ENQUEUE_TIMEOUT_MS);
      timer.unref();
    });
    const outcome = await Promise.race([adding, timeout]);
    clearTimeout(timer);
    if (outcome === 'timeout') {
      this.logger.warn(`Redis ne répond pas : e-mails (${templates}) mis en attente du rétablissement.`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close();
  }
}

/** Fabrique par défaut : `Queue` BullMQ sur la connexion partagée, options de réessai et de purge communes. */
export const mailQueueFactoryProvider = {
  provide: MAIL_QUEUE_FACTORY,
  inject: [REDIS_CONNECTION, QUEUE_PREFIX],
  useFactory:
    (connection: Redis, prefix: string): MailQueueFactory =>
    () => {
      const queue = new Queue<MailJob>(QUEUE_NAMES.mail, {
        connection,
        prefix,
        defaultJobOptions: MAIL_JOB_OPTIONS,
      });
      // Sans écouteur, une erreur de connexion émise par la file arrêterait le processus.
      const logger = new Logger(MailQueueService.name);
      queue.on('error', (error: Error) => logger.warn(`File des e-mails : ${error.message}`));
      return queue;
    },
};
