import { Module } from '@nestjs/common';
import { ContactsService } from './contacts.service.js';

/** Fiches contact (création et mise à jour par les formulaires publics). */
@Module({
  providers: [ContactsService],
  exports: [ContactsService],
})
export class ContactsModule {}
