import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
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
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import type { PreviewToken } from '../../common/preview/preview-token.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { auditActor } from '../auth/audit-actor.js';
import { CurrentAuth, RequirePermissions } from '../auth/auth.decorators.js';
import type { AuthContext } from '../auth/auth.types.js';
import { AdminMagazineService, type AdminMagazineOverview } from './admin-magazine.service.js';
import { MagazineNewsletterService } from './magazine-newsletter.service.js';
import type { AdminMagazineArticle, AdminMagazineEdition } from './magazine.mapper.js';
import {
  articleInputSchema,
  articlePatchSchema,
  editionArticlesInputSchema,
  editionInputSchema,
  editionPatchSchema,
  listArticlesQuerySchema,
  newsletterScheduleInputSchema,
  newsletterTestInputSchema,
  publishInputSchema,
  type ArticleInput,
  type ArticlePatch,
  type EditionArticlesInput,
  type EditionInput,
  type EditionPatch,
  type ListArticlesQuery,
  type NewsletterScheduleInput,
  type NewsletterTestInput,
  type PublishInput,
} from './magazine.schemas.js';

/** Envois de test : 10 par minute (comme les campagnes). */
const TEST_THROTTLE = { ttl: 60_000, limit: 10 } as const;

/** Back-office — magazine (tag « Admin — Magazine » du contrat). */
@ApiTags('Admin — Magazine')
@Controller('admin/magazine')
export class AdminMagazineController {
  constructor(
    @Inject(AdminMagazineService) private readonly magazine: AdminMagazineService,
    @Inject(MagazineNewsletterService) private readonly newsletter: MagazineNewsletterService,
  ) {}

  @Get()
  @RequirePermissions('content:read')
  @ApiOperation({
    operationId: 'adminGetMagazine',
    summary: 'Éditions du magazine et statistiques de la dernière campagne',
  })
  overview(): Promise<AdminMagazineOverview> {
    return this.magazine.overview(new Date());
  }

  // ─────────────────────────── Éditions ───────────────────────────

  @Post('editions')
  @RequirePermissions('content:write')
  @ApiOperation({ operationId: 'adminCreateMagazineEdition', summary: 'Créer une édition (brouillon)' })
  create(
    @Body(new ZodValidationPipe(editionInputSchema)) body: EditionInput,
    @CurrentAuth() auth: AuthContext,
    @Req() request: Request,
  ): Promise<AdminMagazineEdition> {
    return this.magazine.create(body, auditActor(auth, request), new Date());
  }

  @Get('editions/:id')
  @RequirePermissions('content:read')
  @ApiOperation({ operationId: 'adminGetMagazineEdition', summary: 'Édition complète' })
  detail(@Param('id') id: string): Promise<AdminMagazineEdition> {
    return this.magazine.detail(id, new Date());
  }

