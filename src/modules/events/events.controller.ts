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
  Query,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { PublicCache } from '../../common/http-cache/http-cache.js';
import type { Page } from '../../common/pagination/pagination.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { auditActor } from '../auth/audit-actor.js';
import { CurrentAuth, Public, RequirePermissions } from '../auth/auth.decorators.js';
import type { AuthContext } from '../auth/auth.types.js';
import type { AdminEvent, PublicEvent } from './event.mapper.js';
import {
  eventInputSchema,
  eventPatchSchema,
  listAdminEventsQuerySchema,
  listEventsQuerySchema,
  type EventInput,
  type EventPatch,
  type ListAdminEventsQuery,
  type ListEventsQuery,
} from './event.schemas.js';
import { EventsService, type AdminEventDetail } from './events.service.js';

/** Agenda culturel du site (tag « Contenus » du contrat). */
@ApiTags('Contenus')
@Public()
@Controller('events')
export class EventsController {
  constructor(@Inject(EventsService) private readonly events: EventsService) {}

  @Get()
  @PublicCache()
  @ApiOperation({ operationId: 'listEvents', summary: 'Agenda culturel' })
  list(
    @Query(new ZodValidationPipe(listEventsQuerySchema)) query: ListEventsQuery,
  ): Promise<Page<PublicEvent>> {
    return this.events.listPublic(query, new Date());
  }
}

/** Back-office — agenda (tag « Admin — Agenda » du contrat). */
@ApiTags('Admin — Agenda')
@Controller('admin/events')
export class AdminEventsController {
  constructor(@Inject(EventsService) private readonly events: EventsService) {}

  @Get()
  @RequirePermissions('content:read')
  @ApiOperation({ operationId: 'adminListEvents', summary: 'Événements (passés et à venir)' })
  list(
    @Query(new ZodValidationPipe(listAdminEventsQuerySchema)) query: ListAdminEventsQuery,
  ): Promise<AdminEvent[]> {
    return this.events.list(query, new Date());
  }

  @Post()
  @RequirePermissions('content:write')
  @ApiOperation({ operationId: 'adminCreateEvent', summary: 'Créer un événement' })
  create(
    @Body(new ZodValidationPipe(eventInputSchema)) body: EventInput,
    @CurrentAuth() auth: AuthContext,
    @Req() request: Request,
  ): Promise<AdminEvent> {
    return this.events.create(body, auditActor(auth, request), new Date());
  }

  @Get(':id')
  @RequirePermissions('content:read')
  @ApiOperation({ operationId: 'adminGetEvent', summary: 'Événement et ses inscriptions' })
  detail(@Param('id') id: string): Promise<AdminEventDetail> {
    return this.events.detail(id, new Date());
  }

  @Patch(':id')
  @RequirePermissions('content:write')
  @ApiOperation({ operationId: 'adminUpdateEvent', summary: 'Modifier un événement (dont publication)' })
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(eventPatchSchema)) body: EventPatch,
    @CurrentAuth() auth: AuthContext,
    @Req() request: Request,
  ): Promise<AdminEvent> {
    return this.events.update(id, body, auditActor(auth, request), new Date());
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('content:write')
  @ApiOperation({ operationId: 'adminDeleteEvent', summary: 'Supprimer un événement' })
  async remove(
    @Param('id') id: string,
    @CurrentAuth() auth: AuthContext,
    @Req() request: Request,
  ): Promise<void> {
    await this.events.remove(id, auditActor(auth, request));
  }
}
