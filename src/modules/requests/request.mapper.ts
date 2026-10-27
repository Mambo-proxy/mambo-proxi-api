import type {
  ContactPreference,
  Prisma,
  RequestEventKind,
  RequestStatus,
  RequestType,
  SurveyStatus,
} from '../../generated/prisma/client.js';
import {
  CONTACT_SUMMARY_SELECT,
  toContactSummary,
  type ContactSummary,
  type ContactSummaryRow,
} from '../contacts/contact-summary.js';
import { splitFullName } from '../contacts/contact.mapper.js';
import { USER_REF_SELECT, toUserRef, type UserRef } from '../users/user-ref.js';
import type { RequestField } from './requests.service.js';

/** Libellés des statuts (description de `RequestStatus` dans le contrat). */
export const REQUEST_STATUS_LABELS: Record<RequestStatus, string> = {
  NOUVELLE: 'Nouvelle',
  EN_COURS: 'En cours',
  PRESTATION_REALISEE: 'Prestation réalisée',
  CLOTUREE: 'Clôturée',
};

/** Libellés des types (description de `RequestType` dans le contrat). */
export const REQUEST_TYPE_LABELS: Record<RequestType, string> = {
  DEVIS: 'Devis',
  CONTACT: 'Contact',
  INFORMATION: 'Information',
  INSCRIPTION: 'Inscription',
  FORMATION: 'Formation',
  CANDIDATURE: 'Candidature',
  PARTENARIAT: 'Partenariat',
  EVENEMENT: 'Événement',
  RENDEZ_VOUS: 'Rendez-vous',
};

/** Ordre du traitement : un retour vers un statut antérieur demande `requests:revert-status`. */
export const REQUEST_STATUS_ORDER: readonly RequestStatus[] = [
  'NOUVELLE',
  'EN_COURS',
  'PRESTATION_REALISEE',
  'CLOTUREE',
];

/** Demandes encore ouvertes : seules celles-ci peuvent être en retard. */
export const OPEN_REQUEST_STATUSES = ['NOUVELLE', 'EN_COURS'] as const satisfies readonly RequestStatus[];

export function isOpenStatus(status: RequestStatus): boolean {
  return (OPEN_REQUEST_STATUSES as readonly RequestStatus[]).includes(status);
}

/** Échéance dépassée alors que la demande est encore ouverte (`RequestListItem.isOverdue`). */
export function isOverdue(row: { status: RequestStatus; dueAt: Date | null }, now: Date): boolean {
  return isOpenStatus(row.status) && row.dueAt !== null && row.dueAt.getTime() < now.getTime();
}

/** Colonnes d'une ligne de la liste (schéma `RequestListItem`). */
export const REQUEST_LIST_SELECT = {
  id: true,
  reference: true,
  type: true,
  status: true,
  subject: true,
  dueAt: true,
  createdAt: true,
  contact: { select: CONTACT_SUMMARY_SELECT },
  service: { select: { id: true, name: true, slug: true } },
  category: { select: { slug: true, name: true } },
  assignedTo: { select: USER_REF_SELECT },
} as const satisfies Prisma.RequestSelect;

export interface RequestListRow {
  id: string;
  reference: string;
  type: RequestType;
  status: RequestStatus;
  subject: string | null;
  dueAt: Date | null;
  createdAt: Date;
  contact: ContactSummaryRow;
  service: { id: string; name: string; slug: string } | null;
  category: { slug: string; name: string } | null;
  assignedTo: { id: string; name: string } | null;
}

export interface RequestListItem {
  id: string;
  reference: string;
  type: RequestType;
  status: RequestStatus;
  contact: ContactSummary;
  service: { id: string; name: string; slug: string } | null;
  category: { slug: string; name: string } | null;
  subject: string | null;
  assignedTo: UserRef | null;
  dueAt: string | null;
  isOverdue: boolean;
  createdAt: string;
}

const iso = (value: Date | null): string | null => value?.toISOString() ?? null;

export function toRequestListItem(row: RequestListRow, now: Date): RequestListItem {
  return {
    id: row.id,
    reference: row.reference,
    type: row.type,
    status: row.status,
    contact: toContactSummary(row.contact),
    service: row.service ? { id: row.service.id, name: row.service.name, slug: row.service.slug } : null,
    category: row.category ? { slug: row.category.slug, name: row.category.name } : null,
    subject: row.subject,
    assignedTo: row.assignedTo ? toUserRef(row.assignedTo) : null,
    dueAt: iso(row.dueAt),
    isOverdue: isOverdue(row, now),
    createdAt: row.createdAt.toISOString(),
  };
}

