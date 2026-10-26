import { Inject, Injectable } from '@nestjs/common';
import type { Lang } from '../../common/i18n/lang.js';
import { asObject } from '../../common/json/json-read.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { SETTING_KEYS } from '../settings/settings.constants.js';
import { SettingsService } from '../settings/settings.service.js';
import { publicZoneSelect, toServiceAreas, type ServiceAreas } from './zones.mapper.js';

@Injectable()
export class ZonesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SettingsService) private readonly settings: SettingsService,
  ) {}

  /** `GET /v1/zones` : zones actives dans l'ordre du back-office, avec leurs quartiers. */
  async getServiceAreas(lang: Lang): Promise<ServiceAreas> {
    const [zones, groups] = await Promise.all([
      this.prisma.zone.findMany({
        where: { active: true },
        orderBy: [{ sortOrder: 'asc' }, { key: 'asc' }],
        select: publicZoneSelect,
      }),
      this.settings.readGroups([SETTING_KEYS.zones], lang),
    ]);
    const setting = asObject(groups.values[SETTING_KEYS.zones]);
    return toServiceAreas(zones, setting, groups.values[SETTING_KEYS.zones] ? groups.updatedAt : null, lang);
  }
}
