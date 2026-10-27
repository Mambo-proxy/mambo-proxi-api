import { Inject, Injectable } from '@nestjs/common';
import { addDays, doualaDate, type DateKey } from '../../common/time/agency-day.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { deltaPercent, round1 } from '../dashboard/dashboard-periods.js';
import {
  ANALYTICS_ACTIONS,
  ANALYTICS_ACTION_LABELS,
  type AnalyticsActionName,
  type AnalyticsPeriod,
} from './analytics.schemas.js';

interface Kpi {
  value: number | null;
  previous: number | null;
  deltaPercent: number | null;
  unit: string | null;
}

interface ActionCount {
  action: AnalyticsActionName;
  label: string;
  count: number;
  previous?: number | null;
  deltaPercent?: number | null;
}

/** Schéma `AnalyticsSummary` du contrat. */
export interface AnalyticsSummary {
  period: AnalyticsPeriod;
  from: string;
  to: string;
  generatedAt: string;
  totals: { visitors: Kpi; pageViews: Kpi; actions: Kpi; consentRate: number | null };
  actions: ActionCount[];
  series: { date: string; visitors: number; pageViews: number; actions: number }[];
  topPages: { path: string; title: string; pageViews: number; visitors: number; actions: number }[];
  actionsByPage: { path: string; title: string; total: number; byAction: ActionCount[] }[];
  languages: { lang: 'fr' | 'en'; pageViews: number; percent: number }[];
}

const PERIOD_DAYS: Record<AnalyticsPeriod, number> = { '7d': 7, '30d': 30, '90d': 90 };
const TOP = 10;

const dateOf = (key: DateKey): Date => new Date(`${key}T00:00:00.000Z`);
const keyOf = (date: Date): DateKey => date.toISOString().slice(0, 10);
const actionName = (value: string): AnalyticsActionName => value.toLowerCase() as AnalyticsActionName;
const langName = (value: string): 'fr' | 'en' => (value.toLowerCase() === 'en' ? 'en' : 'fr');

/**
 * Statistiques d'audience (`GET /v1/admin/analytics/summary`) : agrégats de la mesure interne sur des jours entiers
 * jusqu'à hier (Douala), comparés à la période précédente de même durée. Les visiteurs uniques ne comptent que les
 * visiteurs ayant consenti ; pages vues et actions comptent tous les événements. Calcul direct sur les tables
 * quotidiennes (quelques milliers de lignes par trimestre au plus).
 */
