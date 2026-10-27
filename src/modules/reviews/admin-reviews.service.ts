import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { recordAudit, type AuditActor } from '../../common/audit/audit-log.js';
import { paginationMeta, pageWindow, type Page } from '../../common/pagination/pagination.js';
import { ProblemException, notFoundException } from '../../common/problem/problem.js';
import { requestRevalidation } from '../../common/revalidation/revalidation.js';
import { DAY_MS } from '../../common/time/agency-day.js';
import { validationException } from '../../common/validation/validation-exception.js';
import type { Prisma, ReviewStatus } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { ReviewSummary } from '../catalog/catalog.types.js';
import {
  ADMIN_REVIEW_SELECT,
  reviewCacheTags,
  toAdminReview,
  type AdminReview,
  type AdminReviewRow,
} from './review.mapper.js';
import {
  REVIEW_STATUSES,
  type AdminListReviewsQuery,
  type ReviewInput,
  type ReviewPatch,
  type ReviewReplyInput,
} from './review.schemas.js';

export interface AdminReviewsPage extends Page<AdminReview> {
  counts: Record<ReviewStatus, number>;
}

/** Schéma `ReviewStats` du contrat. */
export interface ReviewStats {
  average: number;
  averageDelta: number | null;
  published: number;
  toValidate: number;
  hidden: number;
  responseRate: number;
  surveysSent: number;
  recommendationRate: number | null;
  recommendationDelta: number | null;
  npsAverage: number | null;
  distribution: ReviewSummary['distribution'];
}

export const REVIEW_NOT_FOUND = 'Cet avis n’existe pas ou a été supprimé.';
const reviewNotFound = (): ProblemException => notFoundException(REVIEW_NOT_FOUND);

/** 409 `no-publish-consent` (exemple du contrat). */
function noConsentException(): ProblemException {
  return new ProblemException({
    status: HttpStatus.CONFLICT,
    type: 'no-publish-consent',
    title: 'Publication impossible',
    detail: 'Le client n’a pas autorisé la publication de cet avis. Il reste consultable en suivi interne.',
  });
}

function conflict(detail: string): ProblemException {
  return new ProblemException({ status: HttpStatus.CONFLICT, type: 'conflict', title: 'Conflit', detail });
}

const STATUS_LABELS: Record<ReviewStatus, string> = {
  A_VALIDER: 'remis « À valider »',
  PUBLIE: 'publié',
  MASQUE: 'masqué',
};

/** Contenus du site qui affichent l'avis (revalidation) : service, fiches qui le mettent en avant, rubriques. */
const REVIEW_SITE_SELECT = {
  status: true,
  service: { select: { slug: true } },
  featuredOn: { select: { service: { select: { slug: true } } } },
  testimonialOf: { select: { slug: true } },
} satisfies Prisma.ReviewSelect;

type ReviewSiteRow = Prisma.ReviewGetPayload<{ select: typeof REVIEW_SITE_SELECT }>;

function siteTags(row: ReviewSiteRow, extraServiceSlugs: (string | null)[] = []): string[] {
  return reviewCacheTags(
    [row.service?.slug, ...row.featuredOn.map((item) => item.service.slug), ...extraServiceSlugs],
    row.testimonialOf.map((category) => category.slug),
  );
}

