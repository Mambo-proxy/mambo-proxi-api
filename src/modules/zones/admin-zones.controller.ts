import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { auditActor } from '../auth/audit-actor.js';
import { CurrentAuth, RequirePermissions } from '../auth/auth.decorators.js';
import type { AuthContext } from '../auth/auth.types.js';
import { reorderSchema, type ReorderInput } from '../catalog/admin-catalog.schemas.js';
import { zoneInputSchema, zonePatchSchema, type ZoneInput, type ZonePatch } from './admin-zones.schemas.js';
import { AdminZonesService, type AdminZone, type AdminZones } from './admin-zones.service.js';

/** Back-office — zones d'intervention (tag « Admin — Zones » du contrat). */
@ApiTags('Admin — Zones')
@Controller('admin/zones')
export class AdminZonesController {
  constructor(@Inject(AdminZonesService) private readonly zones: AdminZonesService) {}

  @Get()
  @RequirePermissions('content:read')
  @ApiOperation({
    operationId: 'adminListZones',
    summary: "Zones d'intervention, quartiers, délais et tarifs indicatifs",
  })
  list(): Promise<AdminZones> {
    return this.zones.list(new Date());
  }

  @Post()
  @RequirePermissions('content:write')
  @ApiOperation({ operationId: 'adminCreateZone', summary: 'Créer une zone' })
  create(
    @Body(new ZodValidationPipe(zoneInputSchema)) body: ZoneInput,
    @CurrentAuth() auth: AuthContext,
    @Req() request: Request,
  ): Promise<AdminZone> {
    return this.zones.create(body, auditActor(auth, request), new Date());
  }

  // Déclarée avant `:id` : `reorder` n'est pas un identifiant.
  @Patch('reorder')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('content:write')
  @ApiOperation({
    operationId: 'adminReorderZones',
    summary: 'Ordre des zones (légende, liste et recherche du site)',
  })
  async reorder(
    @Body(new ZodValidationPipe(reorderSchema)) body: ReorderInput,
    @CurrentAuth() auth: AuthContext,
    @Req() request: Request,
  ): Promise<void> {
    await this.zones.reorder(body, auditActor(auth, request));
  }

  @Patch(':id')
  @RequirePermissions('content:write')
  @ApiOperation({ operationId: 'adminUpdateZone', summary: 'Modifier une zone et ses quartiers' })
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(zonePatchSchema)) body: ZonePatch,
    @CurrentAuth() auth: AuthContext,
    @Req() request: Request,
  ): Promise<AdminZone> {
    return this.zones.update(id, body, auditActor(auth, request), new Date());
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('content:write')
  @ApiOperation({ operationId: 'adminDeleteZone', summary: 'Supprimer une zone' })
  async remove(
    @Param('id') id: string,
    @CurrentAuth() auth: AuthContext,
    @Req() request: Request,
  ): Promise<void> {
    await this.zones.remove(id, auditActor(auth, request));
  }
}