@Injectable()
export class AnalyticsSummaryService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async summary(
    period: AnalyticsPeriod,
    lang: 'fr' | 'en' | undefined,
    now: Date,
  ): Promise<AnalyticsSummary> {
    const days = PERIOD_DAYS[period];
    const to = addDays(doualaDate(now), -1);
    const from = addDays(to, -(days - 1));
    const previousTo = addDays(from, -1);
    const previousFrom = addDays(previousTo, -(days - 1));
    const language = lang === undefined ? undefined : lang === 'en' ? ('EN' as const) : ('FR' as const);
    const range = (start: DateKey, end: DateKey) => ({
      day: { gte: dateOf(start), lte: dateOf(end) },
      ...(language ? { lang: language } : {}),
    });
    const current = range(from, to);
    const previous = range(previousFrom, previousTo);
    const langSql = lang === undefined ? Prisma.empty : Prisma.sql`AND "lang" = ${lang}::"Language"`;

    const [
      pvByDay,
      pvPrevious,
      pvConsented,
      pvByPath,
      pvByLang,
      actionsByDay,
      actionsByName,
      actionsPreviousByName,
      actionsByPathName,
      visitorsTotal,
      visitorsPrevious,
      visitorsByDay,
      visitorsByPath,
      titles,
    ] = await Promise.all([
      this.prisma.analyticsPageViewDaily.groupBy({ by: ['day'], where: current, _sum: { count: true } }),
      this.prisma.analyticsPageViewDaily.aggregate({ where: previous, _sum: { count: true } }),
      this.prisma.analyticsPageViewDaily.aggregate({
        where: { ...current, consented: true },
        _sum: { count: true },
      }),
      this.prisma.analyticsPageViewDaily.groupBy({ by: ['path'], where: current, _sum: { count: true } }),
      this.prisma.analyticsPageViewDaily.groupBy({
        by: ['lang'],
        where: { day: current.day },
        _sum: { count: true },
      }),
      this.prisma.analyticsActionDaily.groupBy({ by: ['day'], where: current, _sum: { count: true } }),
      this.prisma.analyticsActionDaily.groupBy({ by: ['action'], where: current, _sum: { count: true } }),
      this.prisma.analyticsActionDaily.groupBy({ by: ['action'], where: previous, _sum: { count: true } }),
      this.prisma.analyticsActionDaily.groupBy({
        by: ['path', 'action'],
        where: current,
        _sum: { count: true },
      }),
      this.distinctVisitors(from, to, langSql),
      this.distinctVisitors(previousFrom, previousTo, langSql),
      this.prisma.$queryRaw<{ day: Date; visitors: bigint }[]>`
        SELECT "day", COUNT(DISTINCT "visitor_hash") AS "visitors" FROM "analytics_visitors_daily"
        WHERE "day" BETWEEN ${from}::date AND ${to}::date ${langSql}
        GROUP BY "day"`,
      this.prisma.$queryRaw<{ path: string; visitors: bigint }[]>`
        SELECT "path", COUNT(DISTINCT "visitor_hash") AS "visitors" FROM "analytics_visitors_daily"
        WHERE "day" BETWEEN ${from}::date AND ${to}::date ${langSql}
        GROUP BY "path"`,
      this.pageTitles(),
    ]);

    const sum = (rows: { _sum: { count: number | null } }[]): number =>
      rows.reduce((total, row) => total + (row._sum.count ?? 0), 0);
    const pageViews = sum(pvByDay);
    const actionsTotal = sum(actionsByDay);
    const previousActions = sum(actionsPreviousByName);
    const previousPageViews = pvPrevious._sum.count ?? 0;
    const kpi = (value: number, before: number): Kpi => ({
      value,
      previous: before,
      deltaPercent: deltaPercent(value, before),
      unit: null,
    });
    const titleOf = (path: string): string => titles.get(path) ?? path;

    const previousByAction = new Map(
      actionsPreviousByName.map((row) => [actionName(row.action), row._sum.count ?? 0]),
    );
    const currentByAction = new Map(
      actionsByName.map((row) => [actionName(row.action), row._sum.count ?? 0]),
    );
    const actions: ActionCount[] = ANALYTICS_ACTIONS.map((action) => {
      const count = currentByAction.get(action) ?? 0;
      const before = previousByAction.get(action) ?? 0;
      return {
        action,
        label: ANALYTICS_ACTION_LABELS[action],
        count,
        previous: before,
        deltaPercent: deltaPercent(count, before),
      };
    }).sort((a, b) => b.count - a.count);

    const pvDay = new Map(pvByDay.map((row) => [keyOf(row.day), row._sum.count ?? 0]));
    const actionsDay = new Map(actionsByDay.map((row) => [keyOf(row.day), row._sum.count ?? 0]));
    const visitorsDay = new Map(visitorsByDay.map((row) => [keyOf(row.day), Number(row.visitors)]));
    const series = Array.from({ length: days }, (_, index) => {
      const date = addDays(from, index);
      return {
        date,
        visitors: visitorsDay.get(date) ?? 0,
        pageViews: pvDay.get(date) ?? 0,
        actions: actionsDay.get(date) ?? 0,
      };
    });

    const actionsPerPath = new Map<string, Map<AnalyticsActionName, number>>();
    for (const row of actionsByPathName) {
      const byAction = actionsPerPath.get(row.path) ?? new Map<AnalyticsActionName, number>();
      byAction.set(
        actionName(row.action),
        (row._sum.count ?? 0) + (byAction.get(actionName(row.action)) ?? 0),
      );
      actionsPerPath.set(row.path, byAction);
    }
    const pathActions = (path: string): number =>
      [...(actionsPerPath.get(path)?.values() ?? [])].reduce((total, value) => total + value, 0);
    const visitorsPath = new Map(visitorsByPath.map((row) => [row.path, Number(row.visitors)]));

    const topPages = pvByPath
      .map((row) => ({ path: row.path, pageViews: row._sum.count ?? 0 }))
      .sort((a, b) => b.pageViews - a.pageViews || a.path.localeCompare(b.path))
      .slice(0, TOP)
      .map((row) => ({
        path: row.path,
        title: titleOf(row.path),
        pageViews: row.pageViews,
        visitors: visitorsPath.get(row.path) ?? 0,
        actions: pathActions(row.path),
      }));

    const actionsByPage = [...actionsPerPath.keys()]
      .map((path) => ({ path, total: pathActions(path) }))
      .filter((row) => row.total > 0)
      .sort((a, b) => b.total - a.total || a.path.localeCompare(b.path))
      .slice(0, TOP)
      .map((row) => ({
        path: row.path,
        title: titleOf(row.path),
        total: row.total,
        byAction: [...(actionsPerPath.get(row.path)?.entries() ?? [])]
          .filter(([, count]) => count > 0)
          .sort((a, b) => b[1] - a[1])
          .map(([action, count]) => ({ action, label: ANALYTICS_ACTION_LABELS[action], count })),
      }));

    const languageTotal = sum(pvByLang);
    const languages = pvByLang
      .map((row) => ({ lang: langName(row.lang), pageViews: row._sum.count ?? 0 }))
      .sort((a, b) => b.pageViews - a.pageViews)
      .map((row) => ({
        ...row,
        percent: languageTotal === 0 ? 0 : round1((row.pageViews / languageTotal) * 100),
      }));

    return {
      period,
      from,
      to,
      generatedAt: now.toISOString(),
      totals: {
        visitors: kpi(visitorsTotal, visitorsPrevious),
        pageViews: kpi(pageViews, previousPageViews),
        actions: kpi(actionsTotal, previousActions),
        consentRate: pageViews === 0 ? null : round1(((pvConsented._sum.count ?? 0) / pageViews) * 100),
      },
      actions,
      series,
      topPages,
      actionsByPage,
      languages,
    };
  }

  private async distinctVisitors(from: DateKey, to: DateKey, langSql: Prisma.Sql): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ visitors: bigint }[]>`
      SELECT COUNT(DISTINCT "visitor_hash") AS "visitors" FROM "analytics_visitors_daily"
      WHERE "day" BETWEEN ${from}::date AND ${to}::date ${langSql}`;
    return Number(rows[0]?.visitors ?? 0);
  }

  /**
   * Titres des pages mesurées (adresses internes françaises) : pages éditoriales, rubriques, services, offres
   * d'emploi ; l'adresse elle-même à défaut.
   */
  private async pageTitles(): Promise<Map<string, string>> {
    const [pages, categories, services, jobs] = await Promise.all([
      this.prisma.page.findMany({ select: { title: true, path: true } }),
      this.prisma.category.findMany({ select: { slug: true, name: true } }),
      this.prisma.service.findMany({
        select: { slug: true, name: true, category: { select: { slug: true } } },
      }),
      this.prisma.jobOffer.findMany({ select: { slug: true, title: true } }),
    ]);
    const titles = new Map<string, string>([['/', 'Accueil']]);
    for (const page of pages) if (!titles.has(page.path)) titles.set(page.path, page.title);
    for (const category of categories) titles.set(`/services/${category.slug}`, category.name);
    for (const service of services)
      titles.set(`/services/${service.category.slug}/${service.slug}`, service.name);
    for (const job of jobs) titles.set(`/recrutement/${job.slug}`, job.title);
    return titles;
  }
}
