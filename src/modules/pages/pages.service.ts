import { Inject, Injectable } from '@nestjs/common';
import type { Lang } from '../../common/i18n/lang.js';
import { verifyPreviewToken } from '../../common/preview/preview-token.js';
import { notFoundException } from '../../common/problem/problem.js';
import { AppConfigService } from '../../config/app-config.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { MediaService } from '../media/media.service.js';
import {
  isPageKey,
  localizePage,
  publishedPageSelect,
  toPage,
  visibleSections,
  type Page,
  type PageKey,
} from './pages.mapper.js';

export const PAGE_NOT_FOUND = "Cette page n'existe pas ou n'est plus disponible.";

@Injectable()
export class PagesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MediaService) private readonly media: MediaService,
    @Inject(AppConfigService) private readonly config: AppConfigService,
  ) {}

  /** Le jeton d'aperçu (`?preview=`) est-il valide pour cette page ? */
  isPreview(key: string, preview: string | undefined, now: Date): boolean {
    if (preview === undefined || preview === '') return false;
    return verifyPreviewToken(this.config.get('TOKEN_SIGNING_SECRET'), preview, 'page', now)?.id === key;
  }

  /**
   * `GET /v1/pages/{key}` : version publiée d'une page, sections désactivées masquées. Une page jamais publiée
   * (`publishedAt` vide) est introuvable. Avec un jeton d'aperçu valide pour cette page (`?preview=`, émis par le
   * back-office), le brouillon est renvoyé (`isPreview: true`), même si la page n'a jamais été publiée.
   */
  async getPage(key: string, lang: Lang, preview?: string, now = new Date()): Promise<Page> {
    if (!isPageKey(key)) throw notFoundException(PAGE_NOT_FOUND);
    if (this.isPreview(key, preview, now)) return this.getDraft(key, lang);
    const record = await this.prisma.page.findUnique({ where: { key }, select: publishedPageSelect });
    if (record === null || record.publishedAt === null) throw notFoundException(PAGE_NOT_FOUND);

    const page = localizePage(record, lang);
    const [sections] = await this.media.resolveVisuals(visibleSections(page.sections));
    return toPage({ ...page, key }, sections, record.publishedAt);
  }

  /** Brouillon (ou version publiée s'il n'y en a pas), sections masquées exclues comme sur le site. */
  private async getDraft(key: PageKey, lang: Lang): Promise<Page> {
    const record = await this.prisma.page.findUnique({
      where: { key },
      select: {
        ...publishedPageSelect,
        draftSections: true,
        draftSeo: true,
        draftTranslations: true,
        draftUpdatedAt: true,
        updatedAt: true,
      },
    });
    if (record === null) throw notFoundException(PAGE_NOT_FOUND);
    const draft = {
      key: record.key,
      title: record.title,
      sections: record.draftSections ?? record.sections,
      seo: record.draftSections === null ? record.seo : (record.draftSeo ?? record.seo),
      translations: record.draftTranslations ?? record.translations,
      publishedAt: record.publishedAt,
    };
    const page = localizePage(draft, lang);
    const [sections] = await this.media.resolveVisuals(visibleSections(page.sections));
    return {
      ...toPage({ ...page, key }, sections, record.draftUpdatedAt ?? record.updatedAt),
      isPreview: true,
    };
  }
}
