import { Inject, Injectable } from '@nestjs/common';
import type { Lang } from '../../common/i18n/lang.js';
import { verifyPreviewToken } from '../../common/preview/preview-token.js';
import { notFoundException } from '../../common/problem/problem.js';
import { AppConfigService } from '../../config/app-config.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { MediaService } from '../media/media.service.js';
import {
  localizeCategorySummary,
  toCategoryDetail,
  toCategorySummary,
  toCategoryVisuals,
  toServiceDetail,
  toServiceSummary,
  type CategoryVisuals,
} from './catalog.mapper.js';
import type { CatalogDetailQuery, ListCategoriesQuery, ListServicesQuery } from './catalog.schemas.js';
import { isSlug } from './catalog.schemas.js';
import {
  PUBLISHED,
  categoryDetailSelect,
  categorySummarySelect,
  publishedServiceWhere,
  reviewSelect,
  serviceDetailSelect,
  serviceSummarySelect,
  visibleServiceWhere,
  type CategorySummaryRecord,
} from './catalog.selects.js';
import type { CategoryDetail, CategorySummary, ServiceDetail, ServiceSummary } from './catalog.types.js';

export const CATEGORY_NOT_FOUND = "Cette rubrique n'existe pas ou n'est plus disponible.";
export const SERVICE_NOT_FOUND = "Ce service n'existe pas ou n'est plus disponible.";

/** Nombre de cartes « Nos autres rubriques » d'une page rubrique. */
const OTHER_CATEGORIES_COUNT = 3;

/** Rubrique publiée, traduite, avec ses visuels secondaires résolus. */
interface CategoryEntry {
  record: CategorySummaryRecord;
  visuals: CategoryVisuals;
}

/** Rubrique publiée et ses services publiés, pour la navigation. */
export interface PublishedCategory {
  summary: CategorySummary;
  services: { summary: ServiceSummary; showInMenu: boolean }[];
}

/** Recherche insensible à la casse et aux accents. */
export function normalizeSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('fr');
}

/** Slug français, ou slug anglais (`slugEn`) pour une adresse `/en/…`. */
type SlugWhere = { slug: string } | { OR: [{ slug: string }, { slugEn: string }] };

function slugWhere(slug: string, lang: Lang): SlugWhere {
  return lang === 'en' ? { OR: [{ slug }, { slugEn: slug }] } : { slug };
}

