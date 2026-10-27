import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PUBLIC_FORM_THROTTLE } from '../../common/throttling/app-throttler.guard.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { Public } from '../auth/auth.decorators.js';
import {
  REFERENCE_PATTERN,
  acceptProposalInputSchema,
  type AcceptProposalInput,
} from './appointment.schemas.js';
import {
  AppointmentsService,
  proposalExpiredException,
  type MessageResponse,
} from './appointments.service.js';
import type { Availability } from './availability.js';
import { availabilityQuerySchema, type AvailabilityQuery } from './availability.schemas.js';
import { AvailabilityService } from './availability.service.js';

/**
 * Rendez-vous côté site (tag « Formulaires » du contrat) : créneaux libres et acceptation d'un créneau proposé par
 * l'agence. La demande de rendez-vous (`POST /v1/appointments`) est un formulaire public (`FormsController`).
 */
@ApiTags('Formulaires')
@Public()
@Controller('appointments')
export class AppointmentsController {
  constructor(
    @Inject(AvailabilityService) private readonly availability: AvailabilityService,
    @Inject(AppointmentsService) private readonly appointments: AppointmentsService,
  ) {}

  /** Paramètres invalides : 422 `validation-error` (réponse documentée par le contrat pour cette opération). */
  @Get('availability')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ operationId: 'getAvailability', summary: 'Jours et créneaux libres' })
  getAvailability(
    @Query(
      new ZodValidationPipe(availabilityQuerySchema, {
        problem: {
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          type: 'validation-error',
          title: 'Certaines informations sont à corriger',
          detail: 'Vérifiez les dates demandées.',
        },
      }),
    )
    query: AvailabilityQuery,
  ): Promise<Availability> {
    return this.availability.availability(query, new Date());
  }

  @Post(':reference/accept-proposal')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: PUBLIC_FORM_THROTTLE })
  @ApiOperation({
    operationId: 'acceptAppointmentProposal',
    summary: "Le client accepte le créneau proposé (lien de l'e-mail)",
  })
  acceptProposal(
    @Param('reference') reference: string,
    @Body(new ZodValidationPipe(acceptProposalInputSchema)) body: AcceptProposalInput,
  ): Promise<MessageResponse> {
    if (!REFERENCE_PATTERN.test(reference)) throw proposalExpiredException();
    return this.appointments.acceptProposal(reference, body.token, new Date());
  }
}
