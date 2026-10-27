import type {
  ContactPreference,
  Prisma,
  SubscriberSource,
  SubscriberStatus,
} from '../../generated/prisma/client.js';
import {
  ADMIN_APPOINTMENT_SELECT,
  toAdminAppointment,
  type AdminAppointment,
  type AdminAppointmentRow,
} from '../appointments/appointment.mapper.js';
import {
  REQUEST_LIST_SELECT,
  toRequestListItem,
  type RequestListItem,
  type RequestListRow,
} from '../requests/request.mapper.js';
import {
  CONTACT_SUMMARY_SELECT,
  toContactSummary,
  type ContactSummary,
  type ContactSummaryRow,
} from './contact-summary.js';

/** Libellés de l'abonnement (description de `SubscriberStatus` du contrat), colonne « Newsletter » de l'export. */
export const SUBSCRIBER_STATUS_LABELS: Record<SubscriberStatus, string> = {
  EN_ATTENTE: 'En attente',
  CONFIRME: 'Abonné',
  DESINSCRIT: 'Désinscrit',
};

/** Formulaire d'origine d'un abonnement, tel qu'enregistré en base (`@map` de `SubscriberSource`). */
const SUBSCRIBER_SOURCES: Record<SubscriberSource, string> = {
  FOOTER: 'footer',
  SUIVI_MAMBO: 'suivi-mambo',
  INSCRIPTION: 'inscription',
  AUTRE: 'autre',
};

/** Demandes comptées et affichées : les demandes anonymisées n'apparaissent plus. */
const VISIBLE_REQUESTS = { anonymizedAt: null } as const;

/** Colonnes d'une ligne de la liste (schéma `AdminContactListItem`). */
export const ADMIN_CONTACT_LIST_SELECT = {
  ...CONTACT_SUMMARY_SELECT,
  organization: true,
  source: true,
  createdAt: true,
  interests: { select: { category: { select: { slug: true, name: true, sortOrder: true } } } },
  subscriber: { select: { status: true } },
  _count: { select: { requests: { where: VISIBLE_REQUESTS } } },
} as const satisfies Prisma.ContactSelect;

export interface AdminContactListRow extends ContactSummaryRow {
  organization: string | null;
  source: string | null;
  createdAt: Date;
  interests: { category: { slug: string; name: string; sortOrder: number } }[];
  subscriber: { status: SubscriberStatus } | null;
  _count: { requests: number };
}

export interface AdminContactListItem extends ContactSummary {
  organization: string | null;
  interests: { slug: string; name: string }[];
  requestsCount: number;
  newsletterStatus: SubscriberStatus | null;
  source: string | null;
  createdAt: string;
}

/** Rubriques d'intérêt dans l'ordre d'affichage des rubriques. */
function interestsOf(row: AdminContactListRow): { slug: string; name: string }[] {
  return [...row.interests]
    .sort(
      (a, b) =>
        a.category.sortOrder - b.category.sortOrder || a.category.name.localeCompare(b.category.name, 'fr'),
    )
    .map(({ category }) => ({ slug: category.slug, name: category.name }));
}

export function toAdminContactListItem(row: AdminContactListRow): AdminContactListItem {
  return {
    ...toContactSummary(row),
    organization: row.organization,
    interests: interestsOf(row),
    requestsCount: row._count.requests,
    newsletterStatus: row.subscriber?.status ?? null,
    source: row.source,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Colonnes de la fiche (schéma `AdminContact`). */
export const ADMIN_CONTACT_SELECT = {
  ...ADMIN_CONTACT_LIST_SELECT,
  activity: true,
  preferredChannel: true,
  updatedAt: true,
  subscriber: {
    select: {
      id: true,
      email: true,
      name: true,
      phone: true,
      country: true,
      status: true,
      tags: true,
      source: true,
      confirmedAt: true,
      unsubscribedAt: true,
      createdAt: true,
    },
  },
  requests: {
    where: VISIBLE_REQUESTS,
    select: REQUEST_LIST_SELECT,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  },
  appointments: { select: ADMIN_APPOINTMENT_SELECT, orderBy: [{ startsAt: 'desc' }, { id: 'desc' }] },
} as const satisfies Prisma.ContactSelect;

export interface SubscriberRow {
  id: string;
  email: string;
  name: string | null;
  phone: string | null;
  country: string | null;
  status: SubscriberStatus;
  tags: string[];
  source: SubscriberSource;
  confirmedAt: Date | null;
  unsubscribedAt: Date | null;
  createdAt: Date;
}

export interface AdminContactRow extends Omit<AdminContactListRow, 'subscriber'> {
  activity: string | null;
  preferredChannel: ContactPreference | null;
  updatedAt: Date;
  subscriber: SubscriberRow | null;
  requests: RequestListRow[];
  appointments: AdminAppointmentRow[];
}

/** Schéma `Subscriber` du contrat. */
export interface Subscriber {
  id: string;
  email: string;
  name: string | null;
  phone: string | null;
  country: string | null;
  status: SubscriberStatus;
  tags: string[];
  source: string | null;
  confirmedAt: string | null;
  unsubscribedAt: string | null;
  createdAt: string;
}

export interface AdminContact extends AdminContactListItem {
  activity: string | null;
  preferredChannel: ContactPreference | null;
  requests: RequestListItem[];
  appointments: AdminAppointment[];
  subscriber: Subscriber | null;
  updatedAt: string;
}

const iso = (value: Date | null): string | null => value?.toISOString() ?? null;

export function toSubscriber(row: SubscriberRow): Subscriber {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    phone: row.phone,
    country: row.country,
    status: row.status,
    tags: [...row.tags],
    source: SUBSCRIBER_SOURCES[row.source],
    confirmedAt: iso(row.confirmedAt),
    unsubscribedAt: iso(row.unsubscribedAt),
    createdAt: row.createdAt.toISOString(),
  };
}

export function toAdminContact(row: AdminContactRow, now: Date): AdminContact {
  return {
    ...toAdminContactListItem({
      ...row,
      subscriber: row.subscriber ? { status: row.subscriber.status } : null,
    }),
    activity: row.activity,
    preferredChannel: row.preferredChannel,
    requests: row.requests.map((request) => toRequestListItem(request, now)),
    appointments: row.appointments.map(toAdminAppointment),
    subscriber: row.subscriber ? toSubscriber(row.subscriber) : null,
    updatedAt: row.updatedAt.toISOString(),
  };
}
