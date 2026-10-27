import { Controller, Get, Header, Inject, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { Public } from '../auth/auth.decorators.js';
import { searchQuerySchema, type SearchQuery } from './search.schemas.js';
import { SiteSearchService, type SearchResults } from './site-search.service.js';

/** Recherche globale du site public (tag « Recherche »). */
@ApiTags('Recherche')
@Public()
@Controller('search')
export class SearchController {
  constructor(@Inject(SiteSearchService) private readonly searchService: SiteSearchService) {}

  @Get()
  // Contrat : « réponse mise en cache 5 min par adresse complète ».
  @Header('Cache-Control', 'public, max-age=300')
  @ApiOperation({ operationId: 'searchSite', summary: 'Recherche globale du site public' })
  search(
    @Query(
      new ZodValidationPipe(searchQuerySchema, {
        problem: {
          title: 'Recherche invalide',
          detail: 'Saisissez au moins 2 caractères pour lancer la recherche.',
        },
      }),
    )
    query: SearchQuery,
  ): Promise<SearchResults> {
    return this.searchService.search(query, new Date());
  }
}
