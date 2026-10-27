import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module.js';
import { AdminCategoriesController, AdminServicesController } from './admin-catalog.controller.js';
import { AdminCategoriesService } from './admin-categories.service.js';
import { AdminServicesService } from './admin-services.service.js';
import { CatalogService } from './catalog.service.js';
import { CategoriesController } from './categories.controller.js';
import { ServicesController } from './services.controller.js';

/**
 * Catalogue : lecture publique des rubriques et services publiés (`/v1/categories*`, `/v1/services*`, aperçu par
 * jeton), et écrans du back-office (`/v1/admin/services*`, `/v1/admin/categories*`).
 */
@Module({
  imports: [MediaModule],
  controllers: [CategoriesController, ServicesController, AdminServicesController, AdminCategoriesController],
  providers: [CatalogService, AdminServicesService, AdminCategoriesService],
  exports: [CatalogService],
})
export class CatalogModule {}
