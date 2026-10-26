import { Module } from '@nestjs/common';
import { SitemapController } from './sitemap.controller.js';
import { SitemapService } from './sitemap.service.js';

@Module({
  controllers: [SitemapController],
  providers: [SitemapService],
})
export class SitemapModule {}
