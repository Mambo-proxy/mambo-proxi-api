import { Body, Controller, Get, Inject, Param, Put, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { JsonObject } from '../../common/json/json-read.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { auditActor } from '../auth/audit-actor.js';
import { CurrentAuth, RequirePermissions } from '../auth/auth.decorators.js';
import type { AuthContext } from '../auth/auth.types.js';
import { settingsGroupSchema, type SettingsGroupValue } from './admin-settings.schemas.js';
import { AdminSettingsService, type SystemStatus } from './admin-settings.service.js';

/** Back-office — paramètres du site (tag « Admin — Paramètres » du contrat). */
@ApiTags('Admin — Paramètres')
@Controller('admin')
export class AdminSettingsController {
  constructor(@Inject(AdminSettingsService) private readonly settings: AdminSettingsService) {}

  @Get('settings/:group')
  @RequirePermissions('settings:read')
  @ApiOperation({ operationId: 'adminGetSettings', summary: 'Groupe de paramètres' })
  get(@Param('group') group: string): Promise<JsonObject> {
    return this.settings.get(group);
  }

  @Put('settings/:group')
  @RequirePermissions('settings:write', 'settings:admin')
  @ApiOperation({
    operationId: 'adminSaveSettings',
    summary: 'Enregistrer un groupe de paramètres (mise à jour partout sur le site)',
  })
  save(
    @Param('group') group: string,
    @Body(new ZodValidationPipe(settingsGroupSchema)) body: SettingsGroupValue,
    @CurrentAuth() auth: AuthContext,
    @Req() request: Request,
  ): Promise<JsonObject> {
    return this.settings.save(group, body, auth, auditActor(auth, request));
  }

  @Get('system-status')
  @RequirePermissions('settings:read')
  @ApiOperation({ operationId: 'adminGetSystemStatus', summary: 'Sauvegardes, HTTPS, version' })
  systemStatus(): Promise<SystemStatus> {
    return this.settings.systemStatus();
  }
}
