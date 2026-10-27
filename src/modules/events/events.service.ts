import { Inject, Injectable } from '@nestjs/common';
import { recordAudit, type AuditActor } from '../../common/audit/audit-log.js';
import { DEFAULT_PAGE_SIZE, paginationMeta, type Page } from '../../common/pagination/pagination.js';
import { notFoundException, type ProblemFieldError } from '../../common/problem/problem.js';
import { CACHE_TAGS, requestRevalidation } from '../../common/revalidation/revalidation.js';
import { slugify, uniqueSlug } from '../../common/text/slug.js';
import { validationException } from '../../common/validation/validation-exception.js';
import type { Prisma, PublishStatus } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { unknownMediaErrors } from '../media/media-refs.js';
import { MediaService } from '../media/media.service.js';
import { REQUEST_LIST_SELECT, toRequestListItem, type RequestListItem } from '../requests/request.mapper.js';
import {
  EVENT_SELECT,
  NO_COUNTS,
  pastEventWhere,
  toAdminEvent,
  toPublicEvent,
  upcomingEventWhere,
  type AdminEvent,
  type EventCounts,
  type EventRow,
  type PublicEvent,
} from './event.mapper.js';
import type { EventInput, EventPatch, ListAdminEventsQuery, ListEventsQuery } from './event.schemas.js';

export const EVENT_NOT_FOUND = 'Cet événement n’existe pas ou a été supprimé.';

const SLUG_TAKEN: ProblemFieldError = {
  path: 'slug',
  code: 'slug_taken',
  message: 'Cette adresse est déjà utilisée par un autre événement.',
};
const ENDS_BEFORE_START: ProblemFieldError = {
  path: 'endsAt',
  code: 'ends_before_start',
  message: 'La fin doit être après le début.',
};

const STATUS_LABELS: Record<PublishStatus, string> = {
  DRAFT: 'Brouillon',
  PUBLISHED: 'Publié',
  ARCHIVED: 'Archivé',
};

/** Étiquettes de cache du site : agenda (page « Culture » et accueil lisent `GET /v1/events`). */
const EVENT_TAGS = [CACHE_TAGS.events];

/** `AdminEvent` et ses inscriptions (`GET /v1/admin/events/{id}`). */
export type AdminEventDetail = AdminEvent & { registrations: RequestListItem[] };

/**
 * Agenda culturel : lecture publique (`GET /v1/events`, événements publiés à venir — non terminés — du plus proche
 * au plus lointain, ou tous, du plus récent au plus ancien, avec les places restantes) et back-office
 * (`/v1/admin/events*` : liste par période avec nombre d'inscrits, détail avec les inscriptions — demandes
 * `EVENEMENT` —, création en brouillon, modification dont publication, suppression ; les inscriptions restent sans
 * événement). La capacité ne peut pas descendre sous les places déjà réservées (le contrôle des places à
 * l'inscription est fait par le formulaire public, 409 `event-full`).
 */
