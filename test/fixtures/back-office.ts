/**
 * Données du back-office pour le double de Prisma (demandes, contacts, rendez-vous), sur le modèle des données
 * simulées du site (`mambo-proxi-web/src/mocks/data/admin-requests.ts`, `admin-contacts.ts`) et des exemples du
 * contrat. Les dates sont relatives au lancement des tests ; les clés de recherche sont calculées comme par l'API.
 *
 * Paul Ngando (chargé de clientèle) suit une demande en retard (MP-2026-0151), une demande à traiter aujourd'hui
 * (MP-2026-0156) et une demande clôturée (MP-2026-0120) ; Aurélie Kamga (MP-2026-0142) reste à assigner ; une demande
 * anonymisée (MP-2026-0090) ne doit apparaître nulle part.
 */
import { doualaDay } from '../../src/common/time/agency-day.js';
import { contactSearchKeys } from '../../src/modules/contacts/contact.mapper.js';
import { referenceYear } from '../../src/modules/requests/reference.js';
import { requestSearchText } from '../../src/modules/requests/request-search.js';
import { ACCOUNTS, authTables } from '../support/auth.js';
import type { PrismaTables } from '../support/prisma-double.js';

type Row = Record<string, unknown>;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Formule injectée dans un formulaire public (neutralisée dans l'export CSV). */
export const FORMULA_SUBJECT = '=HYPERLINK("https://exemple.invalid","Cliquez")';

export interface BackOfficeClock {
  now: number;
  at: (offsetMs: number) => Date;
  /** Échéance dans la journée de Douala, après l'instant présent (« à traiter aujourd'hui »). */
  laterToday: Date;
}

export function backOfficeClock(): BackOfficeClock {
  const now = Date.now();
  const { end } = doualaDay(new Date(now));
  return {
    now,
    at: (offsetMs) => new Date(now + offsetMs),
    laterToday: new Date(now + Math.floor((end.getTime() - now) / 2)),
  };
}

function contact(
  fields: Row & { fullName: string; email: string },
  clock: BackOfficeClock,
  age: number,
): Row {
  const row: Row = {
    firstName: null,
    lastName: null,
    phone: null,
    country: null,
    city: null,
    district: null,
    profile: 'PARTICULIER',
    organization: null,
    activity: null,
    preferredChannel: null,
    source: 'devis',
    language: 'FR',
    anonymizedAt: null,
    isDemo: false,
    createdAt: clock.at(-age),
    updatedAt: clock.at(-age),
    lastActivityAt: clock.at(-age),
    ...fields,
  };
  return {
    ...row,
    ...contactSearchKeys({
      fullName: fields.fullName,
      email: fields.email,
      organization: row['organization'] as string | null,
      city: row['city'] as string | null,
    }),
  };
}

function request(
  fields: Row & { id: string; number: number; contactId: string; subject: string | null },
  clock: BackOfficeClock,
  age: number,
): Row {
  const reference = `MP-${String(referenceYear(new Date(clock.now)))}-${String(fields.number).padStart(4, '0')}`;
  const { number: _number, ...rest } = fields;
  void _number;
  return {
    reference,
    type: 'DEVIS',
    status: 'NOUVELLE',
    categoryId: 'cat_experience',
    serviceId: 'svc_chef_prive',
    jobOfferId: null,
    trainingId: null,
    otherTraining: null,
    eventId: null,
    seats: null,
    participants: null,
    period: null,
    organization: null,
    partnershipType: null,
    contactPreference: 'EMAIL',
    payload: {},
    message: null,
    language: 'FR',
    consentAt: clock.at(-age),
    ip: '203.0.113.7',
    userAgent: 'Mozilla/5.0',
    assignedToId: null,
    assignedAt: null,
    dueAt: clock.at(-age + DAY),
    completedAt: null,
    closedAt: null,
    anonymizedAt: null,
    duplicatedFromId: null,
    isDemo: false,
    createdAt: clock.at(-age),
    updatedAt: clock.at(-age),
    searchText: requestSearchText(reference, fields.subject),
    ...rest,
  };
}

function event(id: string, requestId: string, kind: string, createdAt: Date, extra: Row = {}): Row {
  return { id, requestId, kind, data: null, actorId: null, createdAt, ...extra };
}

/** Tables du double : comptes de `authTables`, rubriques, contacts, demandes, rendez-vous et paramètre `emails`. */
export function backOfficeTables(passwordHash: string, clock: BackOfficeClock): PrismaTables {
  const base = authTables(passwordHash);
  const year = referenceYear(new Date(clock.now));
  return {
    ...base,
    setting: [
      ...base.setting,
      { key: 'emails', value: { teamRecipients: [], surveyDelayHours: 48 }, translations: null },
    ],
    category: [
      { id: 'cat_immobilier', slug: 'immobilier', name: 'Immobilier', sortOrder: 2, status: 'PUBLISHED' },
      { id: 'cat_experience', slug: 'experience', name: 'Expérience', sortOrder: 3, status: 'PUBLISHED' },
    ],
    service: [{ id: 'svc_chef_prive', slug: 'chef-prive', name: 'Chef privé', categoryId: 'cat_experience' }],
    contact: [
      contact(
        {
          id: 'ctc_aurelie',
          fullName: 'Aurélie Kamga',
          firstName: 'Aurélie',
          lastName: 'Kamga',
          email: 'aurelie.k@example.com',
          phone: '+237612345678',
          country: 'CM',
          city: 'Bonapriso, Douala',
          district: 'Bonapriso',
          preferredChannel: 'WHATSAPP',
        },
        clock,
        2 * DAY,
      ),
      contact(
        {
          id: 'ctc_saveurs',
          fullName: 'Saveurs de Douala',
          email: 'contact@saveurs-douala.example.com',
          phone: '+237655443322',
          country: 'CM',
          city: 'Akwa, Douala',
          district: 'Akwa',
          profile: 'PROFESSIONNEL',
          organization: 'Saveurs de Douala',
          activity: 'Traiteur',
          source: 'inscription',
        },
        clock,
        5 * DAY,
      ),
      contact(
        {
          id: 'ctc_grace',
          fullName: 'Grâce Abena',
          email: 'grace.abena@example.com',
          phone: '+237699000000',
          country: 'CM',
          city: 'Kribi',
          source: 'contact',
        },
        clock,
        10 * DAY,
      ),
      contact(
        {
          id: 'ctc_herve',
          fullName: 'Hervé Tchoumi',
          email: 'herve.tchoumi@example.com',
          phone: '+237699887766',
          country: 'CM',
          city: 'Makèpè, Douala',
          district: 'Makèpè',
        },
        clock,
        40 * DAY,
      ),
      contact(
        {
          id: 'ctc_samuel',
          fullName: 'Samuel Eto Mbarga',
          email: 'samuel.em@example.com',
          phone: '+33612345678',
          country: 'FR',
          city: 'Lyon',
          source: 'newsletter',
        },
        clock,
        60 * DAY,
      ),
    ],
    contactInterest: [
      { contactId: 'ctc_aurelie', categoryId: 'cat_experience' },
      { contactId: 'ctc_saveurs', categoryId: 'cat_experience' },
      { contactId: 'ctc_saveurs', categoryId: 'cat_immobilier' },
    ],
    subscriber: [
      {
        id: 'sub_aurelie',
        email: 'aurelie.k@example.com',
        name: 'Aurélie Kamga',
        phone: '+237612345678',
        country: 'CM',
        contactId: 'ctc_aurelie',
        status: 'CONFIRME',
        language: 'FR',
        source: 'FOOTER',
        tags: ['experience'],
        consentAt: clock.at(-2 * DAY),
        confirmTokenHash: null,
        confirmTokenExpires: null,
        confirmedAt: clock.at(-2 * DAY),
        unsubscribedAt: null,
        createdAt: clock.at(-2 * DAY),
        updatedAt: clock.at(-2 * DAY),
      },
      {
        id: 'sub_samuel',
        email: 'samuel.em@example.com',
        name: 'Samuel Eto Mbarga',
        phone: null,
        country: 'FR',
        contactId: 'ctc_samuel',
        status: 'EN_ATTENTE',
        language: 'FR',
        source: 'SUIVI_MAMBO',
        tags: [],
        consentAt: clock.at(-60 * DAY),
        confirmTokenHash: null,
        confirmTokenExpires: null,
        confirmedAt: null,
        unsubscribedAt: null,
        createdAt: clock.at(-60 * DAY),
        updatedAt: clock.at(-60 * DAY),
      },
    ],
    referenceCounter: [{ year, lastValue: 161, updatedAt: clock.at(-DAY) }],
    request: [
      request(
        {
          id: 'req_0142',
          number: 142,
          contactId: 'ctc_aurelie',
          subject: 'Chef privé',
          contactPreference: 'WHATSAPP',
          message: 'Dîner pour les 60 ans de ma mère, cuisine camerounaise revisitée.',
          payload: {
            categorySlug: 'experience',
            serviceSlug: 'chef-prive',
            needs: { guests: 12, occasion: 'Anniversaire' },
            fields: [
              { key: 'rubrique', label: 'Rubrique', value: 'Expérience' },
              { key: 'guests', label: 'Personnes', value: '12' },
            ],
          },
        },
        clock,
        2 * HOUR,
      ),
      request(
        {
          id: 'req_0151',
          number: 151,
          contactId: 'ctc_herve',
          subject: 'Chef privé',
          status: 'EN_COURS',
          assignedToId: ACCOUNTS.agent.id,
          assignedAt: clock.at(-2 * DAY),
          dueAt: clock.at(-20 * HOUR),
        },
        clock,
        3 * DAY,
      ),
      request(
        {
          id: 'req_0156',
          number: 156,
          type: 'CONTACT',
          contactId: 'ctc_saveurs',
          categoryId: null,
          serviceId: null,
          subject: FORMULA_SUBJECT,
          message: 'Pouvez-vous nous rappeler ?',
          assignedToId: ACCOUNTS.agent.id,
          dueAt: clock.laterToday,
        },
        clock,
        20 * HOUR,
      ),
      request(
        {
          id: 'req_0157',
          number: 157,
          contactId: 'ctc_samuel',
          subject: 'Chef privé',
          status: 'EN_COURS',
          assignedToId: ACCOUNTS.editor.id,
          dueAt: clock.at(3 * DAY),
        },
        clock,
        5 * DAY,
      ),
      request(
        {
          id: 'req_0120',
          number: 120,
          contactId: 'ctc_aurelie',
          subject: 'Chef privé',
          status: 'CLOTUREE',
          assignedToId: ACCOUNTS.agent.id,
          closedAt: clock.at(-10 * DAY),
          completedAt: clock.at(-12 * DAY),
        },
        clock,
        20 * DAY,
      ),
      request(
        {
          id: 'req_0090',
          number: 90,
          contactId: 'ctc_grace',
          subject: 'Chef privé',
          status: 'PRESTATION_REALISEE',
          payload: {},
          anonymizedAt: clock.at(-DAY),
        },
        clock,
        30 * DAY,
      ),
    ],
    requestEvent: [
      event('evt_0142_1', 'req_0142', 'RECEIVED', clock.at(-2 * HOUR)),
      event('evt_0142_2', 'req_0142', 'ACK_SENT', clock.at(-2 * HOUR + 5_000), {
        data: { template: 'quote-ack', messageId: null },
      }),
      event('evt_0151_1', 'req_0151', 'RECEIVED', clock.at(-3 * DAY)),
      event('evt_0151_2', 'req_0151', 'ASSIGNED', clock.at(-2 * DAY), {
        data: { assignedToId: ACCOUNTS.agent.id },
        actorId: ACCOUNTS.admin.id,
      }),
      event('evt_0151_3', 'req_0151', 'STATUS_CHANGED', clock.at(-2 * DAY + HOUR), {
        data: { from: 'NOUVELLE', to: 'EN_COURS' },
        actorId: ACCOUNTS.agent.id,
      }),
    ],
    requestNote: [
      {
        id: 'note_1',
        requestId: 'req_0156',
        authorId: ACCOUNTS.editor.id,
        body: 'Rappeler demain matin.',
        createdAt: clock.at(-10 * HOUR),
        updatedAt: clock.at(-10 * HOUR),
      },
    ],
    attachment: [],
    survey: [],
    jobApplication: [],
    appointment: [
      {
        id: 'apt_7',
        reference: `MP-${String(year)}-0153`,
        requestId: null,
        contactId: 'ctc_samuel',
        reason: 'IMMOBILIER',
        format: 'VISIO',
        startsAt: clock.laterToday,
        endsAt: new Date(clock.laterToday.getTime() + 90 * 60_000),
        status: 'CONFIRME',
        proposedStartsAt: null,
        location: null,
        videoLink: 'https://meet.example.com/mambo-samuel',
        message: null,
        notes: 'Prévoir les plans.',
        reminderSentAt: null,
        assignedToId: ACCOUNTS.agent.id,
        createdAt: clock.at(-5 * DAY),
      },
      {
        id: 'apt_9',
        reference: `MP-${String(year)}-0158`,
        requestId: null,
        contactId: 'ctc_herve',
        reason: 'DEVIS',
        format: 'AGENCE',
        startsAt: clock.at(2 * DAY),
        endsAt: clock.at(2 * DAY + 90 * 60_000),
        status: 'A_CONFIRMER',
        proposedStartsAt: null,
        location: null,
        videoLink: null,
        message: 'Je voudrais un devis pour le ménage hebdomadaire.',
        notes: null,
        reminderSentAt: null,
        assignedToId: ACCOUNTS.agent.id,
        createdAt: clock.at(-DAY),
      },
      {
        id: 'apt_2',
        reference: `MP-${String(year)}-0130`,
        requestId: null,
        contactId: 'ctc_herve',
        reason: 'AUTRE',
        format: 'TELEPHONE',
        startsAt: clock.at(DAY),
        endsAt: clock.at(DAY + HOUR),
        status: 'ANNULE',
        proposedStartsAt: null,
        location: null,
        videoLink: null,
        message: null,
        notes: null,
        reminderSentAt: null,
        assignedToId: ACCOUNTS.agent.id,
        createdAt: clock.at(-3 * DAY),
      },
    ],
  };
}

/** Tables rechargées entre deux tests (les comptes et les sessions ouvertes sont conservés). */
export const BACK_OFFICE_TABLES = [
  'setting',
  'category',
  'service',
  'contact',
  'contactInterest',
  'subscriber',
  'referenceCounter',
  'request',
  'requestEvent',
  'requestNote',
  'attachment',
  'survey',
  'jobApplication',
  'appointment',
  'notification',
  'auditLog',
] as const satisfies readonly (keyof PrismaTables)[];

/** Remet les tables du back-office dans leur état initial, sans toucher aux comptes ni aux sessions. */
export function resetBackOffice(tables: PrismaTables, fresh: PrismaTables): void {
  const target = tables as unknown as Record<string, Row[]>;
  for (const name of BACK_OFFICE_TABLES) target[name] = structuredClone(fresh[name] ?? []);
}
