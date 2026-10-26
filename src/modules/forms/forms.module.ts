import { Module } from '@nestjs/common';
import { AntiSpamModule } from '../../common/anti-spam/anti-spam.module.js';
import { ContactsModule } from '../contacts/contacts.module.js';
import { RequestsModule } from '../requests/requests.module.js';
import { FormsController } from './forms.controller.js';
import { FormsService } from './forms.service.js';

/**
 * Formulaires publics : devis, contact, inscription, formation, partenariat, événement. Les e-mails passent par
 * `MailQueueService` (module `MailModule`, global).
 */
@Module({
  imports: [AntiSpamModule, ContactsModule, RequestsModule],
  controllers: [FormsController],
  providers: [FormsService],
})
export class FormsModule {}