  @Patch('editions/:id')
  @RequirePermissions('content:write')
  @ApiOperation({ operationId: 'adminUpdateMagazineEdition', summary: 'Enregistrer une édition' })
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(editionPatchSchema)) body: EditionPatch,
    @CurrentAuth() auth: AuthContext,
    @Req() request: Request,
  ): Promise<AdminMagazineEdition> {
    return this.magazine.update(id, body, auditActor(auth, request), new Date());
  }

  @Delete('editions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('content:write')
  @ApiOperation({ operationId: 'adminDeleteMagazineEdition', summary: 'Supprimer une édition non publiée' })
  async remove(
    @Param('id') id: string,
    @CurrentAuth() auth: AuthContext,
    @Req() request: Request,
  ): Promise<void> {
    await this.magazine.remove(id, auditActor(auth, request), new Date());
  }

  @Post('editions/:id/publish')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('content:write')
  @ApiOperation({
    operationId: 'adminPublishMagazineEdition',
    summary: 'Publier ou programmer la publication',
  })
  publish(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(publishInputSchema)) body: PublishInput,
    @CurrentAuth() auth: AuthContext,
    @Req() request: Request,
  ): Promise<AdminMagazineEdition> {
    return this.magazine.publish(id, body.publishAt, auditActor(auth, request), new Date());
  }

  @Post('editions/:id/unpublish')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('content:write')
  @ApiOperation({
    operationId: 'adminUnpublishMagazineEdition',
    summary: 'Repasser une édition en brouillon',
  })
  unpublish(
    @Param('id') id: string,
    @CurrentAuth() auth: AuthContext,
    @Req() request: Request,
  ): Promise<AdminMagazineEdition> {
    return this.magazine.unpublish(id, auditActor(auth, request), new Date());
  }

  @Put('editions/:id/articles')
  @RequirePermissions('content:write')
  @ApiOperation({
    operationId: 'adminSetMagazineEditionArticles',
    summary: "Articles de l'édition, dans l'ordre de lecture",
  })
  setArticles(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(editionArticlesInputSchema)) body: EditionArticlesInput,
    @CurrentAuth() auth: AuthContext,
    @Req() request: Request,
  ): Promise<AdminMagazineEdition> {
    return this.magazine.setArticles(id, body.ids, auditActor(auth, request), new Date());
  }

  @Get('editions/:id/preview-token')
  @RequirePermissions('content:read')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    operationId: 'adminGetMagazineEditionPreviewToken',
    summary: "Jeton de prévisualisation de l'édition sur le site (30 min)",
  })
  previewToken(@Param('id') id: string): Promise<PreviewToken> {
    return this.magazine.previewToken(id, new Date());
  }

  @Post('editions/:id/newsletter/test')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: TEST_THROTTLE })
  @RequirePermissions('newsletter:write')
  @ApiOperation({ operationId: 'adminTestMagazineNewsletter', summary: "Envoi de test de l'édition" })
  test(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(newsletterTestInputSchema)) body: NewsletterTestInput,
    @CurrentAuth() auth: AuthContext,
    @Req() request: Request,
  ): Promise<{ message: string }> {
    return this.newsletter.test(id, body.email, auditActor(auth, request));
  }

  @Post('editions/:id/newsletter/schedule')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('newsletter:write')
  @ApiOperation({
    operationId: 'adminScheduleMagazineNewsletter',
    summary: "Programmer l'envoi de l'édition par la newsletter",
  })
  async schedule(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(newsletterScheduleInputSchema)) body: NewsletterScheduleInput,
    @CurrentAuth() auth: AuthContext,
    @Req() request: Request,
  ): Promise<AdminMagazineEdition> {
    const now = new Date();
    await this.newsletter.schedule(id, body.scheduledAt, auditActor(auth, request), now);
    return this.magazine.detail(id, now);
  }

  // ─────────────────────────── Articles ───────────────────────────

  @Get('articles')
  @RequirePermissions('content:read')
  @ApiOperation({ operationId: 'adminListMagazineArticles', summary: 'Articles du magazine' })
  listArticles(
    @Query(new ZodValidationPipe(listArticlesQuerySchema)) query: ListArticlesQuery,
  ): Promise<AdminMagazineArticle[]> {
    return this.magazine.listArticles(query);
  }

  @Post('articles')
  @RequirePermissions('content:write')
  @ApiOperation({ operationId: 'adminCreateMagazineArticle', summary: 'Créer un article' })
  createArticle(
    @Body(new ZodValidationPipe(articleInputSchema)) body: ArticleInput,
    @CurrentAuth() auth: AuthContext,
    @Req() request: Request,
  ): Promise<AdminMagazineArticle> {
    return this.magazine.createArticle(body, auditActor(auth, request));
  }

  @Patch('articles/:id')
  @RequirePermissions('content:write')
  @ApiOperation({ operationId: 'adminUpdateMagazineArticle', summary: 'Modifier un article' })
  updateArticle(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(articlePatchSchema)) body: ArticlePatch,
    @CurrentAuth() auth: AuthContext,
    @Req() request: Request,
  ): Promise<AdminMagazineArticle> {
    return this.magazine.updateArticle(id, body, auditActor(auth, request));
  }

  @Delete('articles/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('content:write')
  @ApiOperation({ operationId: 'adminDeleteMagazineArticle', summary: 'Supprimer un article' })
  async removeArticle(
    @Param('id') id: string,
    @CurrentAuth() auth: AuthContext,
    @Req() request: Request,
  ): Promise<void> {
    await this.magazine.removeArticle(id, auditActor(auth, request));
  }
}
