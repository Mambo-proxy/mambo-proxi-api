import type { ContactProfile } from '../../generated/prisma/client.js';
import { userInitials } from '../auth/user-identity.js';

/** Colonnes du résumé d'un contact (schéma `ContactSummary` du contrat : demandes, rendez-vous, liste des contacts). */
export const CONTACT_SUMMARY_SELECT = {
  id: true,
  fullName: true,
  email: true,
  phone: true,
  country: true,
  city: true,
  profile: true,
} as const;

export interface ContactSummaryRow {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  country: string | null;
  city: string | null;
  profile: ContactProfile;
}

export interface ContactSummary {
  id: string;
  fullName: string;
  initials: string;
  email: string;
  phone: string | null;
  country: string | null;
  city: string | null;
  profile: ContactProfile;
}

export function toContactSummary(row: ContactSummaryRow): ContactSummary {
  return {
    id: row.id,
    fullName: row.fullName,
    initials: userInitials(row.fullName),
    email: row.email,
    phone: row.phone,
    country: row.country,
    city: row.city,
    profile: row.profile,
  };
}
