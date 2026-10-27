import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Post, Put, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { auditActor } from '../auth/audit-actor.js';
import { CurrentAuth, RequirePermissions } from '../auth/auth.decorators.js';
import type { AuthContext } from '../auth/auth.types.js';
import {
  AdminEmailTemplatesService,
  emailPreviewInputSchema,
  emailTemplateInputSchema,
  emailTestSchema,
  type EmailPreview,
  type EmailPreviewInput,
  type EmailTemplate,
  type EmailTemplateInput,
  type EmailTestInput,
} from './admin-email-templates.service.js';

/** Back-office — e-mails automatiques (tag « Admin — Paramètres » du contrat). */
@ApiTags('Admin — Paramètres')
@Controller('admin/email-templates')
export class AdminEmailTemplatesController {
  constructor(@Inject(AdminEmailTemplatesService) private readonly templates: AdminEmailTemplatesService) {}

  @Get()
  @RequirePermissions('settings:read')
  @ApiOperation({ operationId: 'adminListEmailTemplates', summary: 'E-mails automatiques' })
  list(): Promise<EmailTemplate[]> {
    return this.templates.list();
  }

  @Get(':key')
  @RequirePermissions('settings:read')
  @ApiOperation({ operationId: 'adminGetEmailTemplate', summary: "Modèle d'e-mail" })
  get(@Param('key') key: string): Promise<EmailTemplate> {
    return this.templates.get(key);
  }

  @Put(':key')
  @RequirePermissions('settings:write')
  @ApiOperation({
    operationId: 'adminSaveEmailTemplate',
    summary: 'Modifier un modèle (objet, titre, paragraphes, bouton, activation)',
  })
  save(
    @Param('key') key: string,
    @Body(new ZodValidationPipe(emailTemplateInputSchema)) body: EmailTemplateInput,
    @CurrentAuth() auth: AuthContext,
    @Req() request: Request,
  ): Promise<EmailTemplate> {
    return this.templates.save(key, body, auditActor(auth, request));
  }

  @Post(':key/preview')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('settings:read')
  @ApiOperation({
    operationId: 'adminPreviewEmailTemplate',
    summary: "Aperçu avec des données d'exemple (contenu non enregistré possible)",
  })
  preview(
    @Param('key') key: string,
    @Body(new ZodValidationPipe(emailPreviewInputSchema)) body: EmailPreviewInput,
  ): Promise<EmailPreview> {
    return this.templates.preview(key, body);
  }

  @Post(':key/test')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermissions('settings:write')
  @ApiOperation({ operationId: 'adminTestEmailTemplate', summary: 'Envoi de test' })
  test(
    @Param('key') key: string,
    @Body(new ZodValidationPipe(emailTestSchema)) body: EmailTestInput,
    @CurrentAuth() auth: AuthContext,
    @Req() request: Request,
  ): Promise<{ message: string }> {
    return this.templates.test(key, body, auditActor(auth, request));
  }
}
