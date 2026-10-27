import { Inject, Injectable, Logger } from '@nestjs/common';
import { CACHE_TAGS, requestRevalidation } from '../../common/revalidation/revalidation.js';
import { PrismaService } from '../../prisma/prisma.service.js';

/** Éditions dont la date est passée depuis au plus ce délai (au-delà, une revalidation a forcément eu lieu). */
const LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

const MAGAZINE_TAG = CACHE_TAGS.page('magazine');

/**
 * Mise en ligne des éditions programmées du magazine (tâche planifiée, toutes les 5 min). Une édition `SCHEDULED`
 * devient publiée à la lecture, une fois sa date passée (`effectiveStatus`) : rien n'est écrit à ce moment-là, donc
 * rien ne demande la revalidation de la page du magazine. Cette tâche inscrit `page:magazine` dans
 * `revalidation_requests` pour chaque édition dont la date vient de passer, une seule fois : une édition est
 * considérée comme traitée dès qu'une demande contenant `page:magazine` a été inscrite après sa date de publication
 * (par cette tâche ou par une modification du back-office), ce qui suffit à afficher l'édition sur le site.
 */
@Injectable()
export class MagazinePublicationService {
  private readonly logger = new Logger(MagazinePublicationService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async revalidateDueEditions(now: Date): Promise<number> {
    const editions = await this.prisma.magazineEdition.findMany({
      where: {
        status: 'SCHEDULED',
        publishAt: { lte: now, gte: new Date(now.getTime() - LOOKBACK_MS) },
      },
      select: { id: true, publishAt: true },
      orderBy: { publishAt: 'asc' },
    });
    if (editions.length === 0) return 0;

    const earliest = editions[0]?.publishAt ?? now;
    const requests = await this.prisma.revalidationRequest.findMany({
      where: { tags: { has: MAGAZINE_TAG }, createdAt: { gte: earliest } },
      select: { createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 1,
    });
    const lastRequest = requests[0]?.createdAt ?? null;
    const due = editions.filter(
      (edition) =>
        edition.publishAt !== null &&
        (lastRequest === null || lastRequest.getTime() < edition.publishAt.getTime()),
    );
    if (due.length === 0) return 0;
    await requestRevalidation(this.prisma, [MAGAZINE_TAG]);
    this.logger.log(`Magazine : ${String(due.length)} édition(s) mise(s) en ligne, revalidation demandée.`);
    return due.length;
  }
}
