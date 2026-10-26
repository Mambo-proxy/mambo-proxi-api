import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PublicCache } from '../../common/http-cache/http-cache.js';
import { langQuerySchema, type LangQuery } from '../../common/i18n/lang.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import type { ServiceAreas } from './zones.mapper.js';
import { ZonesService } from './zones.service.js';
import { Public } from '../auth/auth.decorators.js';

@ApiTags('Site')
@Public()
@Controller('zones')
export class ZonesController {
  constructor(@Inject(ZonesService) private readonly zones: ZonesService) {}

  /** `GET /v1/zones` : zones d'intervention et quartiers desservis. */
  @Get()
  @ApiOperation({ operationId: 'getServiceAreas', summary: "Zones d'intervention et quartiers desservis" })
  @PublicCache()
  getServiceAreas(@Query(new ZodValidationPipe(langQuerySchema)) query: LangQuery): Promise<ServiceAreas> {
    return this.zones.getServiceAreas(query.lang);
  }
}
