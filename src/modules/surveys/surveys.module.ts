import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module.js';
import { QueueModule } from '../queue/queue.module.js';
import { AdminSurveyQuestionsController } from './admin-survey-questions.controller.js';
import { AdminSurveyQuestionsService } from './admin-survey-questions.service.js';
import { SurveyInvitationProcessor } from './survey-invitation.processor.js';
import { SurveyInvitationsService, surveyQueueFactoryProvider } from './survey-invitations.service.js';
import { SurveysController } from './surveys.controller.js';
import { SurveysService } from './surveys.service.js';

/**
 * Questionnaire de satisfaction : page publique par jeton (`/v1/surveys/{token}`), questions du back-office
 * (`/v1/admin/survey-questions`), invitation, relance et expiration par la file BullMQ `survey-invitations`
 * (`SurveyInvitationsService`, appelé par les demandes au passage à « Prestation réalisée »).
 */
@Module({
  imports: [QueueModule, MediaModule],
  controllers: [SurveysController, AdminSurveyQuestionsController],
  providers: [
    SurveysService,
    AdminSurveyQuestionsService,
    surveyQueueFactoryProvider,
    SurveyInvitationsService,
    SurveyInvitationProcessor,
  ],
  exports: [SurveyInvitationsService],
})
export class SurveysModule {}
