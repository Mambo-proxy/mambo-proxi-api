import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { PublicCache } from '../../common/http-cache/http-cache.js';
import { langSchema, previewSchema } from '../../common/i18n/lang.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import type { Page } from './pages.mapper.js';
import { PagesService } from './pages.service.js';

const pageQuerySchema = z.object({ lang: langSchema, preview: previewSchema });
type PageQuery = z.output<typeof pageQuerySchema>;

@ApiTags('Site')
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
  ): Promise<Page> {
    return this.pages.getPage(key, query.lang);
  }
}
