import { Inject, Injectable } from '@nestjs/common';
import type { Lang } from '../../common/i18n/lang.js';
import { asObject } from '../../common/json/json-read.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CatalogService } from '../catalog/catalog.service.js';
import { MediaService } from '../media/media.service.js';
import { SETTING_KEYS } from '../settings/settings.constants.js';
import { SettingsService } from '../settings/settings.service.js';
import { toNavigation, type Navigation } from './navigation.mapper.js';

/** Schéma `Redirect` du contrat. */
export interface RedirectEntry {
  from: string;
  to: string;
  permanent: boolean;
}

@Injectable()
export class NavigationService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(CatalogService) private readonly catalog: CatalogService,
    @Inject(MediaService) private readonly media: MediaService,
  ) {}

  /** `GET /v1/site/navigation` */
  async getNavigation(lang: Lang): Promise<Navigation> {
    const [groups, categories] = await Promise.all([
      this.settings.readGroups([SETTING_KEYS.navigation], lang),
      this.catalog.publishedCategories(lang),
    ]);
    const [setting] = await this.media.resolveVisuals(asObject(groups.values[SETTING_KEYS.navigation]));
    return toNavigation(setting, categories, lang, new Date().getUTCFullYear());
  }

  /** `GET /v1/site/redirects` : redirections enregistrées lors des changements de slug de contenus publiés. */
  async listRedirects(): Promise<RedirectEntry[]> {
    const redirects = await this.prisma.redirect.findMany({
      orderBy: [{ createdAt: 'asc' }, { fromPath: 'asc' }],
      select: { fromPath: true, toPath: true, permanent: true },
    });
    return redirects.map((redirect) => ({
      from: redirect.fromPath,
      to: redirect.toPath,
      permanent: redirect.permanent,
    }));
  }
}
