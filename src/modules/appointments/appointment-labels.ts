import type { Lang } from '../../common/i18n/lang.js';
import type {
  AppointmentFormat,
  AppointmentReason,
  AppointmentStatus,
} from '../../generated/prisma/client.js';

/** Libellés des rendez-vous (back-office simulé du site, e-mails dans la langue du client). */

export const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatus, string> = {
  A_CONFIRMER: 'À confirmer',
  CONFIRME: 'Confirmé',
  AUTRE_CRENEAU_PROPOSE: 'Autre créneau proposé',
  ANNULE: 'Annulé',
  TERMINE: 'Terminé',
};

const REASON_LABELS: Record<Lang, Record<AppointmentReason, string>> = {
  fr: {
    DEVIS: 'Devis',
    IMMOBILIER: 'Immobilier',
    PARTENARIAT: 'Partenariat',
    RECRUTEMENT: 'Recrutement',
    AUTRE: 'Autre',
  },
  en: {
    DEVIS: 'Quote',
    IMMOBILIER: 'Real estate',
    PARTENARIAT: 'Partnership',
    RECRUTEMENT: 'Recruitment',
    AUTRE: 'Other',
  },
};

const FORMAT_LABELS: Record<Lang, Record<AppointmentFormat, string>> = {
  fr: { AGENCE: 'À l’agence', TELEPHONE: 'Téléphone', VISIO: 'Visio' },
  en: { AGENCE: 'At the agency', TELEPHONE: 'Phone', VISIO: 'Video call' },
};

export function reasonLabel(reason: AppointmentReason, lang: Lang = 'fr'): string {
  return REASON_LABELS[lang][reason];
}

export function formatLabel(format: AppointmentFormat, lang: Lang = 'fr'): string {
  return FORMAT_LABELS[lang][format];
}

const WEEKDAY_NAMES = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'] as const;

/** « Fermé le dimanche » (jour sans plage d'ouverture, 1 = lundi … 7 = dimanche). */
export function closedWeekdayLabel(weekday: number): string {
  return `Fermé le ${WEEKDAY_NAMES[weekday - 1] ?? 'jour'}`;
}
