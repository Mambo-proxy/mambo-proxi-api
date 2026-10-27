import { Inject, Injectable } from '@nestjs/common';
import { recordAudit, type AuditActor } from '../../common/audit/audit-log.js';
import { paginationMeta, pageWindow, type Page } from '../../common/pagination/pagination.js';
import { notFoundException, type ProblemFieldError } from '../../common/problem/problem.js';
import { CACHE_TAGS, requestRevalidation } from '../../common/revalidation/revalidation.js';
import { slugify, uniqueSlug } from '../../common/text/slug.js';
import { validationException } from '../../common/validation/validation-exception.js';
import type { Prisma, PublishStatus, RequestStatus } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { ReorderInput } from '../catalog/admin-catalog.schemas.js';
import {
  CONTACT_SUMMARY_SELECT,
  toContactSummary,
  type ContactSummary,
} from '../contacts/contact-summary.js';
import {
  TRAINING_ORDER,
  TRAINING_SELECT,
  toAdminTraining,
  toTraining,
  type AdminTraining,
  type Training,
  type TrainingRow,
} from './training.mapper.js';
import type {
  ListTrainingRequestsQuery,
  ListTrainingsQuery,
  TrainingInput,
  TrainingPatch,
} from './training.schemas.js';

export const TRAINING_NOT_FOUND = 'Cette formation n’existe pas ou a été supprimée.';

const SLUG_TAKEN: ProblemFieldError = {
  path: 'slug',
  code: 'slug_taken',
  message: 'Cette adresse est déjà utilisée par une autre formation.',
};

const STATUS_LABELS: Record<PublishStatus, string> = {
  DRAFT: 'Brouillon',
  PUBLISHED: 'Publiée',
  ARCHIVED: 'Archivée',
};

/** Étiquettes de cache du site : catalogue et page « Formation ». */
const TRAINING_TAGS = [CACHE_TAGS.trainings, CACHE_TAGS.page('formation')];

/** Schéma `AdminTrainingRequest` du contrat. */
export interface AdminTrainingRequest {
  id: string;
  reference: string;
  status: RequestStatus;
  organization: string | null;
  contact: ContactSummary;
  training: { id: string; slug: string; title: string } | null;
  otherTraining: string | null;
  participants: number;
  period: string | null;
  createdAt: string;
}

const TRAINING_REQUEST_SELECT = {
  id: true,
  reference: true,
  status: true,
  organization: true,
  otherTraining: true,
  participants: true,
  period: true,
  createdAt: true,
  contact: { select: CONTACT_SUMMARY_SELECT },
  training: { select: { id: true, slug: true, title: true } },
} as const satisfies Prisma.RequestSelect;

/**
 * Formations : catalogue du site (`GET /v1/trainings`, formations publiées dans l'ordre enregistré, traduites si
 * `translations.en` est renseigné) et back-office (`/v1/admin/trainings*` : création — brouillon par défaut, slug
 * tiré du titre —, modification dont publication, ordre, suppression ; les demandes liées sont conservées sans
 * formation). Demandes de formation : `GET /v1/admin/training-requests` (demandes `FORMATION`). Toute modification
 * d'une formation visible (avant ou après) demande la revalidation de `trainings` et `page:formation`.
 */
