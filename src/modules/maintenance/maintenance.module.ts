import { Module } from '@nestjs/common';
import { ContactsModule } from '../contacts/contacts.module.js';
import { QueueModule } from '../queue/queue.module.js';
import { RequestsModule } from '../requests/requests.module.js';
import { BackupService } from './backup.service.js';
import { GdprCleanupService } from './gdpr-cleanup.service.js';
import { MagazinePublicationService } from './magazine-publication.service.js';
import { MaintenanceScheduler } from './maintenance.scheduler.js';
import { RevalidationDispatchService } from './revalidation-dispatch.service.js';

/**
 * Tâches planifiées du worker (file BullMQ `maintenance`) : envoi des demandes de revalidation au site,
 * revalidation de la page du magazine à la date de publication des éditions programmées, sauvegarde quotidienne de
 * la base (`pg_dump`, rotation 30 jours), nettoyage RGPD quotidien.
 */
@Module({
  imports: [QueueModule, ContactsModule, RequestsModule],
  providers: [
    RevalidationDispatchService,
    MagazinePublicationService,
    GdprCleanupService,
    BackupService,
    MaintenanceScheduler,
  ],
  exports: [RevalidationDispatchService, BackupService, GdprCleanupService],
})
export class MaintenanceModule {}