@Injectable()
export class EventsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MediaService) private readonly media: MediaService,
  ) {}

  /** Places réservées et nombre d'inscriptions par événement (une requête). */
  private async counts(ids: readonly string[]): Promise<Map<string, EventCounts>> {
    const result = new Map<string, EventCounts>(ids.map((id) => [id, { ...NO_COUNTS }]));
    if (ids.length === 0) return result;
    const groups = await this.prisma.request.groupBy({
      by: ['eventId'],
      where: { type: 'EVENEMENT', eventId: { in: [...ids] } },
      _sum: { seats: true },
      _count: { _all: true },
    });
    for (const group of groups)
      if (group.eventId !== null)
        result.set(group.eventId, { seatsTaken: group._sum.seats ?? 0, registrations: group._count._all });
    return result;
  }

  /** `GET /v1/events` */
  async listPublic(query: ListEventsQuery, now: Date): Promise<Page<PublicEvent>> {
    const where: Prisma.EventWhereInput = {
      status: 'PUBLISHED',
      ...(query.upcoming ? upcomingEventWhere(now) : {}),
    };
    const pageSize = query.limit ?? DEFAULT_PAGE_SIZE;
    const [total, rows] = await Promise.all([
      this.prisma.event.count({ where }),
      this.prisma.event.findMany({
        where,
        orderBy: [{ startsAt: query.upcoming ? 'asc' : 'desc' }, { id: 'asc' }],
        skip: (query.page - 1) * pageSize,
        take: pageSize,
        select: EVENT_SELECT,
      }),
    ]);
    const counts = await this.counts(rows.map((row) => row.id));
    return {
      data: rows.map((row) => toPublicEvent(row, counts.get(row.id) ?? NO_COUNTS, this.media, query.lang)),
      meta: paginationMeta(query.page, pageSize, total),
    };
  }

  /** `GET /v1/admin/events` : à venir (du plus proche), passés (du plus récent) ou tous (du plus récent). */
  async list(query: ListAdminEventsQuery, now: Date): Promise<AdminEvent[]> {
    const where =
      query.period === 'upcoming'
        ? upcomingEventWhere(now)
        : query.period === 'past'
          ? pastEventWhere(now)
          : {};
    const rows = await this.prisma.event.findMany({
      where,
      orderBy: [{ startsAt: query.period === 'upcoming' ? 'asc' : 'desc' }, { id: 'asc' }],
      select: EVENT_SELECT,
    });
    const counts = await this.counts(rows.map((row) => row.id));
    return rows.map((row) => toAdminEvent(row, counts.get(row.id) ?? NO_COUNTS, this.media));
  }

  private async toAdmin(row: EventRow): Promise<AdminEvent> {
    const counts = await this.counts([row.id]);
    return toAdminEvent(row, counts.get(row.id) ?? NO_COUNTS, this.media);
  }

  /** `GET /v1/admin/events/{id}` : inscriptions de la plus récente à la plus ancienne. */
  async detail(id: string, now: Date): Promise<AdminEventDetail> {
    const row = await this.prisma.event.findUnique({ where: { id }, select: EVENT_SELECT });
    if (!row) throw notFoundException(EVENT_NOT_FOUND);
    const [event, registrations] = await Promise.all([
      this.toAdmin(row),
      this.prisma.request.findMany({
        where: { type: 'EVENEMENT', eventId: id },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: REQUEST_LIST_SELECT,
      }),
    ]);
    return { ...event, registrations: registrations.map((request) => toRequestListItem(request, now)) };
  }

  private async slugTaken(slug: string, exceptId?: string): Promise<boolean> {
    const other = await this.prisma.event.findUnique({ where: { slug }, select: { id: true } });
    return other !== null && other.id !== exceptId;
  }

  private async freeSlug(title: string): Promise<string> {
    const base = slugify(title);
    const taken = await this.prisma.event.findMany({
      where: { slug: { startsWith: base === '' ? 'evenement' : base } },
      select: { slug: true },
    });
    return uniqueSlug(base, new Set(taken.map((row) => row.slug)), 'evenement');
  }

  /** `POST /v1/admin/events` */
  async create(input: EventInput, actor: AuditActor, now: Date): Promise<AdminEvent> {
    const status = input.status ?? 'DRAFT';
    const errors: ProblemFieldError[] = await unknownMediaErrors(this.media, [
      { path: 'imageId', id: input.imageId },
    ]);
    let slug = input.slug;
    if (slug === undefined) slug = await this.freeSlug(input.title);
    else if (await this.slugTaken(slug)) errors.push(SLUG_TAKEN);
    if (input.endsAt && Date.parse(input.endsAt) <= Date.parse(input.startsAt))
      errors.push(ENDS_BEFORE_START);
    if (errors.length > 0) throw validationException(errors);

    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.event.create({
        data: {
          slug,
          title: input.title,
          startsAt: new Date(input.startsAt),
          endsAt: input.endsAt ? new Date(input.endsAt) : null,
          city: input.city,
          place: input.place ?? null,
          tag: input.tag,
          illustration: input.illustration,
          imageId: input.imageId ?? null,
          description: input.description ?? null,
          capacity: input.capacity ?? null,
          limited: input.limited ?? false,
          status,
          publishedAt: status === 'PUBLISHED' ? now : null,
        },
        select: EVENT_SELECT,
      });
      if (status === 'PUBLISHED') await requestRevalidation(tx, EVENT_TAGS);
      await recordAudit(tx, actor, {
        action: 'event.create',
        entity: 'Event',
        entityId: created.id,
        label: `A créé l’événement « ${created.title} » (${STATUS_LABELS[status]})`,
        after: { slug: created.slug, status },
      });
      return created;
    });
    return toAdminEvent(row, NO_COUNTS, this.media);
  }

  /** `PATCH /v1/admin/events/{id}` : champs fournis seulement (dont publication via `status`). */
  async update(id: string, patch: EventPatch, actor: AuditActor, now: Date): Promise<AdminEvent> {
    const current = await this.prisma.event.findUnique({ where: { id }, select: EVENT_SELECT });
    if (!current) throw notFoundException(EVENT_NOT_FOUND);
    const errors: ProblemFieldError[] = await unknownMediaErrors(this.media, [
      { path: 'imageId', id: patch.imageId },
    ]);
    if (patch.slug !== undefined && patch.slug !== current.slug && (await this.slugTaken(patch.slug, id)))
      errors.push(SLUG_TAKEN);
    const startsAt = patch.startsAt ? new Date(patch.startsAt) : current.startsAt;
    const endsAt =
      patch.endsAt === undefined ? current.endsAt : patch.endsAt === null ? null : new Date(patch.endsAt);
    if (endsAt !== null && endsAt.getTime() <= startsAt.getTime()) errors.push(ENDS_BEFORE_START);
    if (patch.capacity !== undefined && patch.capacity !== null) {
      const { seatsTaken } = (await this.counts([id])).get(id) ?? NO_COUNTS;
      if (patch.capacity < seatsTaken)
        errors.push({
          path: 'capacity',
          code: 'below_seats_taken',
          message: `${String(seatsTaken)} places sont déjà réservées : la capacité ne peut pas être inférieure.`,
        });
    }
    if (errors.length > 0) throw validationException(errors);

    const data: Prisma.EventUpdateInput = {};
    if (patch.title !== undefined) data.title = patch.title;
    if (patch.slug !== undefined) data.slug = patch.slug;
    if (patch.startsAt !== undefined) data.startsAt = startsAt;
    if (patch.endsAt !== undefined) data.endsAt = endsAt;
    if (patch.city !== undefined) data.city = patch.city;
    if (patch.place !== undefined) data.place = patch.place;
    if (patch.tag !== undefined) data.tag = patch.tag;
    if (patch.illustration !== undefined) data.illustration = patch.illustration;
    if (patch.imageId !== undefined)
      data.image = patch.imageId === null ? { disconnect: true } : { connect: { id: patch.imageId } };
    if (patch.description !== undefined) data.description = patch.description;
    if (patch.capacity !== undefined) data.capacity = patch.capacity;
    if (patch.limited !== undefined) data.limited = patch.limited;
    if (patch.status !== undefined) data.status = patch.status;
    if (patch.status === 'PUBLISHED' && current.publishedAt === null) data.publishedAt = now;

    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.event.update({ where: { id }, data, select: EVENT_SELECT });
      if (current.status === 'PUBLISHED' || updated.status === 'PUBLISHED')
        await requestRevalidation(tx, EVENT_TAGS);
      await recordAudit(tx, actor, {
        action: 'event.update',
        entity: 'Event',
        entityId: id,
        label:
          updated.status !== current.status
            ? `A passé l’événement « ${updated.title} » de « ${STATUS_LABELS[current.status]} » à « ${STATUS_LABELS[updated.status]} »`
            : `A modifié l’événement « ${updated.title} »`,
        before: { slug: current.slug, status: current.status },
        after: { slug: updated.slug, status: updated.status, fields: Object.keys(patch) },
      });
      return updated;
    });
    return this.toAdmin(row);
  }

  /** `DELETE /v1/admin/events/{id}` : les inscriptions (demandes) restent, sans événement (`SetNull`). */
  async remove(id: string, actor: AuditActor): Promise<void> {
    const current = await this.prisma.event.findUnique({
      where: { id },
      select: { id: true, slug: true, title: true, status: true },
    });
    if (!current) throw notFoundException(EVENT_NOT_FOUND);
    await this.prisma.$transaction(async (tx) => {
      await tx.event.delete({ where: { id }, select: { id: true } });
      if (current.status === 'PUBLISHED') await requestRevalidation(tx, EVENT_TAGS);
      await recordAudit(tx, actor, {
        action: 'event.delete',
        entity: 'Event',
        entityId: id,
        label: `A supprimé l’événement « ${current.title} »`,
        before: { slug: current.slug, status: current.status },
      });
    });
  }
}
