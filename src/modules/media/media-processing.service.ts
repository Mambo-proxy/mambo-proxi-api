import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Queue, type DefaultJobOptions, type JobsOptions } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Readable } from 'node:stream';
import { requestRevalidation } from '../../common/revalidation/revalidation.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { QUEUE_NAMES, QUEUE_PREFIX, REDIS_CONNECTION } from '../queue/queue.constants.js';
import { renderVariants } from './image-processing.js';
import { MEDIA_STORAGE, folderOf, isStoredMediaKey, variantKey, type MediaStorage } from './media-storage.js';
import {
  FOREIGN_USAGES_SELECT,
  collectAllUsages,
  liveForeignUsages,
  rebuildMediaUsages,
} from './media-usages.js';

/** Tâches de la file `media` (valeurs simples, sérialisées en JSON dans Redis). */
export type MediaJob =
  /** Variantes AVIF/WebP du fichier `storageKey` du média (ignorée si le fichier a été remplacé entre-temps). */
  | { type: 'variants'; mediaId: string; storageKey: string }
  /** Suppression différée des fichiers d'un média remplacé (pages du site encore en cache). */
  | { type: 'cleanup'; keys: string[] };

export type MediaJobOutcome = 'ready' | 'cleaned' | 'skipped';

/** Partie de `Queue` utilisée (remplaçable dans les tests). */
export interface MediaQueueClient {
  add(name: string, data: MediaJob, opts: JobsOptions): Promise<unknown>;
  close(): Promise<void>;
}

export const MEDIA_QUEUE_FACTORY = Symbol('MEDIA_QUEUE_FACTORY');
export type MediaQueueFactory = () => MediaQueueClient;

/** 3 tentatives (30 s, 1 min, 2 min) avant de passer le média en `FAILED` ; purge comme les autres files. */
export const MEDIA_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 30_000 },
  removeOnComplete: { age: 7 * 24 * 60 * 60, count: 1_000 },
  removeOnFail: { age: 30 * 24 * 60 * 60, count: 5_000 },
} as const satisfies DefaultJobOptions;

/** Délai avant la suppression des anciens fichiers d'un média remplacé. */
export const REPLACED_FILES_TTL_MS = 24 * 60 * 60 * 1000;
/** Au-delà, l'envoi n'attend plus Redis (la tâche est reprise au démarrage du worker). */
const QUEUE_TIMEOUT_MS = 3_000;
/** Médias repris au plus par rattrapage (démarrage du worker). */
const CATCH_UP_LIMIT = 200;

async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream)
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  return Buffer.concat(chunks);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Génération des variantes en tâche de fond (file BullMQ `media`, worker `MediaProcessingProcessor`, un média à la
 * fois) : le média reste `PROCESSING` jusqu'à l'écriture de ses variantes (`READY`), ou passe `FAILED` après le
 * dernier essai ; le site est alors revalidé pour les contenus qui l'utilisent. Redis indisponible : l'envoi rend la
 * main après 3 s et le worker reprend au démarrage les médias restés `PROCESSING` (`catchUp`).
 */
@Injectable()
export class MediaProcessingService implements OnModuleDestroy {
  private readonly logger = new Logger(MediaProcessingService.name);
  private queue: MediaQueueClient | undefined;

