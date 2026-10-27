/**
 * Rendez-vous et disponibilités pour le double de Prisma, sur le modèle des données simulées du site
 * (`mambo-proxi-web/src/mocks/data/admin-appointments.ts`) et des exemples du contrat. Les dates sont relatives au
 * lancement des tests : `D`, `E` et `F` sont trois jours ouvrés (hors dimanche) consécutifs, à partir de J+3 (au-delà
 * du délai minimal de 24 h).
 *
 * Plages : du lundi au samedi, 09:00–12:00 par créneaux d'une heure (trois formats) et 14:00–15:00 (téléphone
 * seulement) ; fermeture exceptionnelle le jour `F`. Occupation :
 * - jour `D` : 09:00 confirmé (Ruth, assigné à Paul), 10:00 annulé (libre), 11:00 créneau proposé à Samuel ;
 * - jour `E` : 09:00 créneau d'origine de Samuel (libéré par la proposition), 10:00 à confirmer (Aminata).
 */
import {
  addDays,
  doualaDate,
  doualaInstant,
  isoWeekday,
  type DateKey,
} from '../../src/common/time/agency-day.js';
import { contactSearchKeys } from '../../src/modules/contacts/contact.mapper.js';
import { formatReference, referenceYear } from '../../src/modules/requests/reference.js';
import { ACCOUNTS, authTables } from '../support/auth.js';
import type { PrismaTables } from '../support/prisma-double.js';

type Row = Record<string, unknown>;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Jeton en clair du lien d'acceptation de la proposition faite à Samuel (son condensat est posé par le test). */
export const PROPOSAL_TOKEN = 'jeton-de-proposition-samuel-0123456789abcdef';

export interface AppointmentClock {
  now: number;
  D: DateKey;
  E: DateKey;
  F: DateKey;
  /** Instant d'une heure de Douala d'un jour (`at(D, 9)` = 09:00 à Douala). */
  at: (day: DateKey, hour: number, minute?: number) => Date;
  ref: (number: number) => string;
}

function nextOpenDay(day: DateKey): DateKey {
  let next = day;
  while (isoWeekday(next) === 7) next = addDays(next, 1);
  return next;
}

export function appointmentClock(): AppointmentClock {
  const now = Date.now();
  const D = nextOpenDay(addDays(doualaDate(new Date(now)), 3));
  const E = nextOpenDay(addDays(D, 1));
  const F = nextOpenDay(addDays(E, 1));
  const year = referenceYear(new Date(now));
  return {
    now,
    D,
    E,
    F,
    at: (day, hour, minute = 0) => doualaInstant(day, hour * 60 + minute),
    ref: (number) => formatReference(year, number),
  };
}

function contact(fields: Row & { id: string; fullName: string; email: string }): Row {
  return {
    firstName: String(fields.fullName).split(' ')[0],
    lastName: null,
    phone: null,
    country: null,
    city: null,
    district: null,
    profile: 'PARTICULIER',
    organization: null,
    activity: null,
    preferredChannel: null,
    source: 'rendez-vous',
    language: 'FR',
    anonymizedAt: null,
    isDemo: false,
    createdAt: new Date('2026-09-01T10:00:00.000Z'),
    updatedAt: new Date('2026-09-01T10:00:00.000Z'),
    lastActivityAt: new Date('2026-09-01T10:00:00.000Z'),
    ...fields,
    ...contactSearchKeys({
      fullName: fields.fullName,
      email: fields.email,
      city: (fields['city'] as string | null | undefined) ?? null,
    }),
  };
}

function appointment(
  fields: Row & { id: string; number: number; contactId: string; startsAt: Date; status: string },
  clock: AppointmentClock,
): Row {
  const { number, ...rest } = fields;
  return {
    reference: clock.ref(number),
    requestId: null,
    reason: 'DEVIS',
    format: 'VISIO',
    endsAt: new Date(fields.startsAt.getTime() + HOUR),
    proposedStartsAt: null,
    proposalTokenHash: null,
    proposalExpiresAt: null,
    location: null,
    videoLink: null,
    message: null,
    notes: null,
    language: 'FR',
    assignedToId: null,
    createdById: null,
    confirmedAt: null,
    cancelledAt: null,
    completedAt: null,
    reminderSentAt: null,
    isDemo: false,
    createdAt: new Date(clock.now - 5 * DAY),
    updatedAt: new Date(clock.now - 5 * DAY),
    ...rest,
  };
}

const ALL_FORMATS = ['AGENCE', 'TELEPHONE', 'VISIO'];

