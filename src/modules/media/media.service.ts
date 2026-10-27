import { Inject, Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service.js';
import type { IllustrationScene } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { collectOwnerUsages, writeOwnerUsages, type UsageOwner } from './media-usages.js';
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
  private readonly logger = new Logger(MediaService.name);
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

  /**
   * Identifiants qui ne désignent aucun média utilisable de la médiathèque (absent, ou traitement échoué) : les
   * contenus du back-office ne font que référencer des médias déjà envoyés (une seule requête).
   */
  async unknownIds(ids: Iterable<string>): Promise<Set<string>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Set();
    const found = await this.prisma.media.findMany({
      where: { id: { in: unique }, status: { not: 'FAILED' } },
      select: { id: true },
    });
    const known = new Set(found.map((item) => item.id));
    return new Set(unique.filter((id) => !known.has(id)));
  }

  /** Résout les références `{ illustration, imageId, alt }` de plusieurs JSON avec une seule requête. */
  async resolveVisuals<T extends readonly unknown[]>(...values: T): Promise<T> {
    const ids = new Set<string>();
    for (const value of values) collectImageIds(value, ids);
    const media = await this.findByIds(ids);
    return values.map((value) => resolveJsonVisuals(value, media, this.publicBaseUrl)) as unknown as T;
  }

  /**
   * Réécrit les usages des médias (`media_usages`) des contenus enregistrés, après la validation de leur
   * transaction. Sans effet sur l'enregistrement s'il échoue (journalisé) : la table est reconstruite au démarrage
   * du worker de la médiathèque, et la suppression d'un média recalcule ses usages sur les contenus.
   */
  async refreshUsages(...owners: UsageOwner[]): Promise<void> {
    for (const owner of owners) {
      try {
        const entries = await collectOwnerUsages(this.prisma, owner);
        await writeOwnerUsages(this.prisma, owner, entries);
      } catch (error) {
        this.logger.warn(
          `Usages des médias non mis à jour (${owner.kind}) : ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
}
