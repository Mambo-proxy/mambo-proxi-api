import { Module } from '@nestjs/common';
import { RequestsModule } from '../requests/requests.module.js';
import { AdminContactsController } from './admin-contacts.controller.js';
import { AdminContactsService } from './admin-contacts.service.js';
import { ContactsService } from './contacts.service.js';

/**
 * Fiches contact : création et mise à jour par les formulaires publics (`ContactsService`), écrans du back-office
 * (`/v1/admin/contacts*` : liste, export CSV, fiche, export RGPD, droit à l'effacement).
 */
@Module({
  imports: [RequestsModule],
  controllers: [AdminContactsController],
  providers: [ContactsService, AdminContactsService],
  exports: [ContactsService],
})
export class ContactsModule {}
