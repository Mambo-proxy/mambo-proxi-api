import { Controller, Get, Inject, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { PREVIEW_CACHE_CONTROL, PublicCache } from '../../common/http-cache/http-cache.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { Public } from '../auth/auth.decorators.js';
import type { PublicMagazine } from './magazine.mapper.js';
import { magazineQuerySchema, type MagazineQuery } from './magazine.schemas.js';
import { MagazineService } from './magazine.service.js';

/** Magazine du site (tag « Contenus » du contrat). */
@ApiTags('Contenus')
@Public()
@Controller('magazine')
export class MagazineController {
  constructor(@Inject(MagazineService) private readonly magazine: MagazineService) {}

  /** `GET /v1/magazine` : édition affichée et éditions publiées. */
  @Get()
  @PublicCache()
  @ApiOperation({ operationId: 'getMagazine', summary: 'Magazine — édition affichée et éditions publiées' })
  get(
    @Query(new ZodValidationPipe(magazineQuerySchema)) query: MagazineQuery,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PublicMagazine> {
    const now = new Date();
    // Aperçu d'une édition : jamais conservé par un cache partagé.
    if (this.magazine.previewEditionId(query.preview, now) !== null)
      response.setHeader('Cache-Control', PREVIEW_CACHE_CONTROL);
    return this.magazine.getMagazine(query, now);
  }
}
