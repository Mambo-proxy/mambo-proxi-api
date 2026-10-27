import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module.js';
import { NewsletterModule } from '../newsletter/newsletter.module.js';
import { AdminMagazineController } from './admin-magazine.controller.js';
import { AdminMagazineService } from './admin-magazine.service.js';
import { MagazineNewsletterService } from './magazine-newsletter.service.js';
import { MagazineController } from './magazine.controller.js';
import { MagazineService } from './magazine.service.js';

/**
 * Magazine : lecture publique (`/v1/magazine`, aperçu par jeton) et back-office (`/v1/admin/magazine*` : éditions,
 * articles, envoi par la newsletter avec les campagnes et la file du module newsletter).
 */
@Module({
  imports: [MediaModule, NewsletterModule],
  controllers: [MagazineController, AdminMagazineController],
  providers: [MagazineService, AdminMagazineService, MagazineNewsletterService],
})
export class MagazineModule {}
