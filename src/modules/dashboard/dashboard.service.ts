import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import {
  REQUEST_LIST_SELECT,
  toRequestListItem,
  type RequestListItem,
  type RequestListRow,
} from '../requests/request.mapper.js';
import {
  dashboardPeriod,
  deltaPercent,
  round1,
  seriesBuckets,
  type DashboardRange,
} from './dashboard-periods.js';
import {
  REVIEWS_TO_VALIDATE,
  VISIBLE_APPLICATIONS,
  dashboardScope,
  scopedAppointmentsWhere,
  scopedRequestsWhere,
  type DashboardScope,
} from './dashboard-scope.js';

/** Schéma `SidebarCounts` du contrat. */
export interface SidebarCounts {
  requests: number;
  appointments: number;
  reviews: number;
  applications: number;
}

/** Schéma `Kpi` du contrat. */
export interface Kpi {
  value: number | null;
  previous: number | null;
  deltaPercent: number | null;
  unit: string | null;
}

/** Schéma `Dashboard` du contrat. */
export interface Dashboard {
  range: DashboardRange;
  kpis: { newRequests: Kpi; quotesInProgress: Kpi; servicesCompleted: Kpi; satisfaction: Kpi };
  requestsSeries: { label: string; start: string; count: number }[];
  byCategory: { slug: string; name: string; count: number; percent: number }[];
  latestRequests: RequestListItem[];
  todo: {
    reviewsToValidate: number;
    unreadApplications: number;
    appointmentsToConfirm: number;
    partnershipRequests: number;
    newRegistrations: number;
  };
  surveys: { sent: number; answered: number; responseRate: number };
  newsletter: { subscribers: number; newThisPeriod: number };
  visits: { total: number; deltaPercent: number | null } | null;
  sidebarCounts: SidebarCounts;
}

const LATEST_REQUESTS = 5;

const kpi = (value: number | null, previous: number | null, unit: string | null = null): Kpi => ({
  value,
  previous,
  deltaPercent: deltaPercent(value, previous),
  unit,
});

const and = (...parts: Prisma.RequestWhereInput[]): Prisma.RequestWhereInput => ({ AND: parts });

/**
 * Tableau de bord du back-office (`GET /v1/admin/dashboard`) et pastilles de la barre latérale
 * (`GET /v1/admin/sidebar-counts`). Chaque bloc suit les permissions de l'utilisateur : dossiers assignés seulement
 * avec `requests:read-assigned` / `appointments:read-assigned`, blocs vides (0) sans permission. Les demandes
 * anonymisées, les rendez-vous de demandes anonymisées ou de contacts effacés et les candidatures de demandes
 * anonymisées ne sont jamais comptés. Aucune donnée n'est mise en cache : les compteurs sont relus à chaque appel.
 */