/** « Le plus urgent d'abord » : en retard, puis par échéance (sans échéance en dernier), puis le plus ancien. */
export function compareByUrgency(
  a: { status: RequestStatus; dueAt: Date | null; createdAt: Date },
  b: { status: RequestStatus; dueAt: Date | null; createdAt: Date },
  now: Date,
): number {
  const due = (row: { dueAt: Date | null }): number => row.dueAt?.getTime() ?? Number.POSITIVE_INFINITY;
  return (
    Number(isOverdue(b, now)) - Number(isOverdue(a, now)) ||
    (due(a) === due(b) ? 0 : due(a) < due(b) ? -1 : 1) ||
    a.createdAt.getTime() - b.createdAt.getTime()
  );
}

/** Colonnes du détail (schéma `RequestDetail`). */
export const REQUEST_DETAIL_SELECT = {
  ...REQUEST_LIST_SELECT,
  contact: { select: { ...CONTACT_SUMMARY_SELECT, firstName: true } },
  contactPreference: true,
  message: true,
  payload: true,
  consentAt: true,
  completedAt: true,
  closedAt: true,
  updatedAt: true,
  notes: {
    select: { id: true, body: true, createdAt: true, author: { select: USER_REF_SELECT } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  },
  history: {
    select: { id: true, kind: true, data: true, createdAt: true, actor: { select: USER_REF_SELECT } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  },
  attachments: {
    select: { id: true, fileName: true, mimeType: true, size: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  },
  survey: { select: { status: true, scheduledFor: true, sentAt: true, completedAt: true, rating: true } },
} as const satisfies Prisma.RequestSelect;

export interface RequestDetailRow extends Omit<RequestListRow, 'contact'> {
  contact: ContactSummaryRow & { firstName: string | null };
  contactPreference: ContactPreference | null;
  message: string | null;
  payload: Prisma.JsonValue;
  consentAt: Date;
  completedAt: Date | null;
  closedAt: Date | null;
  updatedAt: Date;
  notes: { id: string; body: string; createdAt: Date; author: { id: string; name: string } }[];
  history: {
    id: string;
    kind: RequestEventKind;
    data: Prisma.JsonValue;
    createdAt: Date;
    actor: { id: string; name: string } | null;
  }[];
  attachments: { id: string; fileName: string; mimeType: string; size: number }[];
  survey: {
    status: SurveyStatus;
    scheduledFor: Date | null;
    sentAt: Date | null;
    completedAt: Date | null;
    rating: number | null;
  } | null;
}

/** Schéma `RequestNote` du contrat. */
export interface RequestNote {
  id: string;
  body: string;
  author: UserRef;
  createdAt: string;
}

export function toRequestNote(row: {
  id: string;
  body: string;
  createdAt: Date;
  author: { id: string; name: string };
}): RequestNote {
  return {
    id: row.id,
    body: row.body,
    author: toUserRef(row.author),
    createdAt: row.createdAt.toISOString(),
  };
}

/** Schéma `RequestEvent` du contrat. */
export interface RequestEvent {
  id: string;
  kind: RequestEventKind;
  label: string;
  actor: UserRef | null;
  data: Record<string, unknown> | null;
  createdAt: string;
}

export interface RequestDetail extends RequestListItem {
  contactPreference: ContactPreference | null;
  message: string | null;
  fields: RequestField[];
  payload: Record<string, unknown>;
  notes: RequestNote[];
  history: RequestEvent[];
  attachments: { id: string; fileName: string; mimeType: string; size: number }[];
  consentAt: string;
  survey: {
    status: SurveyStatus;
    scheduledFor: string | null;
    sentAt: string | null;
    completedAt: string | null;
    rating: number | null;
  } | null;
  whatsappUrl: string | null;
  completedAt: string | null;
  closedAt: string | null;
  updatedAt: string;
}

function asObject(value: Prisma.JsonValue | undefined): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : null;
}

function readString(data: Record<string, unknown> | null, key: string): string | null {
  const value = data?.[key];
  return typeof value === 'string' && value !== '' ? value : null;
}

function statusLabel(value: string | null): string | null {
  return value !== null && value in REQUEST_STATUS_LABELS
    ? REQUEST_STATUS_LABELS[value as RequestStatus]
    : null;
}

/** Noms des membres de l'équipe cités dans l'historique (assignations), par identifiant. */
export type TeamNames = ReadonlyMap<string, string>;

/** Identifiants des personnes assignées citées dans l'historique (noms à charger pour les libellés). */
export function assigneeIdsOf(
  history: readonly { kind: RequestEventKind; data: Prisma.JsonValue }[],
): string[] {
  const ids = history
    .filter((event) => event.kind === 'ASSIGNED')
    .map((event) => readString(asObject(event.data), 'assignedToId'))
    .filter((id): id is string => id !== null);
  return [...new Set(ids)];
}

/** Libellé prêt à afficher d'un événement de l'historique, calculé à partir de `kind` et `data`. */
export function eventLabel(kind: RequestEventKind, rawData: Prisma.JsonValue, names: TeamNames): string {
  const data = asObject(rawData);
  switch (kind) {
    case 'RECEIVED':
      return 'Demande reçue via le formulaire';
    case 'ACK_SENT':
      return 'Accusé de réception envoyé au client';
    case 'TEAM_ALERT_SENT':
      return 'Alerte « nouvelle demande » envoyée à l’équipe';
    case 'STATUS_CHANGED': {
      const from = statusLabel(readString(data, 'from'));
      const to = statusLabel(readString(data, 'to'));
      return from && to ? `Statut : ${from} → ${to}` : to ? `Statut : ${to}` : 'Statut modifié';
    }
    case 'ASSIGNED': {
      const id = readString(data, 'assignedToId');
      if (id === null) return 'Assignation retirée';
      const name = names.get(id) ?? readString(data, 'assignedToName');
      return name ? `Assignée à ${name}` : 'Demande assignée';
    }
    case 'NOTE_ADDED':
      return 'Note interne ajoutée';
    case 'SURVEY_SCHEDULED': {
      const hours = data?.['delayHours'];
      return typeof hours === 'number'
        ? `Questionnaire de satisfaction programmé (dans ${String(hours)} h)`
        : 'Questionnaire de satisfaction programmé';
    }
    case 'SURVEY_SENT':
      return 'Questionnaire de satisfaction envoyé au client';
    case 'SURVEY_REMINDED':
      return 'Relance du questionnaire envoyée au client';
    case 'SURVEY_ANSWERED':
      return 'Questionnaire de satisfaction rempli par le client';
    case 'EMAIL_SENT':
      return readString(data, 'template') === 'team-assignment'
        ? 'E-mail d’assignation envoyé'
        : 'E-mail envoyé';
    case 'ANONYMIZED':
      return 'Demande anonymisée (RGPD)';
    case 'DUPLICATED': {
      const from = readString(data, 'fromReference');
      return from ? `Copie de la demande ${from}` : 'Demande dupliquée';
    }
  }
}

function isRequestField(value: unknown): value is RequestField {
  if (typeof value !== 'object' || value === null) return false;
  const field = value as Record<string, unknown>;
  return typeof field['label'] === 'string' && typeof field['value'] === 'string';
}

/** Champs affichés (`payload.fields`, enregistrés à la réception avec leurs libellés). */
export function requestFields(payload: Prisma.JsonValue): RequestField[] {
  const fields = asObject(payload)?.['fields'];
  if (!Array.isArray(fields)) return [];
  return fields.filter(isRequestField).map((field) => ({
    key: typeof field.key === 'string' ? field.key : '',
    label: field.label,
    value: field.value,
  }));
}

/** Valeurs propres au formulaire, sans les champs mis en forme (`fields`, renvoyés à part). */
export function requestPayload(payload: Prisma.JsonValue): Record<string, unknown> {
  const { fields: _fields, ...rest } = asObject(payload) ?? {};
  void _fields;
  return rest;
}

/**
 * Lien WhatsApp vers le client, message pré-rempli avec la référence (exemple du contrat) ; `null` sans téléphone.
 * L'apostrophe est encodée (`%27`) comme dans l'exemple.
 */
export function requestWhatsappUrl(
  contact: { phone: string | null; fullName: string; firstName: string | null },
  reference: string,
): string | null {
  const digits = contact.phone?.replace(/\D/g, '') ?? '';
  if (digits === '') return null;
  const firstName = contact.firstName?.trim() || splitFullName(contact.fullName).firstName;
  const text = `Bonjour ${firstName}, c'est Mambo Proxi au sujet de votre demande ${reference}.`;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text).replace(/'/g, '%27')}`;
}

export function toRequestDetail(row: RequestDetailRow, now: Date, names: TeamNames): RequestDetail {
  return {
    ...toRequestListItem(row, now),
    contactPreference: row.contactPreference,
    message: row.message,
    fields: requestFields(row.payload),
    payload: requestPayload(row.payload),
    notes: row.notes.map(toRequestNote),
    history: row.history.map((event) => ({
      id: event.id,
      kind: event.kind,
      label: eventLabel(event.kind, event.data, names),
      actor: event.actor ? toUserRef(event.actor) : null,
      data: asObject(event.data),
      createdAt: event.createdAt.toISOString(),
    })),
    attachments: row.attachments.map((attachment) => ({
      id: attachment.id,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      size: attachment.size,
    })),
    consentAt: row.consentAt.toISOString(),
    survey: row.survey
      ? {
          status: row.survey.status,
          scheduledFor: iso(row.survey.scheduledFor),
          sentAt: iso(row.survey.sentAt),
          completedAt: iso(row.survey.completedAt),
          rating: row.survey.rating,
        }
      : null,
    whatsappUrl: requestWhatsappUrl(row.contact, row.reference),
    completedAt: iso(row.completedAt),
    closedAt: iso(row.closedAt),
    updatedAt: row.updatedAt.toISOString(),
  };
}
