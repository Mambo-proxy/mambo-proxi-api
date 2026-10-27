import { Inject, Injectable } from '@nestjs/common';
import { recordAudit, type AuditActor } from '../../common/audit/audit-log.js';
import { notFoundException, type ProblemFieldError } from '../../common/problem/problem.js';
import { CACHE_TAGS, requestRevalidation } from '../../common/revalidation/revalidation.js';
import { slugify, uniqueSlug } from '../../common/text/slug.js';
import { validationException } from '../../common/validation/validation-exception.js';
import type { Prisma, PublishStatus } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { recordRedirect } from '../navigation/redirects.js';
import {
  JOB_OFFER_SELECT,
  toAdminJobOffer,
  type AdminJobOffer,
  type JobOfferRow,
  type JobSalary,
} from './job.mapper.js';
import type { JobOfferInput, JobOfferPatch, ListAdminJobsQuery } from './job.schemas.js';

export const ADMIN_JOB_NOT_FOUND = 'Cette offre n’existe pas ou a été supprimée.';
const jobNotFound = () => notFoundException(ADMIN_JOB_NOT_FOUND);

const SLUG_TAKEN: ProblemFieldError = {
  path: 'slug',
  code: 'slug_taken',
  message: 'Cette adresse est déjà utilisée par une autre offre.',
};
const MISSIONS_REQUIRED: ProblemFieldError = {
  path: 'missions',
  code: 'required_to_publish',
  message: 'Ajoutez au moins une mission avant de publier l’offre.',
};

/** Ordre de la liste : publiées, puis brouillons, puis archivées ; les plus récentes d'abord. */
const STATUS_RANK: Record<PublishStatus, number> = { PUBLISHED: 0, DRAFT: 1, ARCHIVED: 2 };

const STATUS_LABELS: Record<PublishStatus, string> = {
  DRAFT: 'Brouillon',
  PUBLISHED: 'Publiée',
  ARCHIVED: 'Archivée',
};

/** Adresse publique d'une offre (`/recrutement/{slug}`). */
export function jobPath(slug: string): string {
  return `/recrutement/${slug}`;
}

/** Colonnes `salary…` d'une rémunération (`null` : aucune). */
function salaryColumns(salary: JobSalary | null) {
  return {
    salaryMin: salary?.min ?? null,
    salaryMax: salary?.max ?? null,
    salaryCurrency: salary?.currency ?? null,
    salaryPeriod: salary?.period ?? null,
  };
}

interface Counts {
  applications: number;
  newApplications: number;
}

/**
 * Offres d'emploi du back-office (tag « Admin — Recrutement ») : liste avec compteurs de candidatures, création
 * (brouillon par défaut, slug tiré du titre), modification (dont publication et archivage via `status`), suppression
 * (les candidatures sont conservées, sans offre). Toute modification visible sur le site demande la revalidation des
 * étiquettes `jobs`, `job:<slug>` et `sitemap` ; un changement d'adresse d'une offre publiée crée une redirection 301.
 */
