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
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { CSV_CONTENT_TYPE, attachmentDisposition } from '../../common/csv/csv.js';
import type { Page } from '../../common/pagination/pagination.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { auditActor } from '../auth/audit-actor.js';
import { CurrentAuth, RequirePermissions } from '../auth/auth.decorators.js';
import type { AuthContext } from '../auth/auth.types.js';
import type { Subscriber } from '../contacts/admin-contact.mapper.js';
import {
  AdminCampaignsService,
  type EmailPreview,
  type NewsletterStats,
  type SegmentCount,
} from './admin-campaigns.service.js';
import { AdminSubscribersService } from './admin-subscribers.service.js';
import type { Campaign } from './campaign.mapper.js';
import {
  campaignInputSchema,
  campaignPatchSchema,
  campaignScheduleInputSchema,
  campaignTestInputSchema,
  listSubscribersQuerySchema,
  type CampaignInput,
  type CampaignPatch,
  type CampaignScheduleInput,
  type CampaignTestInput,
  type ListSubscribersQuery,
} from './newsletter.schemas.js';

/** Envois de test : 10 par minute et par adresse IP. */
const TEST_THROTTLE = { ttl: 60_000, limit: 10 } as const;

/** Back-office — inscrits à la newsletter (tag « Admin — Newsletter » du contrat). */
@ApiTags('Admin — Newsletter')
@Controller('admin/subscribers')
export class AdminSubscribersController {
  constructor(@Inject(AdminSubscribersService) private readonly subscribers: AdminSubscribersService) {}

  @Get()
  @RequirePermissions('newsletter:read')
  @ApiOperation({ operationId: 'adminListSubscribers', summary: 'Inscrits à la newsletter' })
  list(
    @Query(new ZodValidationPipe(listSubscribersQuerySchema)) query: ListSubscribersQuery,
  ): Promise<Page<Subscriber>> {
    return this.subscribers.list(query);
  }

  // Déclarée avant `:id` : `export.csv` n'est pas un identifiant.
  @Get('export.csv')
  @RequirePermissions('contacts:export')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ operationId: 'adminExportSubscribers', summary: 'Export CSV des inscrits confirmés' })
  async exportCsv(
    @CurrentAuth() auth: AuthContext,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<string> {
    const file = await this.subscribers.exportCsv(auditActor(auth, request), new Date());
    response.setHeader('Content-Type', CSV_CONTENT_TYPE);
    response.setHeader('Content-Disposition', attachmentDisposition(file.fileName));
    return file.body;
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('newsletter:write')
  @ApiOperation({ operationId: 'adminDeleteSubscriber', summary: 'Supprimer un inscrit' })
  async remove(
    @Param('id') id: string,
    @CurrentAuth() auth: AuthContext,
    @Req() request: Request,
  ): Promise<void> {
    await this.subscribers.remove(id, auditActor(auth, request));
  }
}

/** Back-office — campagnes de la newsletter (tag « Admin — Newsletter » du contrat). */
@ApiTags('Admin — Newsletter')
@Controller('admin/campaigns')
export class AdminCampaignsController {
  constructor(@Inject(AdminCampaignsService) private readonly campaigns: AdminCampaignsService) {}

  @Get()
  @RequirePermissions('newsletter:read')
  @ApiOperation({ operationId: 'adminListCampaigns', summary: 'Envois de newsletter + KPI' })
  list(): Promise<{ data: Campaign[]; stats: NewsletterStats }> {
    return this.campaigns.list(new Date());
  }

  @Post()
  @RequirePermissions('newsletter:write')
  @ApiOperation({ operationId: 'adminCreateCampaign', summary: 'Nouvel envoi (brouillon)' })
  create(
    @Body(new ZodValidationPipe(campaignInputSchema)) body: CampaignInput,
    @CurrentAuth() auth: AuthContext,
    @Req() request: Request,
  ): Promise<Campaign> {
    return this.campaigns.create(body, auditActor(auth, request));
  }

  // Déclarée avant `:id` : `segments` n'est pas un identifiant.
  @Get('segments')
  @RequirePermissions('newsletter:read')
  @ApiOperation({
    operationId: 'adminListCampaignSegments',
    summary: 'Segments disponibles et nombre de destinataires',
  })
  segments(): Promise<SegmentCount[]> {
    return this.campaigns.segments();
  }

  @Get(':id')
  @RequirePermissions('newsletter:read')
  @ApiOperation({ operationId: 'adminGetCampaign', summary: 'Campagne' })
  detail(@Param('id') id: string): Promise<Campaign> {
    return this.campaigns.detail(id);
  }

  @Patch(':id')
  @RequirePermissions('newsletter:write')
  @ApiOperation({ operationId: 'adminUpdateCampaign', summary: 'Modifier un brouillon' })
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(campaignPatchSchema)) body: CampaignPatch,
    @CurrentAuth() auth: AuthContext,
    @Req() request: Request,
  ): Promise<Campaign> {
    return this.campaigns.update(id, body, auditActor(auth, request));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('newsletter:write')
  @ApiOperation({ operationId: 'adminDeleteCampaign', summary: 'Supprimer un brouillon' })
  async remove(
    @Param('id') id: string,
    @CurrentAuth() auth: AuthContext,
    @Req() request: Request,
  ): Promise<void> {
    await this.campaigns.remove(id, auditActor(auth, request));
  }

  @Get(':id/preview')
  @RequirePermissions('newsletter:read')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ operationId: 'adminPreviewCampaign', summary: "Rendu HTML réel de l'e-mail" })
  preview(@Param('id') id: string): Promise<EmailPreview> {
    return this.campaigns.preview(id);
  }

  @Post(':id/test')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: TEST_THROTTLE })
  @RequirePermissions('newsletter:write')
  @ApiOperation({ operationId: 'adminTestCampaign', summary: 'Envoi de test à une adresse' })
  test(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(campaignTestInputSchema)) body: CampaignTestInput,
    @CurrentAuth() auth: AuthContext,
    @Req() request: Request,
  ): Promise<{ message: string }> {
    return this.campaigns.test(id, body, auditActor(auth, request));
  }

  @Post(':id/schedule')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('newsletter:write')
  @ApiOperation({ operationId: 'adminScheduleCampaign', summary: "Programmer l'envoi" })
  schedule(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(campaignScheduleInputSchema)) body: CampaignScheduleInput,
    @CurrentAuth() auth: AuthContext,
    @Req() request: Request,
  ): Promise<Campaign> {
    return this.campaigns.schedule(id, body, auditActor(auth, request), new Date());
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('newsletter:write')
  @ApiOperation({
    operationId: 'adminCancelCampaign',
    summary: 'Annuler une campagne programmée (repasse en brouillon)',
  })
  cancel(
    @Param('id') id: string,
    @CurrentAuth() auth: AuthContext,
    @Req() request: Request,
  ): Promise<Campaign> {
    return this.campaigns.cancel(id, auditActor(auth, request));
  }

  @Post(':id/send-now')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermissions('newsletter:write')
  @ApiOperation({
    operationId: 'adminSendCampaignNow',
    summary: "Envoyer maintenant (par lots via la file d'attente)",
  })
  sendNow(
    @Param('id') id: string,
    @CurrentAuth() auth: AuthContext,
    @Req() request: Request,
  ): Promise<Campaign> {
    return this.campaigns.sendNow(id, auditActor(auth, request), new Date());
  }
}
