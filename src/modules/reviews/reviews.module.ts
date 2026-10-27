import { Module } from '@nestjs/common';
import { AdminReviewsController } from './admin-reviews.controller.js';
import { AdminReviewsService } from './admin-reviews.service.js';
import { ReviewsController } from './reviews.controller.js';
import { ReviewsService } from './reviews.service.js';

/**
 * Avis clients : lecture publique des avis publiés et de leur synthèse (`/v1/reviews*`), modération, témoignages
 * saisis à la main, réponses et indicateurs du back-office (`/v1/admin/reviews*`). Les avis vérifiés naissent du
 * questionnaire de satisfaction (`SurveysModule`).
 */
@Module({
  controllers: [ReviewsController, AdminReviewsController],
  providers: [ReviewsService, AdminReviewsService],
})
export class ReviewsModule {}
