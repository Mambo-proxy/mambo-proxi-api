import type {
  AppointmentFormat,
  AppointmentReason,
  AppointmentStatus,
} from '../../generated/prisma/client.js';
import {
  CONTACT_SUMMARY_SELECT,
  toContactSummary,
  type ContactSummary,
  type ContactSummaryRow,
} from '../contacts/contact-summary.js';
import { toUserRef, type UserRef } from '../users/user-ref.js';

/**
 * Rendez-vous affiché dans le back-office (schéma `AdminAppointment` du contrat) : « Mes tâches » et fiche contact.
 * Le module des rendez-vous (lot suivant) reprendra ce format.
 */
export const ADMIN_APPOINTMENT_SELECT = {
  id: true,
  reference: true,
  reason: true,
  format: true,
  startsAt: true,
  endsAt: true,
  status: true,
  proposedStartsAt: true,
  location: true,
  videoLink: true,
  message: true,
  notes: true,
  reminderSentAt: true,
  createdAt: true,
  contact: { select: CONTACT_SUMMARY_SELECT },
  assignedTo: { select: { id: true, name: true } },
} as const;

export interface AdminAppointmentRow {
  id: string;
  reference: string;
  reason: AppointmentReason;
  format: AppointmentFormat;
  startsAt: Date;
  endsAt: Date;
  status: AppointmentStatus;
  proposedStartsAt: Date | null;
  location: string | null;
  videoLink: string | null;
  message: string | null;
  notes: string | null;
  reminderSentAt: Date | null;
  createdAt: Date;
  contact: ContactSummaryRow;
  assignedTo: { id: string; name: string } | null;
}

export interface AdminAppointment {
  id: string;
  reference: string;
  contact: ContactSummary;
  reason: AppointmentReason;
  format: AppointmentFormat;
  startsAt: string;
  endsAt: string;
  status: AppointmentStatus;
  proposedStartsAt: string | null;
  location: string | null;
  videoLink: string | null;
  message: string | null;
  notes: string | null;
  reminderSentAt: string | null;
  assignedTo: UserRef | null;
  createdAt: string;
}

const iso = (value: Date | null): string | null => value?.toISOString() ?? null;

export function toAdminAppointment(row: AdminAppointmentRow): AdminAppointment {
  return {
    id: row.id,
    reference: row.reference,
    contact: toContactSummary(row.contact),
    reason: row.reason,
    format: row.format,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    status: row.status,
    proposedStartsAt: iso(row.proposedStartsAt),
    location: row.location,
    videoLink: row.videoLink,
    message: row.message,
    notes: row.notes,
    reminderSentAt: iso(row.reminderSentAt),
    assignedTo: row.assignedTo ? toUserRef(row.assignedTo) : null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Début effectif : le créneau proposé s'il y en a un (« Autre créneau proposé »), sinon le créneau demandé. */
export function effectiveStart(row: { startsAt: Date; proposedStartsAt: Date | null }): Date {
  return row.proposedStartsAt ?? row.startsAt;
}
