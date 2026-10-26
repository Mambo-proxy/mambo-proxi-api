import { Body, Controller, HttpCode, HttpStatus, Inject, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { PUBLIC_FORM_THROTTLE } from '../../common/throttling/app-throttler.guard.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import {
  contactMessageInputSchema,
  eventRegistrationInputSchema,
  partnerRequestInputSchema,
  quoteRequestInputSchema,
  registrationInputSchema,
  trainingRequestInputSchema,
  type ContactMessageInput,
  type EventRegistrationInput,
  type PartnerRequestInput,
  type QuoteRequestInput,
  type RegistrationInput,
  type TrainingRequestInput,
} from './forms.schemas.js';
import { FormsService, type SubmissionAccepted, type SubmissionMeta } from './forms.service.js';
import { Public } from '../auth/auth.decorators.js';

function metaOf(request: Request): SubmissionMeta {
  return {
    ip: request.ip,
    userAgent: request.get('user-agent'),
    acceptLanguage: request.get('accept-language'),
  };
}

/**
 * Formulaires publics (tag « Formulaires » du contrat) : `201 { reference, message }`, 400 `spam-check-failed`,
 * 422 `validation-error`, 429 `rate-limited` (limite resserrée : 5 envois par minute et par adresse IP et par formulaire).
 */
@ApiTags('Formulaires')
@Public()
@Controller()
@Throttle({ default: PUBLIC_FORM_THROTTLE })
export class FormsController {
  constructor(@Inject(FormsService) private readonly forms: FormsService) {}

  @Post('quote-requests')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ operationId: 'createQuoteRequest', summary: 'Demande de devis gratuit' })
  createQuoteRequest(
    @Body(new ZodValidationPipe(quoteRequestInputSchema)) body: QuoteRequestInput,
    @Req() request: Request,
  ): Promise<SubmissionAccepted> {
    return this.forms.createQuoteRequest(body, metaOf(request));
  }

  @Post('contact-messages')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    operationId: 'createContactMessage',
    summary: "Message de contact ou demande d'information",
  })
  createContactMessage(
    @Body(new ZodValidationPipe(contactMessageInputSchema)) body: ContactMessageInput,
    @Req() request: Request,
  ): Promise<SubmissionAccepted> {
    return this.forms.createContactMessage(body, metaOf(request));
  }

  @Post('registrations')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    operationId: 'createRegistration',
    summary: 'Inscription particulier ou professionnel / partenaire',
  })
  createRegistration(
    @Body(new ZodValidationPipe(registrationInputSchema)) body: RegistrationInput,
    @Req() request: Request,
  ): Promise<SubmissionAccepted> {
    return this.forms.createRegistration(body, metaOf(request));
  }

  @Post('training-requests')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ operationId: 'createTrainingRequest', summary: 'Demande de formation' })
  createTrainingRequest(
    @Body(new ZodValidationPipe(trainingRequestInputSchema)) body: TrainingRequestInput,
    @Req() request: Request,
  ): Promise<SubmissionAccepted> {
    return this.forms.createTrainingRequest(body, metaOf(request));
  }

  @Post('partner-requests')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ operationId: 'createPartnerRequest', summary: 'Demande « Devenir partenaire »' })
  createPartnerRequest(
    @Body(new ZodValidationPipe(partnerRequestInputSchema)) body: PartnerRequestInput,
    @Req() request: Request,
  ): Promise<SubmissionAccepted> {
    return this.forms.createPartnerRequest(body, metaOf(request));
  }

  @Post('event-registrations')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ operationId: 'createEventRegistration', summary: "Inscription à un événement de l'agenda" })
  createEventRegistration(
    @Body(new ZodValidationPipe(eventRegistrationInputSchema)) body: EventRegistrationInput,
    @Req() request: Request,
  ): Promise<SubmissionAccepted> {
    return this.forms.createEventRegistration(body, metaOf(request));
  }
}
