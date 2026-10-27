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
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { Page } from '../../common/pagination/pagination.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { auditActor } from '../auth/audit-actor.js';
import { CurrentAuth, RequirePermissions } from '../auth/auth.decorators.js';
import type { AuthContext } from '../auth/auth.types.js';
import type { SignedUrl } from '../storage/storage.service.js';
import { AdminApplicationsService } from './admin-applications.service.js';
import { AdminJobsService } from './admin-jobs.service.js';
import type { AdminApplication, AdminJobOffer } from './job.mapper.js';
import {
  jobOfferInputSchema,
  jobOfferPatchSchema,
  listAdminJobsQuerySchema,
  listApplicationsQuerySchema,
  updateApplicationInputSchema,
  type JobOfferInput,
  type JobOfferPatch,
  type ListAdminJobsQuery,
  type ListApplicationsQuery,
  type UpdateApplicationInput,
} from './job.schemas.js';

/** Back-office — offres d'emploi (tag « Admin — Recrutement » du contrat). */
@ApiTags('Admin — Recrutement')
@Controller('admin/jobs')
export class AdminJobsController {
  constructor(@Inject(AdminJobsService) private readonly jobs: AdminJobsService) {}

  @Get()
  @RequirePermissions('content:read')
  @ApiOperation({ operationId: 'adminListJobs', summary: "Offres d'emploi" })
  list(
    @Query(new ZodValidationPipe(listAdminJobsQuerySchema)) query: ListAdminJobsQuery,
  ): Promise<AdminJobOffer[]> {
    return this.jobs.list(query);
  }

  @Post()
  @RequirePermissions('content:write')
  @ApiOperation({ operationId: 'adminCreateJob', summary: 'Créer une offre' })
  create(
    @Body(new ZodValidationPipe(jobOfferInputSchema)) body: JobOfferInput,
    @CurrentAuth() auth: AuthContext,
    @Req() request: Request,
  ): Promise<AdminJobOffer> {
    return this.jobs.create(body, auditActor(auth, request), new Date());
  }

  @Get(':id')
  @RequirePermissions('content:read')
  @ApiOperation({ operationId: 'adminGetJob', summary: 'Offre à éditer' })
  detail(@Param('id') id: string): Promise<AdminJobOffer> {
    return this.jobs.detail(id);
  }

  @Patch(':id')
  @RequirePermissions('content:write')
  @ApiOperation({
    operationId: 'adminUpdateJob',
    summary: 'Modifier une offre (dont publication via `status`)',
  })
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(jobOfferPatchSchema)) body: JobOfferPatch,
    @CurrentAuth() auth: AuthContext,
    @Req() request: Request,
  ): Promise<AdminJobOffer> {
    return this.jobs.update(id, body, auditActor(auth, request), new Date());
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('content:write')
  @ApiOperation({
    operationId: 'adminDeleteJob',
    summary: 'Supprimer une offre (les candidatures sont conservées)',
  })
  async remove(
    @Param('id') id: string,
    @CurrentAuth() auth: AuthContext,
    @Req() request: Request,
  ): Promise<void> {
    await this.jobs.remove(id, auditActor(auth, request));
  }
}

/** Back-office — candidatures (tag « Admin — Recrutement » du contrat). */
@ApiTags('Admin — Recrutement')
@Controller('admin/applications')
export class AdminApplicationsController {
  constructor(@Inject(AdminApplicationsService) private readonly applications: AdminApplicationsService) {}

  @Get()
  @RequirePermissions('applications:read')
  @ApiOperation({ operationId: 'adminListApplications', summary: 'Candidatures' })
  list(
    @Query(new ZodValidationPipe(listApplicationsQuerySchema)) query: ListApplicationsQuery,
  ): Promise<Page<AdminApplication>> {
    return this.applications.list(query);
  }

  @Get(':id')
  @RequirePermissions('applications:read')
  @ApiOperation({
    operationId: 'adminGetApplication',
    summary: "Détail d'une candidature (passe au statut « Lu »)",
  })
  detail(@Param('id') id: string): Promise<AdminApplication> {
    return this.applications.detail(id, new Date());
  }

  @Patch(':id')
  @RequirePermissions('applications:write')
  @ApiOperation({ operationId: 'adminUpdateApplication', summary: 'Changer le statut' })
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateApplicationInputSchema)) body: UpdateApplicationInput,
    @CurrentAuth() auth: AuthContext,
    @Req() request: Request,
  ): Promise<AdminApplication> {
    return this.applications.update(id, body.status, auditActor(auth, request), new Date());
  }

  @Get(':id/cv')
  @RequirePermissions('applications:read')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ operationId: 'adminGetApplicationCv', summary: 'URL signée du CV (5 min)' })
  cv(@Param('id') id: string, @CurrentAuth() auth: AuthContext, @Req() request: Request): Promise<SignedUrl> {
    return this.applications.cv(id, auditActor(auth, request), new Date());
  }
}
