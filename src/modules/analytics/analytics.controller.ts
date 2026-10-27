import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Query,
  Req,
  type ArgumentMetadata,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { ProblemException } from '../../common/problem/problem.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { AppConfigService } from '../../config/app-config.service.js';
import { Public, RequirePermissions } from '../auth/auth.decorators.js';
import { AnalyticsCollectorService, type AnalyticsBatchAccepted } from './analytics-collector.service.js';
import { AnalyticsSummaryService, type AnalyticsSummary } from './analytics-summary.service.js';
import {
  MAX_BATCH_BYTES,
  analyticsBatchSchema,
  analyticsSummaryQuerySchema,
  type AnalyticsSummaryQuery,
} from './analytics.schemas.js';

/** 30 lots par minute et par adresse IP (contrat). */
const ANALYTICS_THROTTLE = { ttl: 60_000, limit: 30 } as const;

const BODY_METADATA: ArgumentMetadata = { type: 'body' };

function payloadTooLarge(): ProblemException {
  return new ProblemException({
    status: HttpStatus.PAYLOAD_TOO_LARGE,
    type: 'payload-too-large',
    title: 'Envoi trop volumineux',
    detail: 'Envoyez au plus 50 événements et 16 Kio par lot.',
  });
}

/** Mesure d'audience du site (tag « Mesure d'audience »). */
@ApiTags('Mesure d’audience')
@Controller('analytics')
export class AnalyticsController {
  private readonly batchPipe = new ZodValidationPipe(analyticsBatchSchema);

  constructor(
    @Inject(AnalyticsCollectorService) private readonly collector: AnalyticsCollectorService,
    @Inject(AppConfigService) private readonly config: AppConfigService,
  ) {}

  /**
   * Lot d'événements du site, en JSON ou en `text/plain` (`navigator.sendBeacon`) : origine limitée au site (403),
   * 16 Kio au plus (413), JSON illisible (400), lot invalide (422), 30 lots par minute et par IP (429).
   */
  @Post('events')
  @Public()
  @Throttle({ default: ANALYTICS_THROTTLE })
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    operationId: 'collectAnalyticsEvents',
    summary: "Envoi d'un lot d'événements de mesure d'audience",
  })
  async collect(@Body() body: unknown, @Req() request: Request): Promise<AnalyticsBatchAccepted> {
    if (request.get('origin') !== this.config.webOrigin)
      throw new ProblemException({
        status: HttpStatus.FORBIDDEN,
        type: 'forbidden-origin',
        title: 'Origine non autorisée',
        detail: 'Ces mesures ne sont acceptées que depuis le site MAMBO Proxi.',
      });
    const declared = Number(request.get('content-length') ?? '0');
    if (Number.isFinite(declared) && declared > MAX_BATCH_BYTES) throw payloadTooLarge();

    let payload: unknown = body;
    if (typeof body === 'string') {
      if (Buffer.byteLength(body, 'utf8') > MAX_BATCH_BYTES) throw payloadTooLarge();
      try {
        payload = JSON.parse(body) as unknown;
      } catch {
        throw new ProblemException({
          status: HttpStatus.BAD_REQUEST,
          type: 'invalid-body',
          title: 'Requête invalide',
          detail: "Le contenu envoyé n'est pas un JSON valide.",
        });
      }
    }
    const batch = await this.batchPipe.transform(payload, BODY_METADATA);
    return this.collector.collect(batch, request.get('user-agent'), new Date());
  }
}

/** Back-office — statistiques d'audience (tag « Admin — Statistiques »). */
@ApiTags('Admin — Statistiques')
@Controller('admin/analytics')
export class AdminAnalyticsController {
  constructor(@Inject(AnalyticsSummaryService) private readonly summaries: AnalyticsSummaryService) {}

  @Get('summary')
  @RequirePermissions('analytics:read')
  @ApiOperation({ operationId: 'adminGetAnalyticsSummary', summary: "Statistiques d'audience du site" })
  summary(
    @Query(new ZodValidationPipe(analyticsSummaryQuerySchema)) query: AnalyticsSummaryQuery,
  ): Promise<AnalyticsSummary> {
    return this.summaries.summary(query.period, query.lang, new Date());
  }
}