/** Rubriques et services publiés (lecture publique). */
@Injectable()
export class CatalogService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MediaService) private readonly media: MediaService,
    @Inject(AppConfigService) private readonly config: AppConfigService,
  ) {}

  /** Identifiant du service désigné par un jeton d'aperçu valide du back-office, sinon `undefined`. */
  previewServiceId(preview: string | undefined, now: Date): string | undefined {
    if (preview === undefined || preview === '') return undefined;
    return verifyPreviewToken(this.config.get('TOKEN_SIGNING_SECRET'), preview, 'service', now)?.id;
  }

  /** Rubriques publiées dans l'ordre du back-office, avec leurs services publiés (deux requêtes au plus). */
  private async loadCategories(lang: Lang, now: Date): Promise<CategoryEntry[]> {
    const categories = await this.prisma.category.findMany({
      where: { status: PUBLISHED },
      orderBy: [{ sortOrder: 'asc' }, { slug: 'asc' }],
      select: categorySummarySelect(now),
    });
    const localized = categories.map((category) => localizeCategorySummary(category, lang));
    const visuals = await this.media.resolveVisuals(...localized.map((category) => category.visuals));
    return localized.map((record, index) => ({ record, visuals: toCategoryVisuals(visuals[index]) }));
  }

  private summaries(entries: CategoryEntry[], lang: Lang, includeServices: boolean): CategorySummary[] {
    return entries.map((entry, rank) =>
      toCategorySummary(entry.record, lang, this.media, { rank, visuals: entry.visuals, includeServices }),
    );
  }

  /** `GET /v1/categories` */
  async listCategories(query: ListCategoriesQuery): Promise<CategorySummary[]> {
    const entries = await this.loadCategories(query.lang, new Date());
    return this.summaries(entries, query.lang, query.include === 'services');
  }

  /** Rubriques publiées et services publiés (méga-menu, plan du site). */
  async publishedCategories(lang: Lang): Promise<PublishedCategory[]> {
    const entries = await this.loadCategories(lang, new Date());
    return this.summaries(entries, lang, false).map((summary, index) => ({
      summary,
      services: (entries[index]?.record.services ?? []).map((service) => ({
        summary: toServiceSummary(service, lang, this.media),
        showInMenu: service.showInMenu,
      })),
    }));
  }

  /** `GET /v1/categories/{slug}` */
  async getCategory(slug: string, query: CatalogDetailQuery): Promise<CategoryDetail> {
    if (!isSlug(slug)) throw notFoundException(CATEGORY_NOT_FOUND);
    const { lang } = query;
    const now = new Date();
    const [entries, detail] = await Promise.all([
      this.loadCategories(lang, now),
      this.prisma.category.findFirst({
        where: { AND: [{ status: PUBLISHED }, slugWhere(slug, lang)] },
        select: categoryDetailSelect,
      }),
    ]);
    const rank = detail === null ? -1 : entries.findIndex((entry) => entry.record.id === detail.id);
    const current = entries[rank];
    if (detail === null || current === undefined) throw notFoundException(CATEGORY_NOT_FOUND);

    const summaries = this.summaries(entries, lang, false);
    return toCategoryDetail(detail, lang, this.media, {
      summary: summaries[rank],
      visuals: current.visuals,
      services: current.record.services.map((service) => toServiceSummary(service, lang, this.media)),
      otherCategories: summaries.filter((_, index) => index !== rank).slice(0, OTHER_CATEGORIES_COUNT),
      image: this.media.image(current.record.image),
      now,
    });
  }

  /** `GET /v1/services` : services publiés, triés par rubrique puis ordre. */
  async listServices(query: ListServicesQuery): Promise<ServiceSummary[]> {
    const now = new Date();
    const services = await this.prisma.service.findMany({
      where: {
        AND: [
          publishedServiceWhere(now),
          {
            category: {
              status: PUBLISHED,
              ...(query.category === undefined ? {} : { slug: query.category }),
            },
          },
          query.featured === undefined ? {} : { featuredOnHome: query.featured },
        ],
      },
      orderBy: [{ category: { sortOrder: 'asc' } }, { sortOrder: 'asc' }, { slug: 'asc' }],
      select: serviceSummarySelect,
    });
    const summaries = services.map((service) => toServiceSummary(service, query.lang, this.media));
    const needle = query.q === undefined ? '' : normalizeSearch(query.q);
    if (needle === '') return summaries;
    // Recherche simple sur le nom et le résumé, dans la langue demandée (une trentaine de services au plus) ;
    // la recherche plein texte (`unaccent`, `tsvector`) est celle de `GET /v1/search`.
    return summaries.filter((service) =>
      normalizeSearch(`${service.name} ${service.shortName ?? ''} ${service.summary}`).includes(needle),
    );
  }

  /**
   * `GET /v1/services/{slug}` : fiche avec services liés, offres et avis publiés. Avec un jeton d'aperçu valide
   * (`?preview=`, émis pour ce service), la fiche est renvoyée quel que soit son statut ou celui de sa rubrique.
   */
  async getService(slug: string, query: CatalogDetailQuery, now = new Date()): Promise<ServiceDetail> {
    if (!isSlug(slug)) throw notFoundException(SERVICE_NOT_FOUND);
    const { lang } = query;
    const previewId = this.previewServiceId(query.preview, now);
    const service = await this.prisma.service.findFirst({
      where: {
        AND: [previewId === undefined ? visibleServiceWhere(now) : { id: previewId }, slugWhere(slug, lang)],
      },
      select: serviceDetailSelect,
    });
    if (service === null) throw notFoundException(SERVICE_NOT_FOUND);

    const publishedReviews = await this.prisma.review.findMany({
      where: { serviceId: service.id, status: 'PUBLIE' },
      orderBy: [{ date: 'desc' }, { id: 'asc' }],
      select: reviewSelect,
    });
    return toServiceDetail(service, lang, this.media, { publishedReviews, now });
  }
}
