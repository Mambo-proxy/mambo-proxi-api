import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseInterceptors,
} from '@nestjs/common';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { PublicCache } from '../../common/http-cache/http-cache.js';
import { PUBLIC_FORM_THROTTLE } from '../../common/throttling/app-throttler.guard.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { Public } from '../auth/auth.decorators.js';
import { FormsService, type SubmissionAccepted } from '../forms/forms.service.js';
import { CvUploadInterceptor } from '../storage/document-upload.interceptor.js';
import type { JobOfferDetail, JobOfferSummary } from './job.mapper.js';
import { APPLICATION_PIPE, ApplicationForm } from './application-form.js';
import {
  jobDetailQuerySchema,
  listJobsQuerySchema,
  type JobApplicationInput,
  type JobDetailQuery,
  type ListJobsQuery,
} from './job.schemas.js';
import { JobsService } from './jobs.service.js';

/** Offres d'emploi du site (tag « Contenus » du contrat). */
@ApiTags('Contenus')
@Public()
@Controller('jobs')
export class JobsController {
  constructor(@Inject(JobsService) private readonly jobs: JobsService) {}

  @Get()
  @PublicCache()
  @ApiOperation({ operationId: 'listJobs', summary: "Offres d'emploi publiées et non expirées" })
  list(@Query(new ZodValidationPipe(listJobsQuerySchema)) query: ListJobsQuery): Promise<JobOfferSummary[]> {
    return this.jobs.list(query, new Date());
  }

  @Get(':slug')
  @PublicCache()
  @ApiOperation({ operationId: 'getJob', summary: "Détail d'une offre" })
  detail(
    @Param('slug') slug: string,
    @Query(new ZodValidationPipe(jobDetailQuerySchema)) query: JobDetailQuery,
  ): Promise<JobOfferDetail> {
    return this.jobs.detail(slug, query, new Date());
  }
}

/**
 * Candidature (tag « Formulaires ») : même protection que les autres formulaires publics (champ piège, délai,
 * Turnstile, 5 envois par minute et par adresse IP), CV contrôlé puis enregistré en stockage privé.
 */
@ApiTags('Formulaires')
@Public()
@Controller('job-applications')
@Throttle({ default: PUBLIC_FORM_THROTTLE })
export class JobApplicationsController {
  constructor(@Inject(FormsService) private readonly forms: FormsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(CvUploadInterceptor)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ operationId: 'createJobApplication', summary: 'Candidature (offre ou spontanée) avec CV' })
  create(
    @ApplicationForm(APPLICATION_PIPE) body: JobApplicationInput,
    @Req() request: Request,
  ): Promise<SubmissionAccepted> {
    return this.forms.createJobApplication(body, {
      ip: request.ip,
      userAgent: request.get('user-agent'),
      acceptLanguage: request.get('accept-language'),
    });
  }
}
