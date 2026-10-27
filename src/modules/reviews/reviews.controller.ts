import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PublicCache } from '../../common/http-cache/http-cache.js';
import type { Page } from '../../common/pagination/pagination.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { Public } from '../auth/auth.decorators.js';
import type { Review, ReviewSummary } from '../catalog/catalog.types.js';
import {
  listReviewsQuerySchema,
  reviewSummaryQuerySchema,
  type ListReviewsQuery,
  type ReviewSummaryQuery,
} from './review.schemas.js';
import { ReviewsService } from './reviews.service.js';

/** Avis publiés (tag « Avis » du contrat) : page « Avis clients », accueil, fiches. */
@ApiTags('Avis')
@Public()
@Controller('reviews')
export class ReviewsController {
  constructor(@Inject(ReviewsService) private readonly reviews: ReviewsService) {}

  @Get()
  @PublicCache()
  @ApiOperation({ operationId: 'listReviews', summary: 'Avis publiés' })
  list(@Query(new ZodValidationPipe(listReviewsQuerySchema)) query: ListReviewsQuery): Promise<Page<Review>> {
    return this.reviews.list(query, new Date());
  }

  @Get('summary')
  @PublicCache()
  @ApiOperation({ operationId: 'getReviewSummary', summary: 'Note moyenne et répartition' })
  summary(
    @Query(new ZodValidationPipe(reviewSummaryQuerySchema)) query: ReviewSummaryQuery,
  ): Promise<ReviewSummary> {
    return this.reviews.summary(query);
  }
}
