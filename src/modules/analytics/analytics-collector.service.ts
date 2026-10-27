import { createHmac } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { doualaDate } from '../../common/time/agency-day.js';
import { AppConfigService } from '../../config/app-config.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { AnalyticsBatch, AnalyticsEvent } from './analytics.schemas.js';

/** Schéma `AnalyticsBatchAccepted` du contrat. */
export interface AnalyticsBatchAccepted {
  accepted: number;
  rejected: number;
}

/** Fenêtre d'acceptation d'un événement : 24 h dans le passé, 5 min dans le futur (horloges décalées). */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_AHEAD_MS = 5 * 60 * 1000;

/** Robots et outils déclarés (agent utilisateur) : leurs lots sont ignorés. */
const BOT_PATTERN =
  /bot\b|bot\/|crawler|spider|crawling|slurp|headless|lighthouse|pingdom|uptime|monitor|preview|facebookexternalhit|curl\/|wget\/|python-requests|httpclient|axios\//i;

/** Adresses jamais mesurées (back-office, routes techniques du site). */
const EXCLUDED_PATHS = /^\/(admin|api|_next)(\/|$)/;

/** Agent utilisateur d'un robot déclaré (ou absent). */
export function isBot(userAgent: string | undefined): boolean {
  return userAgent === undefined || userAgent.trim() === '' || BOT_PATTERN.test(userAgent);
}

