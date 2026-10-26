import { Inject, Injectable } from '@nestjs/common';
import type { Lang } from '../../common/i18n/lang.js';
import { notFoundException } from '../../common/problem/problem.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { MediaService } from '../media/media.service.js';
import {
  isPageKey,
  localizePage,
  publishedPageSelect,
  toPage,
  visibleSections,
  type Page,
} from './pages.mapper.js';

export const PAGE_NOT_FOUND = "Cette page n'existe pas ou n'est plus disponible.";

@Injectable()
export class PagesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MediaService) private readonly media: MediaService,
  ) {}

  /**
   * `GET /v1/pages/{key}` : version publiée d'une page, sections désactivées masquées. Une page jamais publiée
   * (`publishedAt` vide) est introuvable. Le paramètre `preview` est accepté mais la prévisualisation du brouillon
   * attend les jetons signés du back-office : la version publiée est renvoyée (`isPreview: false`).
   */
  async getPage(key: string, lang: Lang): Promise<Page> {
    if (!isPageKey(key)) throw notFoundException(PAGE_NOT_FOUND);
    const record = await this.prisma.page.findUnique({ where: { key }, select: publishedPageSelect });
    if (record === null || record.publishedAt === null) throw notFoundException(PAGE_NOT_FOUND);

    const page = localizePage(record, lang);
    const [sections] = await this.media.resolveVisuals(visibleSections(page.sections));
    return toPage({ ...page, key }, sections, record.publishedAt);
  }
}
