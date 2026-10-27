import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module.js';
import { AdminPartnersController, PartnersController } from './partners.controller.js';
import { PartnersService } from './partners.service.js';

/**
 * Partenaires : logos visibles du site (`/v1/partners`) et gestion du back-office (`/v1/admin/partners*`). Les
 * demandes « Devenir partenaire » sont des demandes `PARTENARIAT` (formulaire public et `/v1/admin/requests`).
 */
@Module({
  imports: [MediaModule],
  controllers: [PartnersController, AdminPartnersController],
  providers: [PartnersService],
})
export class PartnersModule {}