/** Adresse interne normalisée : sans paramètres ni ancre, sans barre finale ; `null` si elle est exclue. */
export function normalizePath(path: string): string | null {
  const bare = path.split(/[?#]/, 1)[0] ?? '';
  const trimmed = bare.length > 1 ? bare.replace(/\/+$/, '') : bare;
  if (trimmed === '' || !trimmed.startsWith('/') || trimmed.startsWith('//')) return null;
  if (EXCLUDED_PATHS.test(trimmed)) return null;
  return trimmed;
}

/** Domaine d'origine en minuscules, sans port ; `''` pour un accès direct ou depuis le site lui-même. */
export function normalizeReferrer(host: string | null | undefined, siteHost: string): string {
  if (host === null || host === undefined) return '';
  const value = host.trim().toLowerCase().replace(/:\d+$/, '');
  if (!/^[a-z0-9.-]{1,253}$/.test(value) || value === siteHost) return '';
  return value;
}

interface PreparedEvent {
  event: AnalyticsEvent;
  day: string;
  path: string;
}

/**
 * Mesure d'audience interne (`POST /v1/analytics/events`) : agrégats quotidiens (jour de Douala) des pages vues et
 * des actions, présence des visiteurs ayant consenti. Aucune adresse IP, aucun agent utilisateur ni aucune donnée de
 * formulaire n'est enregistrée ; l'identifiant pseudonyme du navigateur n'est stocké que sous forme de condensat
 * HMAC (`TOKEN_SIGNING_SECRET`), et seulement avec le consentement. Le lot est validé puis enregistré en tâche de fond
 * (réponse 202 immédiate) : un échec d'écriture est journalisé sans être renvoyé au site.
 */
@Injectable()
export class AnalyticsCollectorService {
  private readonly logger = new Logger(AnalyticsCollectorService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AppConfigService) private readonly config: AppConfigService,
  ) {}

  collect(batch: AnalyticsBatch, userAgent: string | undefined, now: Date): AnalyticsBatchAccepted {
    if (isBot(userAgent)) return { accepted: 0, rejected: batch.events.length };
    const prepared: PreparedEvent[] = [];
    const seen = new Set<string>();
    for (const event of batch.events) {
      const occurredAt = new Date(event.occurredAt);
      const path = normalizePath(event.path);
      const age = now.getTime() - occurredAt.getTime();
      const fingerprint = JSON.stringify(event);
      if (path === null || age > MAX_AGE_MS || age < -MAX_AHEAD_MS || seen.has(fingerprint)) continue;
      seen.add(fingerprint);
      prepared.push({ event, day: doualaDate(occurredAt), path });
    }
    if (prepared.length > 0) {
      const visitorHash =
        batch.consent && batch.visitorId !== undefined ? this.visitorHash(batch.visitorId) : null;
      void this.persist(prepared, batch.consent, visitorHash).catch((error: unknown) => {
        this.logger.warn(
          `Mesure d'audience : lot non enregistré (${error instanceof Error ? error.message : String(error)}).`,
        );
      });
    }
    return { accepted: prepared.length, rejected: batch.events.length - prepared.length };
  }

  private visitorHash(visitorId: string): string {
    return createHmac('sha256', this.config.get('TOKEN_SIGNING_SECRET'))
      .update(`analytics-visitor:${visitorId.toLowerCase()}`)
      .digest('hex');
  }

  private async persist(
    events: PreparedEvent[],
    consented: boolean,
    visitorHash: string | null,
  ): Promise<void> {
    const siteHost = new URL(this.config.get('WEB_URL')).hostname.toLowerCase();
    const pageViews = new Map<string, { values: Prisma.Sql; count: number }>();
    const actions = new Map<string, { values: Prisma.Sql; count: number }>();
    const visitors = new Map<string, Prisma.Sql>();

    for (const { event, day, path } of events) {
      const device = event.device ?? 'unknown';
      if (event.type === 'page_view') {
        const referrer = normalizeReferrer(event.referrerHost, siteHost);
        const key = [day, path, event.lang, device, referrer].join('\u0000');
        const entry = pageViews.get(key);
        if (entry) entry.count += 1;
        else
          pageViews.set(key, {
            values: Prisma.sql`${day}::date, ${path}, ${event.lang}::"Language", ${device}::"Device", ${referrer}, ${consented}`,
            count: 1,
          });
      } else {
        const target = (event.target ?? '').trim().slice(0, 120);
        const placement = (event.placement ?? '').trim().slice(0, 40);
        const key = [day, path, event.lang, device, event.action, event.step, target, placement].join(
          '\u0000',
        );
        const entry = actions.get(key);
        if (entry) entry.count += 1;
        else
          actions.set(key, {
            values: Prisma.sql`${day}::date, ${path}, ${event.lang}::"Language", ${device}::"Device", ${event.action}::"AnalyticsAction", ${event.step}::"AnalyticsStep", ${target}, ${placement}, ${consented}`,
            count: 1,
          });
      }
      if (visitorHash !== null) {
        const key = [day, path].join('\u0000');
        if (!visitors.has(key))
          visitors.set(key, Prisma.sql`(${day}::date, ${visitorHash}, ${path}, ${event.lang}::"Language")`);
      }
    }

    if (pageViews.size > 0) {
      const rows = [...pageViews.values()].map((row) => Prisma.sql`(${row.values}, ${row.count})`);
      await this.prisma.$executeRaw`
        INSERT INTO "analytics_page_views_daily" ("day", "path", "lang", "device", "referrer_host", "consented", "count")
        VALUES ${Prisma.join(rows)}
        ON CONFLICT ("day", "path", "lang", "device", "referrer_host", "consented")
        DO UPDATE SET "count" = "analytics_page_views_daily"."count" + EXCLUDED."count"`;
    }
    if (actions.size > 0) {
      const rows = [...actions.values()].map((row) => Prisma.sql`(${row.values}, ${row.count})`);
      await this.prisma.$executeRaw`
        INSERT INTO "analytics_actions_daily"
          ("day", "path", "lang", "device", "action", "step", "target", "placement", "consented", "count")
        VALUES ${Prisma.join(rows)}
        ON CONFLICT ("day", "path", "lang", "device", "action", "step", "target", "placement", "consented")
        DO UPDATE SET "count" = "analytics_actions_daily"."count" + EXCLUDED."count"`;
    }
    if (visitors.size > 0) {
      await this.prisma.$executeRaw`
        INSERT INTO "analytics_visitors_daily" ("day", "visitor_hash", "path", "lang")
        VALUES ${Prisma.join([...visitors.values()])}
        ON CONFLICT ("day", "visitor_hash", "path") DO NOTHING`;
    }
  }
}