  constructor(
    @Inject(MEDIA_QUEUE_FACTORY) private readonly createQueue: MediaQueueFactory,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MEDIA_STORAGE) private readonly storage: MediaStorage,
  ) {}

  async enqueueVariants(mediaId: string, storageKey: string): Promise<void> {
    await this.add(
      'media-variants',
      { type: 'variants', mediaId, storageKey },
      { jobId: `media-${mediaId}-${folderOf(storageKey) ?? 'site'}` },
    );
  }

  /** Suppression des fichiers remplacés dans 24 h (pages en cache du site, CDN). */
  async scheduleCleanup(keys: readonly string[]): Promise<void> {
    const stored = keys.filter(isStoredMediaKey);
    if (stored.length === 0) return;
    await this.add(
      'media-cleanup',
      { type: 'cleanup', keys: stored },
      { jobId: `media-cleanup-${folderOf(stored[0] ?? '') ?? 'site'}`, delay: REPLACED_FILES_TTL_MS },
    );
  }

  /** Exécution d'une tâche (worker). */
  async run(job: MediaJob): Promise<MediaJobOutcome> {
    if (job.type === 'cleanup') {
      await Promise.allSettled(job.keys.filter(isStoredMediaKey).map((key) => this.storage.delete(key)));
      return 'cleaned';
    }
    return this.renderVariants(job.mediaId, job.storageKey);
  }

  /** Dernier essai échoué : le média passe `FAILED` (l'illustration reste affichée sur le site). */
  async markFailed(mediaId: string, storageKey: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.media.updateMany({
        where: { id: mediaId, storageKey, status: 'PROCESSING' },
        data: { status: 'FAILED' },
      });
      if (count > 0) await requestRevalidation(tx, await this.tagsOf(tx, mediaId));
    });
    this.logger.warn(`Variantes du média ${mediaId} impossibles à générer : média en échec.`);
  }

  /**
   * Reprise au démarrage du worker : usages des médias reconstruits (`media_usages`), médias restés `PROCESSING`
   * remis en file (identifiants stables : rien n'est généré deux fois).
   */
  async catchUp(): Promise<void> {
    try {
      const rows = await rebuildMediaUsages(this.prisma);
      this.logger.log(`Usages des médias reconstruits (${String(rows)}).`);
    } catch (error) {
      this.logger.error(`Usages des médias non reconstruits : ${messageOf(error)}`);
    }
    try {
      const pending = await this.prisma.media.findMany({
        where: { status: 'PROCESSING' },
        orderBy: { createdAt: 'asc' },
        take: CATCH_UP_LIMIT,
        select: { id: true, storageKey: true },
      });
      for (const media of pending) await this.enqueueVariants(media.id, media.storageKey);
      if (pending.length > 0) this.logger.log(`Médias repris : ${String(pending.length)} à traiter.`);
    } catch (error) {
      this.logger.error(`Reprise des médias impossible : ${messageOf(error)}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close();
  }

  /** Étiquettes du site à revalider pour les contenus qui affichent le média (recalculées sur les contenus). */
  async tagsOf(client: Prisma.TransactionClient | PrismaService, mediaId: string): Promise<string[]> {
    const [entries, foreign] = await Promise.all([
      collectAllUsages(client),
      client.media.findUnique({ where: { id: mediaId }, select: FOREIGN_USAGES_SELECT }),
    ]);
    return [
      ...entries.filter((entry) => entry.mediaId === mediaId),
      ...(foreign === null ? [] : liveForeignUsages(mediaId, foreign)),
    ].flatMap((entry) => entry.tags);
  }

  private async renderVariants(mediaId: string, storageKey: string): Promise<MediaJobOutcome> {
    const media = await this.prisma.media.findUnique({
      where: { id: mediaId },
      select: { storageKey: true, status: true, width: true, mimeType: true },
    });
    if (media === null || media.storageKey !== storageKey || media.status !== 'PROCESSING') return 'skipped';
    const folder = folderOf(storageKey);
    if (folder === null || media.mimeType === 'SVG') {
      // Média livré avec le site ou SVG : aucune variante à produire.
      await this.prisma.media.updateMany({
        where: { id: mediaId, storageKey, status: 'PROCESSING' },
        data: { status: 'READY' },
      });
      return 'ready';
    }
    const file = await this.storage.get(storageKey);
    if (file === null) throw new Error('Fichier d’origine introuvable.');
    const original = await readAll(file.stream);
    const variants = await renderVariants(original, media.width ?? 0);
    for (const variant of variants)
      await this.storage.put(
        variantKey(folder, variant.width, variant.format),
        variant.body,
        `image/${variant.format}`,
      );
    const stored = variants.map((variant) => ({
      storageKey: variantKey(folder, variant.width, variant.format),
      width: variant.width,
      format: variant.format,
    }));
    const updated = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.media.updateMany({
        where: { id: mediaId, storageKey, status: 'PROCESSING' },
        data: { status: 'READY', variants: stored },
      });
      if (count > 0) await requestRevalidation(tx, await this.tagsOf(tx, mediaId));
      return count > 0;
    });
    if (!updated) {
      // Remplacé ou supprimé pendant le traitement : les variantes produites ne servent à rien.
      await Promise.allSettled(stored.map((variant) => this.storage.delete(variant.storageKey)));
      return 'skipped';
    }
    this.logger.log(`Variantes du média ${mediaId} générées (${String(stored.length)}).`);
    return 'ready';
  }

  private async add(name: string, data: MediaJob, opts: JobsOptions): Promise<void> {
    const pending = (async () => {
      this.queue ??= this.createQueue();
      await this.queue.add(name, data, opts);
      return 'done' as const;
    })().catch((error: unknown) => {
      this.logger.error(`Médiathèque : tâche « ${name} » non mise en file (${messageOf(error)}).`);
      return 'failed' as const;
    });
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), QUEUE_TIMEOUT_MS);
      timer.unref();
    });
    const outcome = await Promise.race([pending, timeout]);
    clearTimeout(timer);
    if (outcome === 'timeout')
      this.logger.warn(
        `Redis ne répond pas : tâche « ${name} » de la médiathèque mise en file au rétablissement.`,
      );
  }
}

/** Fabrique par défaut : `Queue` BullMQ sur la connexion partagée. */
export const mediaQueueFactoryProvider = {
  provide: MEDIA_QUEUE_FACTORY,
  inject: [REDIS_CONNECTION, QUEUE_PREFIX],
  useFactory:
    (connection: Redis, prefix: string): MediaQueueFactory =>
    () => {
      const queue = new Queue<MediaJob>(QUEUE_NAMES.media, {
        connection,
        prefix,
        defaultJobOptions: MEDIA_JOB_OPTIONS,
      });
      const logger = new Logger(MediaProcessingService.name);
      queue.on('error', (error: Error) => logger.warn(`File de la médiathèque : ${error.message}`));
      return queue;
    },
};
