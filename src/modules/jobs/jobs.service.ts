import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ProblemException, notFoundException } from '../../common/problem/problem.js';
import { searchKey } from '../../common/text/search-key.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { isSlug } from '../catalog/catalog.schemas.js';
import {
  JOB_OFFER_SELECT,
  toJobOfferDetail,
  toJobOfferSummary,
  visibleJobWhere,
  type JobOfferDetail,
  type JobOfferSummary,
} from './job.mapper.js';
import type { JobDetailQuery, ListJobsQuery } from './job.schemas.js';

export const JOB_NOT_FOUND = 'Cette offre n’existe pas ou n’est plus publiée.';

/** 410 `job-closed` : offre archivée (pourvue) ou expirée. */
export function jobClosedException(): ProblemException {
  return new ProblemException({
    status: HttpStatus.GONE,
    type: 'job-closed',
    title: 'Offre pourvue',
    detail: 'Cette offre n’est plus disponible. Découvrez nos autres postes ouverts.',
  });
}

/**
 * Offres d'emploi du site (`GET /v1/jobs`, `GET /v1/jobs/{slug}`) : offres publiées, non expirées, des plus récentes
 * aux plus anciennes. Filtres `city` et `contract` (début du libellé affiché) et `q` (titre et accroche), sans
 * accents ni casse, appliqués au texte dans la langue demandée (comme le filtrage instantané du site).
 */
@Injectable()
export class JobsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(query: ListJobsQuery, now: Date): Promise<JobOfferSummary[]> {
    const rows = await this.prisma.jobOffer.findMany({
      where: visibleJobWhere(now),
      orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
      select: JOB_OFFER_SELECT,
    });
    const city = query.city ? searchKey(query.city) : null;
    const contract = query.contract ? searchKey(query.contract) : null;
    const q = query.q ? searchKey(query.q) : null;
    return rows
      .map((row) => toJobOfferSummary(row, query.lang, now))
      .filter(
        (job) =>
          (!city || searchKey(job.city).startsWith(city)) &&
          (!contract || searchKey(job.contractType).startsWith(contract)) &&
          (!q || searchKey(job.title, job.summary).includes(q)),
      );
  }

  /**
   * Détail d'une offre visible ; offre archivée (pourvue) ou expirée → 410 `job-closed` ; brouillon ou inconnue →
   * 404. Le paramètre `preview` est accepté mais sans effet : le back-office n'émet pas de jeton d'aperçu d'offre.
   */
  async detail(slug: string, query: JobDetailQuery, now: Date): Promise<JobOfferDetail> {
    if (!isSlug(slug)) throw notFoundException(JOB_NOT_FOUND);
    const row = await this.prisma.jobOffer.findUnique({ where: { slug }, select: JOB_OFFER_SELECT });
    if (!row || row.status === 'DRAFT') throw notFoundException(JOB_NOT_FOUND);
    if (row.publishedAt !== null && row.publishedAt.getTime() > now.getTime())
      throw notFoundException(JOB_NOT_FOUND);
    if (row.status === 'ARCHIVED' || (row.expiresAt !== null && row.expiresAt.getTime() <= now.getTime()))
      throw jobClosedException();
    return toJobOfferDetail(row, query.lang, now);
  }
}
