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
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { auditActor } from '../auth/audit-actor.js';
import { CurrentAuth, RequirePermissions } from '../auth/auth.decorators.js';
import type { AuthContext } from '../auth/auth.types.js';
import { AdminReviewsService, type AdminReviewsPage, type ReviewStats } from './admin-reviews.service.js';
import type { AdminReview } from './review.mapper.js';
import {
  adminListReviewsQuerySchema,
  reviewInputSchema,
  reviewPatchSchema,
  reviewReplySchema,
  type AdminListReviewsQuery,
  type ReviewInput,
  type ReviewPatch,
  type ReviewReplyInput,
} from './review.schemas.js';

/** Back-office — avis clients (tag « Admin — Avis » du contrat). */
@ApiTags('Admin — Avis')
@Controller('admin/reviews')
export class AdminReviewsController {
  constructor(@Inject(AdminReviewsService) private readonly reviews: AdminReviewsService) {}

  @Get()
  @RequirePermissions('reviews:moderate')
  @ApiOperation({ operationId: 'adminListReviews', summary: 'Avis (à valider, publiés, masqués)' })
  list(
    @Query(new ZodValidationPipe(adminListReviewsQuerySchema)) query: AdminListReviewsQuery,
  ): Promise<AdminReviewsPage> {
    return this.reviews.list(query);
  }

  @Post()
  @RequirePermissions('reviews:moderate')
  @ApiOperation({
    operationId: 'adminCreateReview',
    summary: 'Ajout manuel d’un témoignage (marqué « non vérifié »)',
  })
  create(
    @Body(new ZodValidationPipe(reviewInputSchema)) body: ReviewInput,
    @CurrentAuth() auth: AuthContext,
    @Req() request: Request,
  ): Promise<AdminReview> {
    return this.reviews.create(body, auditActor(auth, request), new Date());
  }

  // Déclarée avant `:id` : `stats` n'est pas un identifiant.
  @Get('stats')
  @RequirePermissions('reviews:moderate')
  @ApiOperation({ operationId: 'adminGetReviewStats', summary: 'KPI des avis et du questionnaire' })
  stats(): Promise<ReviewStats> {
    return this.reviews.stats(new Date());
  }

  @Patch(':id')
  @RequirePermissions('reviews:moderate')
  @ApiOperation({ operationId: 'adminUpdateReview', summary: 'Publier, masquer, mettre en avant' })
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(reviewPatchSchema)) body: ReviewPatch,
    @CurrentAuth() auth: AuthContext,
    @Req() request: Request,
  ): Promise<AdminReview> {
    return this.reviews.update(id, body, auditActor(auth, request), new Date());
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('reviews:moderate')
  @ApiOperation({ operationId: 'adminDeleteReview', summary: 'Supprimer un avis ajouté manuellement' })
  async remove(
    @Param('id') id: string,
    @CurrentAuth() auth: AuthContext,
    @Req() request: Request,
  ): Promise<void> {
    await this.reviews.remove(id, auditActor(auth, request));
  }

  @Post(':id/reply')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('reviews:moderate')
  @ApiOperation({
    operationId: 'adminReplyReview',
    summary: 'Répondre à un avis (réponse publique de l’agence)',
  })
  reply(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(reviewReplySchema)) body: ReviewReplyInput,
    @CurrentAuth() auth: AuthContext,
    @Req() request: Request,
  ): Promise<AdminReview> {
    return this.reviews.reply(id, body, auditActor(auth, request), new Date());
  }
}
