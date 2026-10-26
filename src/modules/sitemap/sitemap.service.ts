import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { PUBLISHED, visibleServiceWhere } from '../catalog/catalog.selects.js';
import { NON_INDEXED_PAGE_KEYS, toSitemap, type SitemapEntry } from './sitemap.mapper.js';

@Injectable()
export class SitemapService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** `GET /v1/sitemap` : quatre requêtes en parallèle, colonnes strictement nécessaires. */
  async getSitemap(): Promise<SitemapEntry[]> {
    const now = new Date();
    const [pages, categories, services, jobs] = await Promise.all([
      this.prisma.page.findMany({
        where: {
          publishedAt: { not: null },
          group: { not: 'systeme' },
          key: { notIn: [...NON_INDEXED_PAGE_KEYS] },
        },
        orderBy: { key: 'asc' },
        select: { key: true, path: true, group: true, seo: true, publishedAt: true },
      }),
      this.prisma.category.findMany({
        where: { status: PUBLISHED },
        orderBy: [{ sortOrder: 'asc' }, { slug: 'asc' }],
        select: { slug: true, updatedAt: true },
      }),
      this.prisma.service.findMany({
        where: { AND: [visibleServiceWhere(now), { kind: 'SERVICE' }] },
        orderBy: [{ category: { sortOrder: 'asc' } }, { sortOrder: 'asc' }, { slug: 'asc' }],
        select: { slug: true, kind: true, updatedAt: true, category: { select: { slug: true } } },
      }),
      this.prisma.jobOffer.findMany({
        where: {
          AND: [
            { status: PUBLISHED },
            { OR: [{ publishedAt: null }, { publishedAt: { lte: now } }] },
            { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
          ],
        },
        orderBy: [{ publishedAt: 'desc' }, { slug: 'asc' }],
        select: { slug: true, updatedAt: true },
      }),
    ]);
    return toSitemap({ pages, categories, services, jobs });
  }
}
