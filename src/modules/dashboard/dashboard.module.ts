import { Module } from '@nestjs/common';
import { AdminAuditLogController, AdminDashboardController } from './admin-dashboard.controller.js';
import { AdminSearchService } from './admin-search.service.js';
import { AuditLogService } from './audit-log.service.js';
import { DashboardService } from './dashboard.service.js';
import { NotificationsService } from './notifications.service.js';

/**
 * Écrans transverses du back-office : tableau de bord (`/v1/admin/dashboard`), pastilles de la barre latérale
 * (`/v1/admin/sidebar-counts`), palette de recherche (`/v1/admin/search`), notifications
 * (`/v1/admin/notifications*`) et journal d'activité (`/v1/admin/audit-log`). « Mes tâches » reste dans le module des
 * demandes, les statistiques d'audience dans celui de la mesure d'audience.
 */
@Module({
  controllers: [AdminDashboardController, AdminAuditLogController],
  providers: [DashboardService, AdminSearchService, NotificationsService, AuditLogService],
})
export class DashboardModule {}
