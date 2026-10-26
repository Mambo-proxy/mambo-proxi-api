import { Inject, Injectable } from '@nestjs/common';
import type { Lang } from '../../common/i18n/lang.js';
import { localize } from '../../common/i18n/translations.js';
import { asObject, readNullableString } from '../../common/json/json-read.js';
import { AppConfigService } from '../../config/app-config.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { MediaService } from '../media/media.service.js';
import { SETTING_KEYS, SITE_SETTINGS_KEYS, type SettingKey } from './settings.constants.js';
import {
  TURNSTILE_TEST_SITE_KEY,
  toSiteSettings,
  type SettingValues,
  type SiteSettings,
} from './site-settings.mapper.js';

export interface SettingGroups {
  values: SettingValues;
  /** Dernière modification parmi les groupes lus ; `null` si aucun n'existe. */
  updatedAt: Date | null;
}

/** Lecture des paramètres (table `settings`), dans la langue demandée. */
@Injectable()
export class SettingsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MediaService) private readonly media: MediaService,
    @Inject(AppConfigService) private readonly config: AppConfigService,
  ) {}

  /** Groupes demandés, en une requête ; un groupe absent n'apparaît pas dans `values`. */
  async readGroups(keys: readonly SettingKey[], lang: Lang): Promise<SettingGroups> {
    const rows = await this.prisma.setting.findMany({
      where: { key: { in: [...keys] } },
      select: { key: true, value: true, translations: true, updatedAt: true },
    });
    const values: SettingValues = {};
    let updatedAt: Date | null = null;
    for (const row of rows) {
      values[row.key as SettingKey] = asObject(localize(row.value, row.translations, lang));
      if (updatedAt === null || row.updatedAt > updatedAt) updatedAt = row.updatedAt;
    }
    return { values, updatedAt };
  }

  /** `GET /v1/site/settings`. */
  async getSiteSettings(lang: Lang): Promise<SiteSettings> {
    const { values, updatedAt } = await this.readGroups(SITE_SETTINGS_KEYS, lang);
    const ogImageId = readNullableString(asObject(values[SETTING_KEYS.seo]), 'ogImageId');
    const ogImage =
      ogImageId === null ? null : this.media.image((await this.media.findByIds([ogImageId])).get(ogImageId));
    return toSiteSettings(values, {
      // Le contrat exige une adresse absolue (`format: uri`) : une image livrée avec le site n'y figure pas.
      ogImageUrl: ogImage !== null && /^https?:\/\//.test(ogImage.url) ? ogImage.url : null,
      turnstileSiteKey: this.config.isProduction ? '' : TURNSTILE_TEST_SITE_KEY,
      updatedAt,
    });
  }
}
