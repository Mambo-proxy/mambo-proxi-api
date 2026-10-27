import { Module } from '@nestjs/common';
import { ContactsModule } from '../contacts/contacts.module.js';
import { QueueModule } from '../queue/queue.module.js';
import { AdminAppointmentsController } from './admin-appointments.controller.js';
import { AdminAppointmentsService } from './admin-appointments.service.js';
import { AppointmentMailService } from './appointment-mail.service.js';
import { AppointmentReminderProcessor } from './appointment-reminder.processor.js';
import {
  AppointmentRemindersService,
  reminderQueueFactoryProvider,
} from './appointment-reminders.service.js';
import { AppointmentsController } from './appointments.controller.js';
import { AppointmentsService } from './appointments.service.js';
import { AvailabilityService } from './availability.service.js';

/**
 * Rendez-vous et disponibilités : créneaux libres et acceptation d'un créneau proposé (site), agenda, saisie,
 * confirmation, report, annulation, assignation et réglage des disponibilités (back-office), e-mails au client et
 * rappels de la veille (file BullMQ `appointment-reminders`). La demande en ligne est un formulaire public
 * (`FormsModule`, qui importe ce module pour les créneaux).
 */
@Module({
  imports: [QueueModule, ContactsModule],
  controllers: [AppointmentsController, AdminAppointmentsController],
  providers: [
    AvailabilityService,
    AppointmentMailService,
    reminderQueueFactoryProvider,
    AppointmentRemindersService,
    AppointmentReminderProcessor,
    AppointmentsService,
    AdminAppointmentsService,
  ],
  exports: [AvailabilityService],
})
export class AppointmentsModule {}
