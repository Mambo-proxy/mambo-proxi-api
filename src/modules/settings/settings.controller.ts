import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PublicCache } from '../../common/http-cache/http-cache.js';
import { langQuerySchema, type LangQuery } from '../../common/i18n/lang.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { SettingsService } from './settings.service.js';
import type { SiteSettings } from './site-settings.mapper.js';

@ApiTags('Site')
@Controller('site')
export class SettingsController {
  constructor(@Inject(SettingsService) private readonly settings: SettingsService) {}

  /** `GET /v1/site/settings` : coordonnées, WhatsApp, réseaux, agence, chiffres clés, clés publiques. */
  @Get('settings')
  @ApiOperation({ operationId: 'getSiteSettings', summary: 'Paramètres publics du site' })
  @PublicCache()
  getSiteSettings(@Query(new ZodValidationPipe(langQuerySchema)) query: LangQuery): Promise<SiteSettings> {
    return this.settings.getSiteSettings(query.lang);
  }
}
