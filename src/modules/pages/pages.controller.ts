import { Controller, Get, Inject, Param, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { PREVIEW_CACHE_CONTROL, PublicCache } from '../../common/http-cache/http-cache.js';
import { langSchema, previewSchema } from '../../common/i18n/lang.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import type { Page } from './pages.mapper.js';
import { PagesService } from './pages.service.js';
import { Public } from '../auth/auth.decorators.js';

const pageQuerySchema = z.object({ lang: langSchema, preview: previewSchema });
type PageQuery = z.output<typeof pageQuerySchema>;

@ApiTags('Site')
@Public()
@Controller('pages')
export class PagesController {
  constructor(@Inject(PagesService) private readonly pages: PagesService) {}

  /** `GET /v1/pages/{key}` : sections publiées d'une page éditoriale. */
  @Get(':key')
  @ApiOperation({ operationId: 'getPage', summary: "Sections publiées d'une page éditoriale" })
  @PublicCache()
  getPage(
    @Param('key') key: string,
    @Query(new ZodValidationPipe(pageQuerySchema)) query: PageQuery,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Page> {
    const now = new Date();
    // Aperçu d'un brouillon : jamais conservé par un cache partagé.
    if (this.pages.isPreview(key, query.preview, now))
      response.setHeader('Cache-Control', PREVIEW_CACHE_CONTROL);
    return this.pages.getPage(key, query.lang, query.preview, now);
  }
}
