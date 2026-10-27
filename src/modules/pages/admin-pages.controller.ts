import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Post, Put, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { auditActor } from '../auth/audit-actor.js';
import { CurrentAuth, RequirePermissions } from '../auth/auth.decorators.js';
import type { AuthContext } from '../auth/auth.types.js';
import type { PreviewToken } from '../../common/preview/preview-token.js';
import { AdminPagesService, type AdminPage, type AdminPageSummary } from './admin-pages.service.js';
import { pageDraftSchema, type PageDraftInput } from './page-sections.schemas.js';

/** Back-office — pages et textes (tag « Admin — Pages » du contrat). */
@ApiTags('Admin — Pages')
@Controller('admin/pages')
export class AdminPagesController {
  constructor(@Inject(AdminPagesService) private readonly pages: AdminPagesService) {}

  @Get()
  @RequirePermissions('content:read')
  @ApiOperation({ operationId: 'adminListPages', summary: 'Pages éditables' })
  list(): Promise<AdminPageSummary[]> {
    return this.pages.list();
  }

  @Get(':key')
  @RequirePermissions('content:read')
  @ApiOperation({ operationId: 'adminGetPage', summary: 'Page avec son brouillon' })
  detail(@Param('key') key: string): Promise<AdminPage> {
    return this.pages.detail(key);
  }

  @Put(':key')
  @RequirePermissions('content:write')
  @ApiOperation({
    operationId: 'adminSavePageDraft',
    summary: 'Enregistrer le brouillon (sauvegarde automatique)',
  })
  saveDraft(
    @Param('key') key: string,
    @Body(new ZodValidationPipe(pageDraftSchema)) body: PageDraftInput,
    @CurrentAuth() auth: AuthContext,
    @Req() request: Request,
  ): Promise<AdminPage> {
    return this.pages.saveDraft(key, body, auditActor(auth, request), new Date());
  }

  @Post(':key/publish')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('content:write')
  @ApiOperation({ operationId: 'adminPublishPage', summary: 'Publier les modifications' })
  publish(
    @Param('key') key: string,
    @CurrentAuth() auth: AuthContext,
    @Req() request: Request,
  ): Promise<AdminPage> {
    return this.pages.publish(key, auditActor(auth, request), new Date());
  }

  @Post(':key/discard')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('content:write')
  @ApiOperation({ operationId: 'adminDiscardPageDraft', summary: 'Abandonner le brouillon' })
  discard(
    @Param('key') key: string,
    @CurrentAuth() auth: AuthContext,
    @Req() request: Request,
  ): Promise<AdminPage> {
    return this.pages.discard(key, auditActor(auth, request));
  }

  @Get(':key/preview-token')
  @RequirePermissions('content:read')
  @ApiOperation({ operationId: 'adminGetPagePreviewToken', summary: "Jeton d'aperçu du brouillon" })
  previewToken(@Param('key') key: string): Promise<PreviewToken> {
    return this.pages.previewToken(key, new Date());
  }
}
