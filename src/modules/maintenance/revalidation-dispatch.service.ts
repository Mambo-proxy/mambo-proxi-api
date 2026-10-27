import { Inject, Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';

/** Demandes traitées par passage (au plus). */
export const REVALIDATION_BATCH_SIZE = 50;
/** Étiquettes par appel (limite de la route du site). */
export const REVALIDATION_TAGS_PER_CALL = 100;
/** Tentatives avant l'état `FAILED`. */
export const REVALIDATION_MAX_ATTEMPTS = 8;
/** Attente de base entre deux tentatives : 30 s, doublée à chaque échec (30 s, 1, 2, 4… min ; ~1 h en tout). */
export const REVALIDATION_BASE_DELAY_S = 30;
/** Délai de réponse du site. */
const REQUEST_TIMEOUT_MS = 10_000;

export interface RevalidationOutcome {
  requests: number;
  tags: number;
  sent: boolean;
}

export type RevalidationFetch = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Envoi des demandes de revalidation du site (`revalidation_requests`, inscrites par les modules de contenu dans la
 * transaction de chaque modification visible). À chaque passage de la tâche planifiée (toutes les 15 s) :
 * - réservation atomique des demandes `PENDING` dont l'attente est écoulée (`FOR UPDATE SKIP LOCKED` → `RUNNING`) ;
 * - étiquettes regroupées et dédoublonnées, envoyées par paquets de 100 à `POST {WEB_URL}/api/revalidate`
 *   (`Authorization: Bearer REVALIDATE_SECRET`, corps `{ "tags": [...] }`, route du site `src/app/api/revalidate`) ;
 * - succès → `SUCCEEDED` (`sentAt`) ; échec → nouvelle tentative après une attente croissante (30 s × 2^(n-1), comptée
 *   depuis la création), puis `FAILED` après 8 tentatives (dernière erreur gardée dans `lastError`).
 * Une revalidation est idempotente : un paquet rejoué après une coupure ne pose aucun problème.
 */
@Injectable()
export class RevalidationDispatchService {
  private readonly logger = new Logger(RevalidationDispatchService.name);
  private fetchImpl: RevalidationFetch = (url, init) => fetch(url, init);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AppConfigService) private readonly config: AppConfigService,
  ) {}

  /** Remplace `fetch` (tests). */
  useFetch(fetchImpl: RevalidationFetch): void {
    this.fetchImpl = fetchImpl;
  }

  /** Demandes restées `RUNNING` après un arrêt brutal du worker : remises en attente (au démarrage). */
  async recoverInterrupted(): Promise<number> {
    const { count } = await this.prisma.revalidationRequest.updateMany({
      where: { status: 'RUNNING' },
      data: { status: 'PENDING' },
    });
    return count;
  }

  async dispatch(now: Date): Promise<RevalidationOutcome> {
    const claimed = await this.prisma.$queryRaw<{ id: string; tags: string[]; attempts: number }[]>`
      UPDATE "revalidation_requests" SET "status" = 'RUNNING'
      WHERE "id" IN (
        SELECT "id" FROM "revalidation_requests"
        WHERE "status" = 'PENDING'
          AND "created_at" + (POWER(2, "attempts") - 1) * ${REVALIDATION_BASE_DELAY_S} * INTERVAL '1 second' <= ${now}
        ORDER BY "created_at"
        LIMIT ${REVALIDATION_BATCH_SIZE}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING "id", "tags", "attempts"`;
    if (claimed.length === 0) return { requests: 0, tags: 0, sent: false };

    const tags = [...new Set(claimed.flatMap((row) => row.tags))].sort();
    const ids = claimed.map((row) => row.id);
    try {
      for (let index = 0; index < tags.length; index += REVALIDATION_TAGS_PER_CALL)
        await this.send(tags.slice(index, index + REVALIDATION_TAGS_PER_CALL));
      await this.prisma.revalidationRequest.updateMany({
        where: { id: { in: ids } },
        data: { status: 'SUCCEEDED', sentAt: new Date(), attempts: { increment: 1 }, lastError: null },
      });
      return { requests: ids.length, tags: tags.length, sent: true };
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
      const exhausted = claimed
        .filter((row) => row.attempts + 1 >= REVALIDATION_MAX_ATTEMPTS)
        .map((row) => row.id);
      const retried = ids.filter((id) => !exhausted.includes(id));
      await this.prisma.$transaction([
        this.prisma.revalidationRequest.updateMany({
          where: { id: { in: retried } },
          data: { status: 'PENDING', attempts: { increment: 1 }, lastError: message },
        }),
        this.prisma.revalidationRequest.updateMany({
          where: { id: { in: exhausted } },
          data: { status: 'FAILED', attempts: { increment: 1 }, lastError: message },
        }),
      ]);
      if (exhausted.length > 0)
        this.logger.error(
          `Revalidation du site abandonnée après ${String(REVALIDATION_MAX_ATTEMPTS)} tentatives ` +
            `(${String(exhausted.length)} demande(s)) : ${message}`,
        );
      else
        this.logger.warn(`Revalidation du site reportée (${String(retried.length)} demande(s)) : ${message}`);
      return { requests: ids.length, tags: tags.length, sent: false };
    }
  }

  private async send(tags: string[]): Promise<void> {
    const url = new URL('/api/revalidate', this.config.get('WEB_URL')).toString();
    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.get('REVALIDATE_SECRET')}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ tags }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`le site a répondu ${String(response.status)} à /api/revalidate`);
  }
}
