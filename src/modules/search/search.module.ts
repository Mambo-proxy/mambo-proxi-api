import { Module } from '@nestjs/common';
import { SearchController } from './search.controller.js';
import { SiteSearchService } from './site-search.service.js';

/** Recherche globale du site public (`GET /v1/search`). */
@Module({
  controllers: [SearchController],
  providers: [SiteSearchService],
})
export class SearchModule {}
