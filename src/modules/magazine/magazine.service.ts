import { Inject, Injectable } from '@nestjs/common';
import type { Lang } from '../../common/i18n/lang.js';
import { verifyPreviewToken } from '../../common/preview/preview-token.js';
import { notFoundException } from '../../common/problem/problem.js';
import { AppConfigService } from '../../config/app-config.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { MediaService } from '../media/media.service.js';
import {
  LATEST_EDITION_ORDER,
  MAGAZINE_EDITION_SELECT,
  toPublicEdition,
  toPublicSummary,
  visibleEditionWhere,
  type ImageResolver,
  type PublicMagazine,
} from './magazine.mapper.js';
import type { MagazineQuery } from './magazine.schemas.js';

export const PUBLIC_EDITION_NOT_FOUND = 'Cette édition du magazine n’existe pas ou n’est plus publiée.';

/**
 * Magazine du site (`GET /v1/magazine`, tag « Contenus ») : éditions publiées (ou programmées dont la date est
 * passée), de la plus récente à la plus ancienne, et l'édition affichée — la dernière, celle du paramètre `edition`,
 * ou celle d'un jeton d'aperçu du back-office (quel que soit son statut). Champs anglais repliés sur le français un
 * par un.
 */
@Injectable()
export class MagazineService {
  private readonly image: ImageResolver;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MediaService) private readonly media: MediaService,
    @Inject(AppConfigService) private readonly config: AppConfigService,
  ) {
    this.image = (record) => this.media.image(record);
  }

  /** Édition du jeton d'aperçu (`?preview=`) valide ; sinon `null`. */
  previewEditionId(preview: string | undefined, now: Date): string | null {
    if (preview === undefined || preview === '') return null;
    return verifyPreviewToken(this.config.get('TOKEN_SIGNING_SECRET'), preview, 'magazine', now)?.id ?? null;
  }

  async getMagazine(query: MagazineQuery, now: Date): Promise<PublicMagazine> {
    const lang: Lang = query.lang;
    const rows = await this.prisma.magazineEdition.findMany({
      where: visibleEditionWhere(now),
      orderBy: [...LATEST_EDITION_ORDER],
      select: MAGAZINE_EDITION_SELECT,
    });
    const editions = rows.map((row) => toPublicSummary(row, lang, this.image));

    const previewId = this.previewEditionId(query.preview, now);
    if (previewId !== null) {
      const row = await this.prisma.magazineEdition.findUnique({
        where: { id: previewId },
        select: MAGAZINE_EDITION_SELECT,
      });
      if (!row) throw notFoundException(PUBLIC_EDITION_NOT_FOUND);
      return { edition: toPublicEdition(row, lang, this.image), editions, isPreview: true };
    }

    const current = query.edition === undefined ? rows[0] : rows.find((row) => row.id === query.edition);
    if (query.edition !== undefined && current === undefined)
      throw notFoundException(PUBLIC_EDITION_NOT_FOUND);
    return {
      edition: current ? toPublicEdition(current, lang, this.image) : null,
      editions,
      isPreview: false,
    };
  }
}
