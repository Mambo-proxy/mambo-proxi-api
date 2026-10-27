import { Body, Controller, Get, Inject, Put, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { auditActor } from '../auth/audit-actor.js';
import { CurrentAuth, RequirePermissions } from '../auth/auth.decorators.js';
import type { AuthContext } from '../auth/auth.types.js';
import { AdminSurveyQuestionsService, type AdminSurveyQuestion } from './admin-survey-questions.service.js';
import { surveyQuestionsInputSchema, type SurveyQuestionsInput } from './survey.schemas.js';

/** Back-office — questions du questionnaire de satisfaction (tag « Admin — Avis » du contrat). */
@ApiTags('Admin — Avis')
@Controller('admin/survey-questions')
export class AdminSurveyQuestionsController {
  constructor(@Inject(AdminSurveyQuestionsService) private readonly questions: AdminSurveyQuestionsService) {}

  @Get()
  @RequirePermissions('reviews:moderate')
  @ApiOperation({
    operationId: 'adminListSurveyQuestions',
    summary: 'Questions du questionnaire de satisfaction',
  })
  list(): Promise<AdminSurveyQuestion[]> {
    return this.questions.list();
  }

  @Put()
  @RequirePermissions('reviews:moderate')
  @ApiOperation({
    operationId: 'adminReplaceSurveyQuestions',
    summary: 'Enregistrer la liste des questions (5 maximum actives)',
  })
  replace(
    @Body(new ZodValidationPipe(surveyQuestionsInputSchema)) body: SurveyQuestionsInput,
    @CurrentAuth() auth: AuthContext,
    @Req() request: Request,
  ): Promise<AdminSurveyQuestion[]> {
    return this.questions.replace(body, auditActor(auth, request), new Date());
  }
}
