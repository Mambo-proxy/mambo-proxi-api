import { HttpStatus } from '@nestjs/common';
import { ProblemException } from '../../common/problem/problem.js';
import { Prisma, type AppointmentStatus } from '../../generated/prisma/client.js';
import { overlaps, type BusyInterval } from './availability.js';

/**
 * Occupation des créneaux. Un rendez-vous à confirmer ou confirmé occupe `[startsAt, endsAt[` ; un rendez-vous pour
 * lequel un autre créneau est proposé occupe le créneau proposé (même durée), son créneau d'origine est libéré.
 *
 * Double réservation : toute écriture qui prend un créneau (demande en ligne, saisie manuelle, proposition,
 * confirmation, acceptation) se fait dans une transaction qui pose d'abord un verrou consultatif PostgreSQL
 * (`pg_advisory_xact_lock`, libéré à la fin de la transaction), puis vérifie le chevauchement : deux écritures
 * simultanées sont traitées l'une après l'autre. L'index unique partiel `appointments_active_slot_key`
 * (`starts_at` des rendez-vous à confirmer ou confirmés) reste le dernier rempart : sa violation (P2002) devient un
 * 409 `slot-taken`.
 */

/** Statuts qui occupent un créneau. */
export const BLOCKING_STATUSES: readonly AppointmentStatus[] = [
  'A_CONFIRMER',
  'CONFIRME',
  'AUTRE_CRENEAU_PROPOSE',
];
/** Statuts couverts par l'index unique partiel de la base. */
export const INDEXED_STATUSES: readonly AppointmentStatus[] = ['A_CONFIRMER', 'CONFIRME'];
/** Statuts clos : plus aucune action sur le rendez-vous, sauf les notes. */
export const CLOSED_STATUSES: readonly AppointmentStatus[] = ['ANNULE', 'TERMINE'];

/** Durée maximale d'un rendez-vous (saisie manuelle : 8 h) : borne de la recherche des chevauchements. */
const MAX_DURATION_MS = 8 * 60 * 60 * 1000;

/** Nom de l'index unique partiel (migration initiale). */
export const ACTIVE_SLOT_INDEX = 'appointments_active_slot_key';

export const SLOT_TAKEN_DETAIL = 'Ce créneau vient d’être réservé. Choisissez un autre horaire.';

/** 409 `slot-taken` (réponse de `POST /v1/appointments`). */
export function slotTakenException(detail = SLOT_TAKEN_DETAIL): ProblemException {
  return new ProblemException({
    status: HttpStatus.CONFLICT,
    type: 'slot-taken',
    title: 'Créneau indisponible',
    detail,
  });
}

/**
 * Violation d'unicité (P2002) levée par l'écriture d'un rendez-vous. La seule contrainte unique qu'une écriture de
 * l'API peut violer est celle du créneau (la référence vient d'un compteur, le condensat du jeton est aléatoire) ;
 * une violation qui nomme explicitement une autre colonne n'est pas convertie.
 */
export function isSlotTakenError(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') return false;
  // Adaptateur `pg` : contrainte dans `meta.driverAdapterError.cause.constraint` (`{ index }` ou `{ fields }`) et
  // dans le message (« Unique constraint failed on the constraint: `appointments_active_slot_key` »).
  const adapter = (error.meta?.['driverAdapterError'] ?? {}) as { cause?: { constraint?: unknown } };
  const described = [error.message, safeJson(adapter.cause?.constraint), safeJson(error.meta)].join(' ');
  if (described.includes(ACTIVE_SLOT_INDEX) || /starts_?at/i.test(described)) return true;
  return !/reference|proposal_?token_?hash|request_?id/i.test(described);
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return '';
  }
}

/** Rendez-vous lu pour le calcul de l'occupation. */
export interface BlockingRow {
  id: string;
  reference: string;
  status: AppointmentStatus;
  startsAt: Date;
  endsAt: Date;
  proposedStartsAt: Date | null;
}

export const BLOCKING_SELECT = {
  id: true,
  reference: true,
  status: true,
  startsAt: true,
  endsAt: true,
  proposedStartsAt: true,
} as const;

/** Plage occupée par un rendez-vous (ou `null` s'il ne bloque rien). */
export function occupiedInterval(row: BlockingRow): BusyInterval | null {
  if (row.status === 'A_CONFIRMER' || row.status === 'CONFIRME')
    return { start: row.startsAt.getTime(), end: row.endsAt.getTime() };
  if (row.status === 'AUTRE_CRENEAU_PROPOSE' && row.proposedStartsAt !== null) {
    const start = row.proposedStartsAt.getTime();
    return { start, end: start + (row.endsAt.getTime() - row.startsAt.getTime()) };
  }
  return null;
}

type AppointmentReader = Pick<Prisma.TransactionClient, 'appointment'>;

/** Rendez-vous qui occupent une partie de `[start, end[` (hors `excludeId`). */
export async function blockingAppointments(
  client: AppointmentReader,
  window: BusyInterval,
  excludeId?: string,
): Promise<{ row: BlockingRow; interval: BusyInterval }[]> {
  const rows: BlockingRow[] = await client.appointment.findMany({
    where: {
      status: { in: [...BLOCKING_STATUSES] },
      ...(excludeId === undefined ? {} : { id: { not: excludeId } }),
      OR: [
        { startsAt: { lt: new Date(window.end) }, endsAt: { gt: new Date(window.start) } },
        {
          proposedStartsAt: {
            gt: new Date(window.start - MAX_DURATION_MS),
            lt: new Date(window.end),
          },
        },
      ],
    },
    select: BLOCKING_SELECT,
  });
  return rows.flatMap((row) => {
    const interval = occupiedInterval(row);
    return interval !== null && overlaps(interval, window) ? [{ row, interval }] : [];
  });
}

/** Verrou consultatif de la transaction : les écritures de créneaux sont traitées une à une. */
export async function lockSlots(tx: Pick<Prisma.TransactionClient, '$executeRaw'>): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('mambo:appointments'))`;
}
