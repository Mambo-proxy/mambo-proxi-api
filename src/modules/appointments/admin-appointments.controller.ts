import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { auditActor } from '../auth/audit-actor.js';
import { CurrentAuth, RequirePermissions } from '../auth/auth.decorators.js';
import type { AuthContext } from '../auth/auth.types.js';
import {
  AdminAppointmentsService,
  type AppointmentActor,
  type AppointmentsAgenda,
} from './admin-appointments.service.js';
import type { AdminAppointment } from './appointment.mapper.js';
import {
  adminAppointmentInputSchema,
  appointmentActionSchema,
  listAppointmentsQuerySchema,
  type AdminAppointmentInput,
  type AppointmentAction,
  type ListAppointmentsQuery,
} from './appointment.schemas.js';
import { availabilityConfigSchema, type AvailabilityConfigInput } from './availability.schemas.js';
import { AvailabilityService, type AvailabilityConfig } from './availability.service.js';

function actorOf(auth: AuthContext, request: Request): AppointmentActor {
  return { auth, ip: request.ip ?? null };
}

/** Back-office — rendez-vous et disponibilités (tag « Admin — Rendez-vous » du contrat). */
@ApiTags('Admin — Rendez-vous')
@Controller('admin')
export class AdminAppointmentsController {
  constructor(
    @Inject(AdminAppointmentsService) private readonly appointments: AdminAppointmentsService,
    @Inject(AvailabilityService) private readonly availability: AvailabilityService,
  ) {}

  @Get('appointments')
  @RequirePermissions('appointments:read', 'appointments:read-assigned')
  @ApiOperation({ operationId: 'adminListAppointments', summary: 'Rendez-vous sur une période' })
  list(
    @Query(new ZodValidationPipe(listAppointmentsQuerySchema)) query: ListAppointmentsQuery,
    @CurrentAuth() auth: AuthContext,
  ): Promise<AppointmentsAgenda> {
    return this.appointments.list(query, auth);
  }

  @Post('appointments')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('appointments:write')
  @ApiOperation({
    operationId: 'adminCreateAppointment',
    summary: "Saisie manuelle d'un rendez-vous (confirmé)",
  })
  create(
    @Body(new ZodValidationPipe(adminAppointmentInputSchema)) body: AdminAppointmentInput,
    @CurrentAuth() auth: AuthContext,
    @Req() request: Request,
  ): Promise<AdminAppointment> {
    return this.appointments.create(body, actorOf(auth, request), new Date());
  }

  @Get('appointments/:id')
  @RequirePermissions('appointments:read', 'appointments:read-assigned')
  @ApiOperation({ operationId: 'adminGetAppointment', summary: "Détail d'un rendez-vous" })
  detail(@Param('id') id: string, @CurrentAuth() auth: AuthContext): Promise<AdminAppointment> {
    return this.appointments.detail(id, auth);
  }

  @Patch('appointments/:id')
  @RequirePermissions('appointments:write', 'appointments:write-assigned', 'appointments:assign')
  @ApiOperation({
    operationId: 'adminActOnAppointment',
    summary: 'Confirmer, proposer un autre créneau, annuler, terminer',
  })
  act(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(appointmentActionSchema)) body: AppointmentAction,
    @CurrentAuth() auth: AuthContext,
    @Req() request: Request,
  ): Promise<AdminAppointment> {
    return this.appointments.act(id, body, actorOf(auth, request), new Date());
  }

  @Get('availability')
  @RequirePermissions('appointments:read', 'availability:write')
  @ApiOperation({ operationId: 'adminGetAvailability', summary: 'Règles de disponibilité et fermetures' })
  getAvailability(): Promise<AvailabilityConfig> {
    return this.availability.config();
  }

  @Put('availability')
  @RequirePermissions('availability:write')
  @ApiOperation({ operationId: 'adminSaveAvailability', summary: 'Enregistrer les règles et fermetures' })
  saveAvailability(
    @Body(new ZodValidationPipe(availabilityConfigSchema)) body: AvailabilityConfigInput,
    @CurrentAuth() auth: AuthContext,
    @Req() request: Request,
  ): Promise<AvailabilityConfig> {
    return this.availability.save(body, auditActor(auth, request));
  }
}