@Injectable()
export class AdminJobsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Compteurs de candidatures par offre (candidatures non anonymisées). */
  private async counts(ids: readonly string[]): Promise<Map<string, Counts>> {
    const result = new Map<string, Counts>(ids.map((id) => [id, { applications: 0, newApplications: 0 }]));
    if (ids.length === 0) return result;
    const groups = await this.prisma.jobApplication.groupBy({
      by: ['jobOfferId', 'status'],
      where: { jobOfferId: { in: [...ids] }, request: { anonymizedAt: null } },
      _count: { _all: true },
    });
    for (const group of groups) {
      const entry = group.jobOfferId === null ? undefined : result.get(group.jobOfferId);
      if (!entry) continue;
      entry.applications += group._count._all;
      if (group.status === 'NOUVEAU') entry.newApplications += group._count._all;
    }
    return result;
  }

  private async toAdmin(row: JobOfferRow): Promise<AdminJobOffer> {
    const counts = await this.counts([row.id]);
    return toAdminJobOffer(row, counts.get(row.id) ?? { applications: 0, newApplications: 0 });
  }

  /** `GET /v1/admin/jobs` */
  async list(query: ListAdminJobsQuery): Promise<AdminJobOffer[]> {
    const rows = await this.prisma.jobOffer.findMany({
      where: query.status ? { status: query.status } : {},
      select: JOB_OFFER_SELECT,
    });
    rows.sort(
      (a, b) =>
        STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
        (b.publishedAt ?? b.createdAt).getTime() - (a.publishedAt ?? a.createdAt).getTime() ||
        a.id.localeCompare(b.id),
    );
    const counts = await this.counts(rows.map((row) => row.id));
    return rows.map((row) =>
      toAdminJobOffer(row, counts.get(row.id) ?? { applications: 0, newApplications: 0 }),
    );
  }

  /** `GET /v1/admin/jobs/{id}` */
  async detail(id: string): Promise<AdminJobOffer> {
    const row = await this.prisma.jobOffer.findUnique({ where: { id }, select: JOB_OFFER_SELECT });
    if (!row) throw jobNotFound();
    return this.toAdmin(row);
  }

  private async slugTaken(slug: string, exceptId?: string): Promise<boolean> {
    const other = await this.prisma.jobOffer.findUnique({ where: { slug }, select: { id: true } });
    return other !== null && other.id !== exceptId;
  }

  /** `POST /v1/admin/jobs` : brouillon par défaut ; slug libre tiré du titre s'il n'est pas fourni. */
  async create(input: JobOfferInput, actor: AuditActor, now: Date): Promise<AdminJobOffer> {
    const status = input.status ?? 'DRAFT';
    const errors: ProblemFieldError[] = [];
    let slug = input.slug;
    if (slug === undefined) {
      const base = slugify(input.title);
      const taken = await this.prisma.jobOffer.findMany({
        where: { slug: { startsWith: base === '' ? 'offre' : base } },
        select: { slug: true },
      });
      slug = uniqueSlug(base, new Set(taken.map((row) => row.slug)), 'offre');
    } else if (await this.slugTaken(slug)) errors.push(SLUG_TAKEN);
    if (status === 'PUBLISHED' && (input.missions ?? []).length === 0) errors.push(MISSIONS_REQUIRED);
    if (errors.length > 0) throw validationException(errors);

    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.jobOffer.create({
        data: {
          slug,
          title: input.title,
          city: input.city,
          country: input.country,
          contractType: input.contractType,
          startDate: input.startDate ?? null,
          workingTime: input.workingTime ?? null,
          locationLabel: input.locationLabel ?? null,
          sectors: input.sectors ?? [],
          ...salaryColumns(input.salary ?? null),
          schedule: input.schedule ?? null,
          summary: input.summary,
          description: input.description ?? null,
          missions: input.missions ?? [],
          profile: input.profile ?? [],
          benefits: input.benefits ?? [],
          status,
          publishedAt: status === 'PUBLISHED' ? now : null,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
          createdAt: now,
          updatedAt: now,
        },
        select: JOB_OFFER_SELECT,
      });
      if (status === 'PUBLISHED')
        await requestRevalidation(tx, [CACHE_TAGS.jobs, CACHE_TAGS.job(created.slug), CACHE_TAGS.sitemap]);
      await recordAudit(tx, actor, {
        action: 'job.create',
        entity: 'JobOffer',
        entityId: created.id,
        label: `A créé l’offre « ${created.title} » (${STATUS_LABELS[status]})`,
        after: { slug: created.slug, status },
      });
      return created;
    });
    return toAdminJobOffer(row, { applications: 0, newApplications: 0 });
  }

  /**
   * `PATCH /v1/admin/jobs/{id}` : champs fournis seulement ; publication (`status: PUBLISHED`, date de première
   * publication posée), archivage (offre pourvue : 410 sur le site), retour en brouillon. Les exigences de
   * publication (au moins une mission) portent sur l'offre complète après modification.
   */
  async update(id: string, patch: JobOfferPatch, actor: AuditActor, now: Date): Promise<AdminJobOffer> {
    const current = await this.prisma.jobOffer.findUnique({ where: { id }, select: JOB_OFFER_SELECT });
    if (!current) throw jobNotFound();
    const status = patch.status ?? current.status;
    const slug = patch.slug ?? current.slug;
    const missions = patch.missions ?? current.missions;
    const errors: ProblemFieldError[] = [];
    if (slug !== current.slug && (await this.slugTaken(slug, id))) errors.push(SLUG_TAKEN);
    if (status === 'PUBLISHED' && missions.length === 0) errors.push(MISSIONS_REQUIRED);
    if (errors.length > 0) throw validationException(errors);

    const data: Prisma.JobOfferUpdateInput = { updatedAt: now };
    if (patch.title !== undefined) data.title = patch.title;
    if (patch.slug !== undefined) data.slug = patch.slug;
    if (patch.city !== undefined) data.city = patch.city;
    if (patch.country !== undefined) data.country = patch.country;
    if (patch.contractType !== undefined) data.contractType = patch.contractType;
    if (patch.startDate !== undefined) data.startDate = patch.startDate;
    if (patch.workingTime !== undefined) data.workingTime = patch.workingTime;
    if (patch.locationLabel !== undefined) data.locationLabel = patch.locationLabel;
    if (patch.sectors !== undefined) data.sectors = patch.sectors;
    if (patch.salary !== undefined) Object.assign(data, salaryColumns(patch.salary));
    if (patch.schedule !== undefined) data.schedule = patch.schedule;
    if (patch.summary !== undefined) data.summary = patch.summary;
    if (patch.description !== undefined) data.description = patch.description;
    if (patch.missions !== undefined) data.missions = patch.missions;
    if (patch.profile !== undefined) data.profile = patch.profile;
    if (patch.benefits !== undefined) data.benefits = patch.benefits;
    if (patch.expiresAt !== undefined) data.expiresAt = patch.expiresAt ? new Date(patch.expiresAt) : null;
    if (patch.status !== undefined) data.status = patch.status;
    if (status === 'PUBLISHED' && current.publishedAt === null) data.publishedAt = now;

    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.jobOffer.update({ where: { id }, data, select: JOB_OFFER_SELECT });
      const wasPublic = current.status !== 'DRAFT';
      const isPublic = updated.status !== 'DRAFT';
      const tags: string[] = [];
      if (wasPublic || isPublic) tags.push(CACHE_TAGS.jobs, CACHE_TAGS.sitemap, CACHE_TAGS.job(updated.slug));
      if (wasPublic && updated.slug !== current.slug) {
        tags.push(CACHE_TAGS.job(current.slug));
        if (await recordRedirect(tx, jobPath(current.slug), jobPath(updated.slug), { name: 'JobOffer', id }))
          tags.push(CACHE_TAGS.redirects);
      }
      await requestRevalidation(tx, tags);
      await recordAudit(tx, actor, {
        action: 'job.update',
        entity: 'JobOffer',
        entityId: id,
        label:
          updated.status !== current.status
            ? `A passé l’offre « ${updated.title} » de « ${STATUS_LABELS[current.status]} » à « ${STATUS_LABELS[updated.status]} »`
            : `A modifié l’offre « ${updated.title} »`,
        before: { slug: current.slug, status: current.status },
        after: { slug: updated.slug, status: updated.status, fields: Object.keys(patch) },
      });
      return updated;
    });
    return this.toAdmin(row);
  }

  /** `DELETE /v1/admin/jobs/{id}` : les candidatures et demandes liées restent (offre retirée : `SetNull`). */
  async remove(id: string, actor: AuditActor): Promise<void> {
    const current = await this.prisma.jobOffer.findUnique({
      where: { id },
      select: { id: true, slug: true, title: true, status: true },
    });
    if (!current) throw jobNotFound();
    await this.prisma.$transaction(async (tx) => {
      await tx.jobOffer.delete({ where: { id }, select: { id: true } });
      const redirects = await tx.redirect.deleteMany({ where: { entity: 'JobOffer', entityId: id } });
      if (current.status !== 'DRAFT')
        await requestRevalidation(tx, [
          CACHE_TAGS.jobs,
          CACHE_TAGS.sitemap,
          CACHE_TAGS.job(current.slug),
          ...(redirects.count > 0 ? [CACHE_TAGS.redirects] : []),
        ]);
      await recordAudit(tx, actor, {
        action: 'job.delete',
        entity: 'JobOffer',
        entityId: id,
        label: `A supprimé l’offre « ${current.title} »`,
        before: { slug: current.slug, status: current.status },
      });
    });
  }
}
