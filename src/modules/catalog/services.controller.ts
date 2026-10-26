import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PublicCache } from '../../common/http-cache/http-cache.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import {
  catalogDetailQuerySchema,
  listServicesQuerySchema,
  type CatalogDetailQuery,
  type ListServicesQuery,
} from './catalog.schemas.js';
import { CatalogService } from './catalog.service.js';
import type { ServiceDetail, ServiceSummary } from './catalog.types.js';
import { Public } from '../auth/auth.decorators.js';

@ApiTags('Catalogue')
@Public()
@Controller('services')
export class ServicesController {
  constructor(@Inject(CatalogService) private readonly catalog: CatalogService) {}

  /** `GET /v1/services` : services publiés (filtres `category`, `featured`, `q`). */
  @Get()
  @ApiOperation({ operationId: 'listServices', summary: 'Services publiés' })
  @PublicCache()
  listServices(
    @Query(new ZodValidationPipe(listServicesQuerySchema)) query: ListServicesQuery,
  ): Promise<ServiceSummary[]> {
    return this.catalog.listServices(query);
  }

  /** `GET /v1/services/{slug}` : fiche service. */
  @Get(':slug')
  @ApiOperation({ operationId: 'getService', summary: 'Fiche service' })
  @PublicCache()
  getService(
    @Param('slug') slug: string,
    @Query(new ZodValidationPipe(catalogDetailQuerySchema)) query: CatalogDetailQuery,
  ): Promise<ServiceDetail> {
    return this.catalog.getService(slug, query);
  }
}