/** Tables du double : comptes de `authTables`, contacts, rendez-vous, disponibilités et paramètres. */
export function appointmentTables(passwordHash: string, clock: AppointmentClock): PrismaTables {
  const base = authTables(passwordHash);
  const { D, E, F, at } = clock;
  return {
    ...base,
    setting: [
      ...base.setting,
      {
        key: 'availability',
        value: {
          minNoticeHours: 24,
          maxAdvanceDays: 60,
          agencyAddress: 'Agence Douala, Bonapriso',
          defaultVideoLink: 'https://meet.mamboproxi.com/agence',
        },
        translations: null,
        updatedAt: new Date('2026-09-01T10:00:00.000Z'),
      },
      {
        key: 'emails',
        value: {
          teamRecipients: ['equipe.douala@mamboproxi.com'],
          senderName: 'MAMBO Proxi',
          replyTo: 'contact@mamboproxi.com',
          surveyDelayHours: 24,
          surveyReminderDays: 3,
          appointmentReminderHour: 9,
        },
        translations: null,
        updatedAt: new Date('2026-09-01T10:00:00.000Z'),
      },
    ],
    request: [],
    requestNote: [],
    contact: [
      contact({
        id: 'ctc_ruth',
        fullName: 'Ruth Abena',
        email: 'ruth.a@example.com',
        phone: '+32470000000',
        country: 'BE',
        city: 'Bruxelles',
        language: 'EN',
      }),
      contact({
        id: 'ctc_samuel',
        fullName: 'Samuel Eto Mbarga',
        email: 'samuel.em@example.com',
        phone: '+33612345678',
        country: 'FR',
        city: 'Lyon',
      }),
      contact({
        id: 'ctc_brigitte',
        fullName: 'Brigitte Nana',
        email: 'brigitte.nana@example.com',
        phone: '+237655443322',
        country: 'CM',
        city: 'Makèpè, Douala',
      }),
      contact({
        id: 'ctc_aminata',
        fullName: 'Aminata Diallo',
        email: 'aminata.diallo@example.com',
        phone: '+237600000000',
        country: 'CM',
        city: 'Douala',
      }),
    ],
    appointment: [
      appointment(
        {
          id: 'apt_confirmed',
          number: 139,
          contactId: 'ctc_ruth',
          reason: 'IMMOBILIER',
          startsAt: at(D, 9),
          status: 'CONFIRME',
          videoLink: 'https://meet.example.com/mambo-ruth',
          assignedToId: ACCOUNTS.agent.id,
          confirmedAt: new Date(clock.now - 4 * DAY),
          language: 'EN',
        },
        clock,
      ),
      appointment(
        {
          id: 'apt_cancelled',
          number: 140,
          contactId: 'ctc_brigitte',
          format: 'AGENCE',
          startsAt: at(D, 10),
          status: 'ANNULE',
          cancelledAt: new Date(clock.now - 2 * DAY),
        },
        clock,
      ),
      appointment(
        {
          id: 'apt_proposed',
          number: 141,
          contactId: 'ctc_samuel',
          reason: 'PARTENARIAT',
          format: 'AGENCE',
          startsAt: at(E, 9),
          proposedStartsAt: at(D, 11),
          proposalExpiresAt: new Date(clock.now + 2 * DAY),
          status: 'AUTRE_CRENEAU_PROPOSE',
          location: 'Agence Douala, Bonapriso',
          assignedToId: ACCOUNTS.manager.id,
        },
        clock,
      ),
      appointment(
        {
          id: 'apt_pending',
          number: 143,
          contactId: 'ctc_aminata',
          format: 'AGENCE',
          startsAt: at(E, 10),
          status: 'A_CONFIRMER',
          message: 'Je souhaite parler d’un dîner pour 12 personnes en décembre.',
        },
        clock,
      ),
      appointment(
        {
          id: 'apt_done',
          number: 120,
          contactId: 'ctc_ruth',
          format: 'TELEPHONE',
          startsAt: new Date(clock.now - 2 * DAY),
          status: 'TERMINE',
          assignedToId: ACCOUNTS.agent.id,
          completedAt: new Date(clock.now - 2 * DAY + HOUR),
        },
        clock,
      ),
    ],
    availabilityRule: [1, 2, 3, 4, 5, 6].flatMap((weekday) => [
      {
        id: `rul_${String(weekday)}_am`,
        weekday,
        startTime: '09:00',
        endTime: '12:00',
        slotMinutes: 60,
        formats: [...ALL_FORMATS],
      },
      {
        id: `rul_${String(weekday)}_pm`,
        weekday,
        startTime: '14:00',
        endTime: '15:00',
        slotMinutes: 60,
        formats: ['TELEPHONE'],
      },
    ]),
    availabilityException: [
      {
        id: 'exc_fete',
        date: new Date(`${F}T00:00:00.000Z`),
        closed: true,
        startTime: null,
        endTime: null,
        label: 'Fête nationale',
      },
    ],
  };
}

/** Tables remises à zéro entre les tests (les sessions et les comptes restent : connexions faites une fois). */
const RESET_TABLES = [
  'setting',
  'contact',
  'request',
  'requestEvent',
  'notification',
  'referenceCounter',
  'appointment',
  'availabilityRule',
  'availabilityException',
  'auditLog',
] as const satisfies readonly (keyof PrismaTables)[];

/** Remet les tables des rendez-vous dans leur état initial (même objet, lu par le double à chaque requête). */
export function resetAppointments(tables: PrismaTables, fresh: PrismaTables): void {
  const target = tables as unknown as Record<string, Row[]>;
  for (const name of RESET_TABLES) target[name] = structuredClone(fresh[name] ?? []);
}
