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
import { langQuerySchema, type LangQuery } from '../../common/i18n/lang.js';
import { notFoundException } from '../../common/problem/problem.js';
import { PUBLIC_FORM_THROTTLE } from '../../common/throttling/app-throttler.guard.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { Public } from '../auth/auth.decorators.js';
import { submitSurveySchema, type SubmitSurveyInput } from './survey.schemas.js';
import {
  SURVEY_NOT_FOUND,
  SurveysService,
  surveyExpiredException,
  type MessageResponse,
  type PublicSurvey,
} from './surveys.service.js';

/** Jeton du chemin (`maxLength: 512` du contrat). */
const MAX_TOKEN_LENGTH = 512;

/** Questionnaire de satisfaction (tag « Questionnaire » du contrat) : lien reçu par e-mail, jamais mis en cache. */
@ApiTags('Questionnaire')
@Public()
@Controller('surveys')
export class SurveysController {
  constructor(@Inject(SurveysService) private readonly surveys: SurveysService) {}

  @Get(':token')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ operationId: 'getSurvey', summary: 'Questionnaire de satisfaction (lien reçu par e-mail)' })
  get(
    @Param('token') token: string,
    @Query(new ZodValidationPipe(langQuerySchema)) query: LangQuery,
  ): Promise<PublicSurvey> {
    if (token.length > MAX_TOKEN_LENGTH) throw notFoundException(SURVEY_NOT_FOUND);
    return this.surveys.get(token, query.lang, new Date());
  }

  @Post(':token/responses')
  @HttpCode(HttpStatus.CREATED)
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: PUBLIC_FORM_THROTTLE })
  @ApiOperation({ operationId: 'submitSurvey', summary: 'Envoi des réponses' })
  submit(
    @Param('token') token: string,
    @Body(new ZodValidationPipe(submitSurveySchema)) body: SubmitSurveyInput,
  ): Promise<MessageResponse> {
    if (token.length > MAX_TOKEN_LENGTH) throw surveyExpiredException();
    return this.surveys.submit(token, body, new Date());
  }
}
