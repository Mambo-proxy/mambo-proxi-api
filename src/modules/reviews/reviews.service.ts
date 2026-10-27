import { Inject, Injectable } from '@nestjs/common';
import type { Lang } from '../../common/i18n/lang.js';
import { paginationMeta, pageWindow, type Page } from '../../common/pagination/pagination.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { toReview, toReviewSummary } from '../catalog/catalog.mapper.js';
import { PUBLISHED, categoryRefSelect, reviewSelect } from '../catalog/catalog.selects.js';
import type { Review, ReviewSummary } from '../catalog/catalog.types.js';
import type { ListReviewsQuery, ReviewSummaryQuery } from './review.schemas.js';

/** Avis publié avec l'état de son service (un service retiré du site n'est plus cité). */
const PUBLIC_REVIEW_SELECT = {
  ...reviewSelect,
  service: {
    select: {
      ...reviewSelect.service.select,
      status: true,
      publishedAt: true,
      category: { select: { ...categoryRefSelect, status: true } },
    },
  },
} satisfies Prisma.ReviewSelect;

type PublicReviewRow = Prisma.ReviewGetPayload<{ select: typeof PUBLIC_REVIEW_SELECT }>;

const EMPTY_SUMMARY: ReviewSummary = {
  average: 0,
  total: 0,
  verifiedCount: 0,
  distribution: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 },
};

/** Filtres communs : avis publiés, rubrique ou service (slug français, ou anglais avec `lang=en`). */
function publishedWhere(
  query: { category?: string | undefined; service?: string | undefined },
  lang: Lang,
): Prisma.ReviewWhereInput {
  const and: Prisma.ReviewWhereInput[] = [{ status: 'PUBLIE' }];
  const slug = (value: string) =>
    lang === 'en' ? { OR: [{ slug: value }, { slugEn: value }] } : { slug: value };
  if (query.service !== undefined) and.push({ service: slug(query.service) });
  if (query.category !== undefined) and.push({ service: { category: slug(query.category) } });
  return { AND: and };
}

function isVisible(service: NonNullable<PublicReviewRow['service']>, now: Date): boolean {
  return (
    service.status === PUBLISHED &&
    (service.publishedAt === null || service.publishedAt.getTime() <= now.getTime()) &&
    service.category.status === PUBLISHED
  );
}

/**
 * Avis publiés du site (`GET /v1/reviews`, `GET /v1/reviews/summary`) : seulement le statut « Publié » (consentement
 * vérifié à la publication). Le service d'un avis n'est cité que s'il est visible sur le site.
 */
@Injectable()
export class ReviewsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(query: ListReviewsQuery, now: Date): Promise<Page<Review>> {
    const where: Prisma.ReviewWhereInput = {
      AND: [
        publishedWhere(query, query.lang),
        ...(query.featured === undefined ? [] : [{ featured: query.featured }]),
      ],
    };
    const orderBy: Prisma.ReviewOrderByWithRelationInput[] =
      query.sort === 'rating'
        ? [{ rating: 'desc' }, { date: 'desc' }, { id: 'asc' }]
        : [{ date: 'desc' }, { id: 'asc' }];
    const [total, rows] = await Promise.all([
      this.prisma.review.count({ where }),
      this.prisma.review.findMany({
        where,
        orderBy,
        ...pageWindow(query.page, query.pageSize),
        select: PUBLIC_REVIEW_SELECT,
      }),
    ]);
    return {
      data: rows.map((row) =>
        toReview(
          { ...row, service: row.service && isVisible(row.service, now) ? row.service : null },
          query.lang,
        ),
      ),
      meta: paginationMeta(query.page, query.pageSize, total),
    };
  }

  async summary(query: ReviewSummaryQuery): Promise<ReviewSummary> {
    const rows = await this.prisma.review.findMany({
      where: publishedWhere(query, query.lang),
      select: { rating: true, verified: true },
    });
    return toReviewSummary(rows) ?? EMPTY_SUMMARY;
  }
}
