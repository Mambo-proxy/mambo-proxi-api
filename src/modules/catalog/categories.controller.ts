import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PublicCache } from '../../common/http-cache/http-cache.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import {
  catalogDetailQuerySchema,
  listCategoriesQuerySchema,
  type CatalogDetailQuery,
  type ListCategoriesQuery,
} from './catalog.schemas.js';
import { CatalogService } from './catalog.service.js';
import type { CategoryDetail, CategorySummary } from './catalog.types.js';

@ApiTags('Catalogue')
@Controller('categories')
export class CategoriesController {
  constructor(@Inject(CatalogService) private readonly catalog: CatalogService) {}

  /** `GET /v1/categories` : rubriques publiées (`include=services` : avec leurs services publiés). */
  @Get()
  @ApiOperation({ operationId: 'listCategories', summary: 'Rubriques publiées' })
  @PublicCache()
  listCategories(
    @Query(new ZodValidationPipe(listCategoriesQuerySchema)) query: ListCategoriesQuery,
  ): Promise<CategorySummary[]> {
    return this.catalog.listCategories(query);
  }

  /** `GET /v1/categories/{slug}` : page rubrique complète. */
  @Get(':slug')
  @ApiOperation({ operationId: 'getCategory', summary: 'Page rubrique complète' })
  @PublicCache()
  getCategory(
    @Param('slug') slug: string,
    @Query(new ZodValidationPipe(catalogDetailQuerySchema)) query: CatalogDetailQuery,
  ): Promise<CategoryDetail> {
    return this.catalog.getCategory(slug, query);
  }
}
