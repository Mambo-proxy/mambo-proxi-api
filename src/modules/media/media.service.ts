import { Inject, Injectable } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service.js';
import type { IllustrationScene } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  collectImageIds,
  mediaImageSelect,
  resolveJsonVisuals,
  toMediaImage,
  toVisual,
  type MediaImage,
  type MediaRecord,
  type Visual,
} from './visual.mapper.js';

/** Images publiques : adresses des fichiers et visuels référencés dans des JSON (chargés en une requête). */
@Injectable()
export class MediaService {
  private readonly publicBaseUrl: string;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AppConfigService) config: AppConfigService,
  ) {
    this.publicBaseUrl = config.get('MEDIA_PUBLIC_URL');
  }

  image(media: MediaRecord | null | undefined): MediaImage | null {
    return toMediaImage(media, this.publicBaseUrl);
  }

  visual(
    illustration: IllustrationScene | null | undefined,
    media: MediaRecord | null | undefined,
    alt?: string | null,
  ): Visual {
    return toVisual(illustration, media, this.publicBaseUrl, alt);
  }

  /** Médias par identifiant (une seule requête, aucune si la liste est vide). */
  async findByIds(ids: Iterable<string>): Promise<Map<string, MediaRecord>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const media = await this.prisma.media.findMany({
      where: { id: { in: unique } },
      select: mediaImageSelect,
    });
    return new Map(media.map((item) => [item.id, item]));
  }

  /** Résout les références `{ illustration, imageId, alt }` de plusieurs JSON avec une seule requête. */
  async resolveVisuals<T extends readonly unknown[]>(...values: T): Promise<T> {
    const ids = new Set<string>();
    for (const value of values) collectImageIds(value, ids);
    const media = await this.findByIds(ids);
    return values.map((value) => resolveJsonVisuals(value, media, this.publicBaseUrl)) as unknown as T;
  }
}
