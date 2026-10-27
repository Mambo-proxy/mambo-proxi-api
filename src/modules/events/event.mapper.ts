import type { Lang } from '../../common/i18n/lang.js';
import { localizeFields } from '../../common/i18n/translations.js';
import type { Prisma, PublishStatus } from '../../generated/prisma/client.js';
import type { MediaService } from '../media/media.service.js';
import { mediaImageSelect, type Visual } from '../media/visual.mapper.js';

export const EVENT_SELECT = {
  id: true,
  slug: true,
  title: true,
  startsAt: true,
  endsAt: true,
  city: true,
  place: true,
  tag: true,
  illustration: true,
  description: true,
  capacity: true,
  limited: true,
  status: true,
  publishedAt: true,
  translations: true,
  image: { select: mediaImageSelect },
} as const satisfies Prisma.EventSelect;

export type EventRow = Prisma.EventGetPayload<{ select: typeof EVENT_SELECT }>;

/** Schéma `Event` du contrat. */
export interface PublicEvent {
  id: string;
  slug: string;
  title: string;
  startsAt: string;
  endsAt: string | null;
  city: string;
  place: string | null;
  tag: string;
  visual: Visual;
  description: string | null;
  capacity: number | null;
  remainingPlaces: number | null;
  limited: boolean;
}

/** Schéma `AdminEvent` du contrat. */
export interface AdminEvent extends PublicEvent {
  status: PublishStatus;
  registrationsCount: number;
  seatsTaken: number;
}

/** Places réservées et inscriptions d'un événement. */
export interface EventCounts {
  seatsTaken: number;
  registrations: number;
}

export const NO_COUNTS: EventCounts = { seatsTaken: 0, registrations: 0 };

const TRANSLATABLE = ['title', 'city', 'place', 'tag', 'description'] as const;

/** Un événement est passé quand sa fin (à défaut, son début) est dépassée. */
export function upcomingEventWhere(now: Date): Prisma.EventWhereInput {
  return {
    OR: [{ endsAt: { gte: now } }, { endsAt: null, startsAt: { gte: now } }],
  };
}

export function pastEventWhere(now: Date): Prisma.EventWhereInput {
  return {
    OR: [{ endsAt: { lt: now } }, { endsAt: null, startsAt: { lt: now } }],
  };
}

export function toPublicEvent(
  row: EventRow,
  counts: EventCounts,
  media: MediaService,
  lang: Lang,
): PublicEvent {
  const base: PublicEvent = {
    id: row.id,
    slug: row.slug,
    title: row.title,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt?.toISOString() ?? null,
    city: row.city,
    place: row.place,
    tag: row.tag,
    visual: media.visual(row.illustration, row.image),
    description: row.description,
    capacity: row.capacity,
    remainingPlaces: row.capacity === null ? null : Math.max(0, row.capacity - counts.seatsTaken),
    limited: row.limited,
  };
  return localizeFields(base, row.translations, lang, TRANSLATABLE);
}

export function toAdminEvent(row: EventRow, counts: EventCounts, media: MediaService): AdminEvent {
  return {
    ...toPublicEvent(row, counts, media, 'fr'),
    status: row.status,
    registrationsCount: counts.registrations,
    seatsTaken: counts.seatsTaken,
  };
}