@Injectable()
export class TrainingsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** `GET /v1/trainings` */
  async listPublic(query: ListTrainingsQuery): Promise<Training[]> {
    const rows = await this.prisma.training.findMany({
      where: { status: 'PUBLISHED', ...(query.category ? { category: query.category } : {}) },
      orderBy: [...TRAINING_ORDER],
      select: TRAINING_SELECT,
    });
    return rows.map((row) => toTraining(row, query.lang));
  }

  /** Demandes de formation (non anonymisées) par formation. */
  private async counts(ids: readonly string[]): Promise<Map<string, number>> {
    const result = new Map<string, number>(ids.map((id) => [id, 0]));
    if (ids.length === 0) return result;
    const groups = await this.prisma.request.groupBy({
      by: ['trainingId'],
      where: { type: 'FORMATION', trainingId: { in: [...ids] }, anonymizedAt: null },
      _count: { _all: true },
    });
    for (const group of groups)
      if (group.trainingId !== null) result.set(group.trainingId, group._count._all);
    return result;
  }

  private async toAdmin(row: TrainingRow): Promise<AdminTraining> {
    const counts = await this.counts([row.id]);
    return toAdminTraining(row, counts.get(row.id) ?? 0);
  }

  /** `GET /v1/admin/trainings` */
  async list(): Promise<AdminTraining[]> {
    const rows = await this.prisma.training.findMany({
      orderBy: [...TRAINING_ORDER],
      select: TRAINING_SELECT,
    });
    const counts = await this.counts(rows.map((row) => row.id));
    return rows.map((row) => toAdminTraining(row, counts.get(row.id) ?? 0));
  }

  private async slugTaken(slug: string, exceptId?: string): Promise<boolean> {
    const other = await this.prisma.training.findUnique({ where: { slug }, select: { id: true } });
    return other !== null && other.id !== exceptId;
  }

  private async freeSlug(title: string): Promise<string> {
    const base = slugify(title);
    const taken = await this.prisma.training.findMany({
      where: { slug: { startsWith: base === '' ? 'formation' : base } },
      select: { slug: true },
    });
    return uniqueSlug(base, new Set(taken.map((row) => row.slug)), 'formation');
  }

  /** `POST /v1/admin/trainings` : placée en fin de catalogue. */
  async create(input: TrainingInput, actor: AuditActor): Promise<AdminTraining> {
    const status = input.status ?? 'DRAFT';
    let slug = input.slug;
    if (slug === undefined) slug = await this.freeSlug(input.title);
    else if (await this.slugTaken(slug)) throw validationException([SLUG_TAKEN]);

    const row = await this.prisma.$transaction(async (tx) => {
      const last = await tx.training.aggregate({ _max: { sortOrder: true } });
      const created = await tx.training.create({
        data: {
          slug,
          title: input.title,
          category: input.category,
          audienceLabel: input.audienceLabel,
          icon: input.icon,
          duration: input.duration,
          format: input.format,
          location: input.location ?? null,
          description: input.description ?? null,
          status,
          sortOrder: (last._max.sortOrder ?? 0) + 1,
        },
        select: TRAINING_SELECT,
      });
      if (status === 'PUBLISHED') await requestRevalidation(tx, TRAINING_TAGS);
      await recordAudit(tx, actor, {
        action: 'training.create',
        entity: 'Training',
        entityId: created.id,
        label: `A créé la formation « ${created.title} » (${STATUS_LABELS[status]})`,
        after: { slug: created.slug, status },
      });
      return created;
    });
    return toAdminTraining(row, 0);
  }

  /** `PATCH /v1/admin/trainings/{id}` : champs fournis seulement (dont publication via `status`). */
  async update(id: string, patch: TrainingPatch, actor: AuditActor): Promise<AdminTraining> {
    const current = await this.prisma.training.findUnique({ where: { id }, select: TRAINING_SELECT });
    if (!current) throw notFoundException(TRAINING_NOT_FOUND);
    if (patch.slug !== undefined && patch.slug !== current.slug && (await this.slugTaken(patch.slug, id)))
      throw validationException([SLUG_TAKEN]);

    const data: Prisma.TrainingUpdateInput = {};
    if (patch.title !== undefined) data.title = patch.title;
    if (patch.slug !== undefined) data.slug = patch.slug;
    if (patch.category !== undefined) data.category = patch.category;
    if (patch.audienceLabel !== undefined) data.audienceLabel = patch.audienceLabel;
    if (patch.icon !== undefined) data.icon = patch.icon;
    if (patch.duration !== undefined) data.duration = patch.duration;
    if (patch.format !== undefined) data.format = patch.format;
    if (patch.location !== undefined) data.location = patch.location;
    if (patch.description !== undefined) data.description = patch.description;
    if (patch.status !== undefined) data.status = patch.status;

    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.training.update({ where: { id }, data, select: TRAINING_SELECT });
      if (current.status === 'PUBLISHED' || updated.status === 'PUBLISHED')
        await requestRevalidation(tx, TRAINING_TAGS);
      await recordAudit(tx, actor, {
        action: 'training.update',
        entity: 'Training',
        entityId: id,
        label:
          updated.status !== current.status
            ? `A passé la formation « ${updated.title} » de « ${STATUS_LABELS[current.status]} » à « ${STATUS_LABELS[updated.status]} »`
            : `A modifié la formation « ${updated.title} »`,
        before: { slug: current.slug, status: current.status },
        after: { slug: updated.slug, status: updated.status, fields: Object.keys(patch) },
      });
      return updated;
    });
    return this.toAdmin(row);
  }

  /** `PATCH /v1/admin/trainings/reorder` */
  async reorder(input: ReorderInput, actor: AuditActor): Promise<void> {
    const rows = await this.prisma.training.findMany({
      where: { id: { in: input.ids } },
      select: { id: true, status: true },
    });
    if (rows.length !== input.ids.length)
      throw validationException([
        { path: 'ids', code: 'invalid_order', message: 'Certaines formations n’existent plus.' },
      ]);
    await this.prisma.$transaction(async (tx) => {
      for (const [index, id] of input.ids.entries())
        await tx.training.update({ where: { id }, data: { sortOrder: index + 1 }, select: { id: true } });
      if (rows.some((row) => row.status === 'PUBLISHED')) await requestRevalidation(tx, TRAINING_TAGS);
      await recordAudit(tx, actor, {
        action: 'training.reorder',
        entity: 'Training',
        entityId: null,
        label: 'A réordonné le catalogue des formations',
        after: { ids: input.ids },
      });
    });
  }

  /** `DELETE /v1/admin/trainings/{id}` : les demandes de formation restent (formation retirée : `SetNull`). */
  async remove(id: string, actor: AuditActor): Promise<void> {
    const current = await this.prisma.training.findUnique({
      where: { id },
      select: { id: true, slug: true, title: true, status: true },
    });
    if (!current) throw notFoundException(TRAINING_NOT_FOUND);
    await this.prisma.$transaction(async (tx) => {
      await tx.training.delete({ where: { id }, select: { id: true } });
      if (current.status === 'PUBLISHED') await requestRevalidation(tx, TRAINING_TAGS);
      await recordAudit(tx, actor, {
        action: 'training.delete',
        entity: 'Training',
        entityId: id,
        label: `A supprimé la formation « ${current.title} »`,
        before: { slug: current.slug, status: current.status },
      });
    });
  }

  /** `GET /v1/admin/training-requests` : demandes `FORMATION` non anonymisées, la plus récente en premier. */
  async listRequests(query: ListTrainingRequestsQuery): Promise<Page<AdminTrainingRequest>> {
    const where: Prisma.RequestWhereInput = {
      type: 'FORMATION',
      anonymizedAt: null,
      ...(query.status ? { status: query.status } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.request.count({ where }),
      this.prisma.request.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...pageWindow(query.page, query.pageSize),
        select: TRAINING_REQUEST_SELECT,
      }),
    ]);
    return {
      data: rows.map((row) => ({
        id: row.id,
        reference: row.reference,
        status: row.status,
        organization: row.organization,
        contact: toContactSummary(row.contact),
        training: row.training,
        otherTraining: row.otherTraining,
        participants: Math.max(1, row.participants ?? 1),
        period: row.period,
        createdAt: row.createdAt.toISOString(),
      })),
      meta: paginationMeta(query.page, query.pageSize, total),
    };
  }
}
