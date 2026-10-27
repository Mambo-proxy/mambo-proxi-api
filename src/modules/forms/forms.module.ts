import { Module } from '@nestjs/common';
import { AntiSpamModule } from '../../common/anti-spam/anti-spam.module.js';
import { AppointmentsModule } from '../appointments/appointments.module.js';
import { ContactsModule } from '../contacts/contacts.module.js';
import { RequestsModule } from '../requests/requests.module.js';
import { FormsController } from './forms.controller.js';
import { FormsService } from './forms.service.js';

/**
 * Formulaires publics : devis, contact, inscription, formation, partenariat, événement, demande de rendez-vous
 * (créneaux du module des rendez-vous). Les e-mails passent par `MailQueueService` (module `MailModule`, global).
 */
@Module({
  imports: [AntiSpamModule, ContactsModule, RequestsModule, AppointmentsModule],
  controllers: [FormsController],
  providers: [FormsService],
  // Candidatures (`POST /v1/job-applications`, module des offres d'emploi) : même enregistrement que les formulaires.
  exports: [FormsService],
})
export class FormsModule {}
