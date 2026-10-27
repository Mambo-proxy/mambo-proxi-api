import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module.js';
import { AdminEventsController, EventsController } from './events.controller.js';
import { EventsService } from './events.service.js';

/**
 * Agenda culturel : lecture publique (`/v1/events`) et back-office (`/v1/admin/events*`). L'inscription publique est
 * `POST /v1/event-registrations` (module des formulaires : demande `EVENEMENT`, contrôle des places).
 */
@Module({
  imports: [MediaModule],
  controllers: [EventsController, AdminEventsController],
  providers: [EventsService],
})
export class EventsModule {}