/** Origine de l'avis dans le journal d'activité (référence de la demande, jamais le nom du client). */
function origin(row: AdminReviewRow): string {
  const reference = row.survey?.request.reference;
  return reference ? `de la demande ${reference}` : 'ajouté manuellement';
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function averageOf(values: readonly number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Part des notes de recommandation 9 ou 10 (%), `null` sans note. */
function promoterRate(scores: readonly number[]): number | null {
  if (scores.length === 0) return null;
  return (scores.filter((score) => score >= 9).length / scores.length) * 100;
}

/**
 * Avis clients du back-office (`/v1/admin/reviews*`) : modération (publier, masquer, remettre à valider), mise en
 * avant (accueil), service associé, réponse publique de l'agence, témoignages saisis à la main (« non vérifiés »),
 * indicateurs. La publication exige le consentement du client (409 sinon) ; seul un avis publié peut être mis en
 * avant, et il cesse de l'être quand il est masqué. Toute modification d'un avis publié, ou qui cesse de l'être,
 * inscrit une demande de revalidation du site (`reviews`, fiches des services, rubriques qui le citent).
 */
@Injectable()
export class AdminReviewsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(query: AdminListReviewsQuery): Promise<AdminReviewsPage> {
    const base: Prisma.ReviewWhereInput =
      query.service === undefined ? {} : { service: { slug: query.service } };
    const where: Prisma.ReviewWhereInput =
      query.status === undefined ? base : { AND: [base, { status: query.status }] };
    const [total, rows, groups] = await Promise.all([
      this.prisma.review.count({ where }),
      this.prisma.review.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        ...pageWindow(query.page, query.pageSize),
        select: ADMIN_REVIEW_SELECT,
      }),
      this.prisma.review.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
    ]);
    const counts = Object.fromEntries(REVIEW_STATUSES.map((status) => [status, 0])) as Record<
      ReviewStatus,
      number
    >;
    for (const group of groups) counts[group.status] = group._count._all;
    return {
      data: rows.map(toAdminReview),
      meta: paginationMeta(query.page, query.pageSize, total),
      counts,
    };
  }

  /** `POST /v1/admin/reviews` : témoignage transmis à l'agence, publication autorisée hors questionnaire. */
  async create(input: ReviewInput, actor: AuditActor, now: Date): Promise<AdminReview> {
    const service = input.serviceId ? await this.findService(input.serviceId) : null;
    const status = input.status ?? 'A_VALIDER';
    const date = input.date ? new Date(input.date) : now;
    const id = await this.prisma.$transaction(async (tx) => {
      const created = await tx.review.create({
        data: {
          authorName: input.authorName,
          city: input.city ?? null,
          rating: input.rating,
          text: input.text,
          serviceId: service?.id ?? null,
          surveyId: null,
          status,
          verified: false,
          featured: false,
          publishConsent: true,
          serviceDate: input.date ? date : null,
          date,
          reply: null,
          publishedAt: status === 'PUBLIE' ? now : null,
          createdAt: now,
        },
        select: { id: true },
      });
      if (status === 'PUBLIE') await requestRevalidation(tx, reviewCacheTags([service?.slug]));
      await recordAudit(tx, actor, {
        action: 'review.create',
        entity: 'Review',
        entityId: created.id,
        label: `A ajouté un témoignage (${String(input.rating)}/5, ${STATUS_LABELS[status]})`,
        after: { status, rating: input.rating, serviceId: service?.id ?? null },
      });
      return created.id;
    });
    return this.detail(id);
  }

  /** `GET /v1/admin/reviews/stats` : avis publiés, file de modération et questionnaire (30 derniers jours). */
  async stats(now: Date): Promise<ReviewStats> {
    const since = new Date(now.getTime() - 30 * DAY_MS);
    const before = new Date(now.getTime() - 60 * DAY_MS);
    const [groups, published, surveysSent, answered, scores] = await Promise.all([
      this.prisma.review.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.review.findMany({ where: { status: 'PUBLIE' }, select: { rating: true, date: true } }),
      this.prisma.survey.count({ where: { sentAt: { not: null } } }),
      this.prisma.survey.count({ where: { sentAt: { not: null }, completedAt: { not: null } } }),
      this.prisma.survey.findMany({
        where: { npsScore: { not: null } },
        select: { npsScore: true, completedAt: true },
      }),
    ]);
    const count = (status: ReviewStatus): number =>
      groups.find((group) => group.status === status)?._count._all ?? 0;
    const distribution: ReviewSummary['distribution'] = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
    for (const review of published) {
      const rating = Math.min(5, Math.max(1, Math.round(review.rating)));
      distribution[String(rating) as keyof ReviewSummary['distribution']] += 1;
    }
    const inWindow = (date: Date | null, from: Date, to: Date): boolean =>
      date !== null && date.getTime() >= from.getTime() && date.getTime() < to.getTime();
    const recentAverage = averageOf(
      published.filter((r) => inWindow(r.date, since, now)).map((r) => r.rating),
    );
    const previousAverage = averageOf(
      published.filter((r) => inWindow(r.date, before, since)).map((r) => r.rating),
    );
    const nps = scores.flatMap((score) =>
      score.npsScore === null ? [] : [{ value: score.npsScore, at: score.completedAt }],
    );
    const recentRate = promoterRate(nps.filter((s) => inWindow(s.at, since, now)).map((s) => s.value));
    const previousRate = promoterRate(nps.filter((s) => inWindow(s.at, before, since)).map((s) => s.value));
    const allRate = promoterRate(nps.map((s) => s.value));
    const npsAverage = averageOf(nps.map((s) => s.value));
    return {
      average: round(averageOf(published.map((review) => review.rating)) ?? 0, 1),
      averageDelta:
        recentAverage === null || previousAverage === null ? null : round(recentAverage - previousAverage, 1),
      published: count('PUBLIE'),
      toValidate: count('A_VALIDER'),
      hidden: count('MASQUE'),
      responseRate: surveysSent === 0 ? 0 : round((answered / surveysSent) * 100, 1),
      surveysSent,
      recommendationRate: allRate === null ? null : round(allRate, 1),
      recommendationDelta:
        recentRate === null || previousRate === null ? null : round(recentRate - previousRate, 1),
      npsAverage: npsAverage === null ? null : round(npsAverage, 1),
      distribution,
    };
  }

  /** `PATCH /v1/admin/reviews/{id}` */
  async update(id: string, input: ReviewPatch, actor: AuditActor, now: Date): Promise<AdminReview> {
    const current = await this.findRow(id);
    const status = input.status ?? current.status;
    if (input.status === 'PUBLIE' && current.status !== 'PUBLIE' && !current.publishConsent)
      throw noConsentException();
    if (input.featured === true && status !== 'PUBLIE')
      throw conflict('Seul un avis publié peut être mis en avant sur l’accueil.');
    const service =
      input.serviceId === undefined
        ? undefined
        : input.serviceId === null
          ? null
          : await this.findService(input.serviceId);
    const featured = status === 'PUBLIE' ? (input.featured ?? current.featured) : false;
    const serviceId = service === undefined ? current.serviceId : (service?.id ?? null);

    await this.prisma.$transaction(async (tx) => {
      const site = await tx.review.findUniqueOrThrow({ where: { id }, select: REVIEW_SITE_SELECT });
      await tx.review.update({
        where: { id },
        data: {
          status,
          featured,
          serviceId,
          ...(status === 'PUBLIE' && current.status !== 'PUBLIE' ? { publishedAt: now } : {}),
          updatedAt: now,
        },
        select: { id: true },
      });
      if (current.status === 'PUBLIE' || status === 'PUBLIE')
        await requestRevalidation(tx, siteTags(site, [service?.slug ?? null]));
      const changes: string[] = [];
      if (status !== current.status) changes.push(STATUS_LABELS[status]);
      if (featured !== current.featured) changes.push(featured ? 'mis en avant' : 'retiré de l’accueil');
      if (serviceId !== current.serviceId) changes.push('service modifié');
      await recordAudit(tx, actor, {
        action: 'review.update',
        entity: 'Review',
        entityId: id,
        label: `A modifié l’avis ${origin(current)}${changes.length > 0 ? ` (${changes.join(', ')})` : ''}`,
        before: { status: current.status, featured: current.featured, serviceId: current.serviceId },
        after: { status, featured, serviceId },
      });
    });
    return this.detail(id);
  }

  /** `DELETE /v1/admin/reviews/{id}` : seuls les témoignages saisis à la main (un avis vérifié se masque). */
  async remove(id: string, actor: AuditActor): Promise<void> {
    const current = await this.findRow(id);
    if (current.verified)
      throw conflict('Seuls les avis ajoutés manuellement peuvent être supprimés. Masquez cet avis.');
    await this.prisma.$transaction(async (tx) => {
      const site = await tx.review.findUniqueOrThrow({ where: { id }, select: REVIEW_SITE_SELECT });
      await tx.review.delete({ where: { id }, select: { id: true } });
      if (current.status === 'PUBLIE') await requestRevalidation(tx, siteTags(site));
      await recordAudit(tx, actor, {
        action: 'review.delete',
        entity: 'Review',
        entityId: id,
        label: `A supprimé un témoignage ajouté manuellement (${STATUS_LABELS[current.status]})`,
        before: { status: current.status, rating: current.rating },
      });
    });
  }

  /** `POST /v1/admin/reviews/{id}/reply` : réponse publique de l'agence (`null` la retire). */
  async reply(id: string, input: ReviewReplyInput, actor: AuditActor, now: Date): Promise<AdminReview> {
    const current = await this.findRow(id);
    await this.prisma.$transaction(async (tx) => {
      const site = await tx.review.findUniqueOrThrow({ where: { id }, select: REVIEW_SITE_SELECT });
      await tx.review.update({
        where: { id },
        data:
          input.reply === null
            ? { reply: null, repliedAt: null, repliedById: null, updatedAt: now }
            : { reply: input.reply, repliedAt: now, repliedById: actor.userId, updatedAt: now },
        select: { id: true },
      });
      if (current.status === 'PUBLIE') await requestRevalidation(tx, siteTags(site));
      await recordAudit(tx, actor, {
        action: 'review.reply',
        entity: 'Review',
        entityId: id,
        label:
          input.reply === null
            ? `A retiré la réponse à l’avis ${origin(current)}`
            : `A répondu à l’avis ${origin(current)}`,
      });
    });
    return this.detail(id);
  }

  private async findRow(id: string): Promise<AdminReviewRow> {
    const row = await this.prisma.review.findUnique({ where: { id }, select: ADMIN_REVIEW_SELECT });
    if (row === null) throw reviewNotFound();
    return row;
  }

  private async detail(id: string): Promise<AdminReview> {
    return toAdminReview(await this.findRow(id));
  }

  /** Service du catalogue (tout statut) ; inconnu → 422 sur `serviceId`. */
  private async findService(serviceId: string): Promise<{ id: string; slug: string }> {
    const service = await this.prisma.service.findUnique({
      where: { id: serviceId },
      select: { id: true, slug: true },
    });
    if (service === null)
      throw validationException([
        { path: 'serviceId', code: 'unknown_service', message: 'Ce service n’existe pas.' },
      ]);
    return service;
  }
}
