import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module.js';
import { AdminPagesController } from './admin-pages.controller.js';
import { AdminPagesService } from './admin-pages.service.js';
import { PagesController } from './pages.controller.js';
import { PagesService } from './pages.service.js';

/** Pages éditoriales : lecture publique (`/v1/pages/{key}`, aperçu par jeton) et back-office (`/v1/admin/pages*`). */
@Module({
  imports: [MediaModule],
  controllers: [PagesController, AdminPagesController],
  providers: [PagesService, AdminPagesService],
})
export class PagesModule {}