@Injectable()
export class DashboardService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async sidebarCounts(auth: AuthContext): Promise<SidebarCounts> {
    return this.countsOf(auth, dashboardScope(auth));
  }

  private async countsOf(auth: AuthContext, scope: DashboardScope): Promise<SidebarCounts> {
    const requests = scopedRequestsWhere(auth, scope);
    const appointments = scopedAppointmentsWhere(scope);
    const [newRequests, toConfirm, reviews, applications] = await Promise.all([
      requests ? this.prisma.request.count({ where: and(requests, { status: 'NOUVELLE' }) }) : 0,
      appointments
        ? this.prisma.appointment.count({ where: { AND: [appointments, { status: 'A_CONFIRMER' }] } })
        : 0,
      scope.reviews ? this.prisma.review.count({ where: REVIEWS_TO_VALIDATE }) : 0,
      scope.applications
        ? this.prisma.jobApplication.count({ where: { ...VISIBLE_APPLICATIONS, status: 'NOUVEAU' } })
        : 0,
    ]);
    return { requests: newRequests, appointments: toConfirm, reviews, applications };
  }

  async dashboard(range: DashboardRange, auth: AuthContext, now: Date): Promise<Dashboard> {
    const scope = dashboardScope(auth);
    const period = dashboardPeriod(range, now);
    const requests = scopedRequestsWhere(auth, scope);
    const current = { gte: period.start, lt: period.end };

    const [counts, requestBlocks, newsletter, visits] = await Promise.all([
      this.countsOf(auth, scope),
      requests ? this.requestBlocks(requests, range, period, now) : Promise.resolve(null),
      scope.newsletter
        ? Promise.all([
            this.prisma.subscriber.count({ where: { status: 'CONFIRME' } }),
            this.prisma.subscriber.count({ where: { status: 'CONFIRME', confirmedAt: current } }),
          ])
        : Promise.resolve([0, 0] as const),
      scope.analytics ? this.visits(period) : Promise.resolve(null),
    ]);

    return {
      range,
      kpis: requestBlocks?.kpis ?? {
        newRequests: kpi(0, null),
        quotesInProgress: kpi(0, null),
        servicesCompleted: kpi(0, null),
        satisfaction: kpi(null, null, '/5'),
      },
      requestsSeries:
        requestBlocks?.series ??
        seriesBuckets(range, now).map((bucket) => ({ label: bucket.label, start: bucket.start, count: 0 })),
      byCategory: requestBlocks?.byCategory ?? [],
      latestRequests: requestBlocks?.latest ?? [],
      todo: {
        reviewsToValidate: counts.reviews,
        unreadApplications: counts.applications,
        appointmentsToConfirm: counts.appointments,
        partnershipRequests: requestBlocks?.partnershipRequests ?? 0,
        newRegistrations: requestBlocks?.newRegistrations ?? 0,
      },
      surveys: requestBlocks?.surveys ?? { sent: 0, answered: 0, responseRate: 0 },
      newsletter: { subscribers: newsletter[0], newThisPeriod: newsletter[1] },
      visits,
      sidebarCounts: counts,
    };
  }

  /** Blocs calculés sur les demandes visibles (KPI, graphique, rubriques, dernières demandes, questionnaires). */
  private async requestBlocks(
    visible: Prisma.RequestWhereInput,
    range: DashboardRange,
    period: ReturnType<typeof dashboardPeriod>,
    now: Date,
  ) {
    const current = { gte: period.start, lt: period.end };
    const previous = { gte: period.previousStart, lt: period.start };
    const buckets = seriesBuckets(range, now);
    const seriesStart = buckets[0]?.from ?? period.start;

    const [
      newRequests,
      previousRequests,
      quotesInProgress,
      completed,
      previousCompleted,
      satisfaction,
      previousSatisfaction,
      seriesRows,
      categoryGroups,
      latestRows,
      partnershipRequests,
      newRegistrations,
      surveysSent,
      surveysAnswered,
    ] = await Promise.all([
      this.prisma.request.count({ where: and(visible, { createdAt: current }) }),
      this.prisma.request.count({ where: and(visible, { createdAt: previous }) }),
      this.prisma.request.count({ where: and(visible, { type: 'DEVIS', status: 'EN_COURS' }) }),
      this.prisma.request.count({ where: and(visible, { completedAt: current }) }),
      this.prisma.request.count({ where: and(visible, { completedAt: previous }) }),
      this.prisma.survey.aggregate({
        _avg: { rating: true },
        where: { completedAt: current, rating: { not: null }, request: visible },
      }),
      this.prisma.survey.aggregate({
        _avg: { rating: true },
        where: { completedAt: previous, rating: { not: null }, request: visible },
      }),
      this.prisma.request.findMany({
        where: and(visible, { createdAt: { gte: seriesStart, lt: period.end } }),
        select: { createdAt: true },
      }),
      this.prisma.request.groupBy({
        by: ['categoryId'],
        where: and(visible, { createdAt: current, categoryId: { not: null } }),
        _count: { _all: true },
      }),
      this.prisma.request.findMany({
        where: visible,
        select: REQUEST_LIST_SELECT,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: LATEST_REQUESTS,
      }) as Promise<RequestListRow[]>,
      this.prisma.request.count({ where: and(visible, { type: 'PARTENARIAT', status: 'NOUVELLE' }) }),
      this.prisma.request.count({ where: and(visible, { type: 'INSCRIPTION', status: 'NOUVELLE' }) }),
      this.prisma.survey.count({ where: { sentAt: current, request: visible } }),
      this.prisma.survey.count({ where: { sentAt: current, completedAt: { not: null }, request: visible } }),
    ]);

    const average = (value: number | null | undefined): number | null =>
      value === null || value === undefined ? null : round1(value);

    const series = buckets.map((bucket) => ({
      label: bucket.label,
      start: bucket.start,
      count: seriesRows.filter(
        (row) =>
          row.createdAt.getTime() >= bucket.from.getTime() && row.createdAt.getTime() < bucket.to.getTime(),
      ).length,
    }));

    const categoryIds = categoryGroups.flatMap((group) => (group.categoryId ? [group.categoryId] : []));
    const categories =
      categoryIds.length === 0
        ? []
        : await this.prisma.category.findMany({
            where: { id: { in: categoryIds } },
            select: { id: true, slug: true, name: true, sortOrder: true },
          });
    const byId = new Map(categories.map((category) => [category.id, category]));
    const categorized = categoryGroups.reduce((sum, group) => sum + group._count._all, 0);
    const byCategory = categoryGroups
      .flatMap((group) => {
        const category = group.categoryId ? byId.get(group.categoryId) : undefined;
        if (!category) return [];
        const count = group._count._all;
        return [
          {
            slug: category.slug,
            name: category.name,
            count,
            percent: categorized === 0 ? 0 : round1((count / categorized) * 100),
            sortOrder: category.sortOrder,
          },
        ];
      })
      .sort((a, b) => b.count - a.count || a.sortOrder - b.sortOrder)
      .map(({ sortOrder: _sortOrder, ...item }) => item);

    return {
      kpis: {
        newRequests: kpi(newRequests, previousRequests),
        quotesInProgress: kpi(quotesInProgress, null),
        servicesCompleted: kpi(completed, previousCompleted),
        satisfaction: kpi(average(satisfaction._avg.rating), average(previousSatisfaction._avg.rating), '/5'),
      },
      series,
      byCategory,
      latest: latestRows.map((row) => toRequestListItem(row, now)),
      partnershipRequests,
      newRegistrations,
      surveys: {
        sent: surveysSent,
        answered: surveysAnswered,
        responseRate: surveysSent === 0 ? 0 : round1((surveysAnswered / surveysSent) * 100),
      },
    };
  }

  /**
   * Carte « Visites » : pages vues de la mesure d'audience interne (`POST /v1/analytics/events`) sur la période,
   * comparées à la période précédente ; `null` tant qu'aucune mesure n'a été reçue.
   */
  private async visits(
    period: ReturnType<typeof dashboardPeriod>,
  ): Promise<{ total: number; deltaPercent: number | null } | null> {
    const day = (key: string): Date => new Date(`${key}T00:00:00.000Z`);
    const [current, previous, any] = await Promise.all([
      this.prisma.analyticsPageViewDaily.aggregate({
        _sum: { count: true },
        where: { day: { gte: day(period.fromDay), lte: day(period.toDay) } },
      }),
      this.prisma.analyticsPageViewDaily.aggregate({
        _sum: { count: true },
        where: { day: { gte: day(period.previousFromDay), lte: day(period.previousToDay) } },
      }),
      this.prisma.analyticsPageViewDaily.findFirst({ select: { day: true } }),
    ]);
    if (any === null) return null;
    const total = current._sum.count ?? 0;
    return { total, deltaPercent: deltaPercent(total, previous._sum.count ?? null) };
  }
}
