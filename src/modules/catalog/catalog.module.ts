import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module.js';
import { CatalogService } from './catalog.service.js';
import { CategoriesController } from './categories.controller.js';
import { ServicesController } from './services.controller.js';

/** Catalogue public : rubriques et services publiés. */
@Module({
  imports: [MediaModule],
  controllers: [CategoriesController, ServicesController],
  providers: [CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}
