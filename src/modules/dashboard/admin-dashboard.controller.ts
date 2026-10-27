import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Patch, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Page } from '../../common/pagination/pagination.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { CurrentAuth, RequirePermissions } from '../auth/auth.decorators.js';
import type { AuthContext } from '../auth/auth.types.js';
import { AdminSearchService, type AdminSearchGroup } from './admin-search.service.js';
import { AuditLogService, type AuditLogEntry } from './audit-log.service.js';
import {
  adminSearchQuerySchema,
  auditLogQuerySchema,
  dashboardQuerySchema,
  markNotificationsReadSchema,
  type AdminSearchQuery,
  type AuditLogQuery,
  type DashboardQuery,
  type MarkNotificationsRead,
} from './dashboard.schemas.js';
import { DashboardService, type Dashboard, type SidebarCounts } from './dashboard.service.js';
import { NotificationsService, type NotificationsList } from './notifications.service.js';

/** Back-office — tableau de bord, recherche `⌘K`, notifications, pastilles (tag « Admin — Tableau de bord »). */
@ApiTags('Admin — Tableau de bord')
@Controller('admin')
export class AdminDashboardController {
  constructor(
    @Inject(DashboardService) private readonly dashboard: DashboardService,
    @Inject(AdminSearchService) private readonly searchService: AdminSearchService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
  ) {}

  @Get('dashboard')
  @RequirePermissions('dashboard:read')
  @ApiOperation({ operationId: 'adminGetDashboard', summary: 'Indicateurs du tableau de bord' })
  getDashboard(
    @Query(new ZodValidationPipe(dashboardQuerySchema)) query: DashboardQuery,
    @CurrentAuth() auth: AuthContext,
  ): Promise<Dashboard> {
    return this.dashboard.dashboard(query.range, auth, new Date());
  }

  @Get('search')
  @RequirePermissions('dashboard:read')
  @ApiOperation({ operationId: 'adminSearch', summary: 'Recherche globale (palette ⌘K)' })
  search(
    @Query(new ZodValidationPipe(adminSearchQuerySchema)) query: AdminSearchQuery,
    @CurrentAuth() auth: AuthContext,
  ): Promise<{ groups: AdminSearchGroup[] }> {
    return this.searchService.search(query.q, auth);
  }

  @Get('notifications')
  @RequirePermissions('dashboard:read')
  @ApiOperation({ operationId: 'adminListNotifications', summary: 'Notifications récentes' })
  listNotifications(@CurrentAuth() auth: AuthContext): Promise<NotificationsList> {
    return this.notifications.list(auth.user.id);
  }

  @Patch('notifications/read')
  @RequirePermissions('dashboard:read')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    operationId: 'adminMarkNotificationsRead',
    summary: 'Marquer des notifications comme lues',
  })
  async markNotificationsRead(
    @Body(new ZodValidationPipe(markNotificationsReadSchema)) body: MarkNotificationsRead,
    @CurrentAuth() auth: AuthContext,
  ): Promise<void> {
    await this.notifications.markRead(auth.user.id, body.ids, new Date());
  }

  @Get('sidebar-counts')
  @RequirePermissions('dashboard:read')
  @ApiOperation({ operationId: 'adminGetSidebarCounts', summary: 'Compteurs de la barre latérale' })
  sidebarCounts(@CurrentAuth() auth: AuthContext): Promise<SidebarCounts> {
    return this.dashboard.sidebarCounts(auth);
  }
}

/** Back-office — journal d'activité (tag « Admin — Journal »), réservé aux administrateurs (`audit:read`). */
@ApiTags('Admin — Journal')
@Controller('admin/audit-log')
export class AdminAuditLogController {
  constructor(@Inject(AuditLogService) private readonly auditLog: AuditLogService) {}

  @Get()
  @RequirePermissions('audit:read')
  @ApiOperation({ operationId: 'adminListAuditLog', summary: 'Journal d’activité' })
  list(
    @Query(new ZodValidationPipe(auditLogQuerySchema)) query: AuditLogQuery,
  ): Promise<Page<AuditLogEntry>> {
    return this.auditLog.list(query);
  }
}
