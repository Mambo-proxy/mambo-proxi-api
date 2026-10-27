import { Module } from '@nestjs/common';
import { AnalyticsCollectorService } from './analytics-collector.service.js';
import { AnalyticsSummaryService } from './analytics-summary.service.js';
import { AdminAnalyticsController, AnalyticsController } from './analytics.controller.js';

/**
 * Mesure d'audience interne, sans outil tiers ni cookie : collecte des lots du site (`POST /v1/analytics/events`)
 * et statistiques du back-office (`GET /v1/admin/analytics/summary`, carte « Visites » du tableau de bord). Les
 * agrégats de plus de 13 mois sont supprimés par le nettoyage RGPD quotidien (module de maintenance).
 */
@Module({
  controllers: [AnalyticsController, AdminAnalyticsController],
  providers: [AnalyticsCollectorService, AnalyticsSummaryService],
})
export class AnalyticsModule {}
