import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PublicCache } from '../../common/http-cache/http-cache.js';
import type { SitemapEntry } from './sitemap.mapper.js';
import { SitemapService } from './sitemap.service.js';
import { Public } from '../auth/auth.decorators.js';

@ApiTags('Site')
@Public()
@Controller('sitemap')
export class SitemapController {
  constructor(@Inject(SitemapService) private readonly sitemap: SitemapService) {}

  /** `GET /v1/sitemap` : URLs publiques et date de dernière modification. */
  @Get()
  @ApiOperation({ operationId: 'getSitemap', summary: 'URLs publiques et date de dernière modification' })
  @PublicCache()
  getSitemap(): Promise<SitemapEntry[]> {
    return this.sitemap.getSitemap();
  }
}
