import {
  DAY_MS,
  addDays,
  daysBetween,
  doualaInstant,
  isoWeekday,
  minutesOfTime,
  type DateKey,
} from '../../common/time/agency-day.js';
import type { AppointmentFormat } from '../../generated/prisma/client.js';
import { closedWeekdayLabel } from './appointment-labels.js';

/**
 * Calcul des créneaux libres (schéma `Availability` du contrat), sans accès à la base : règles hebdomadaires
 * (heures locales de Douala), fermetures et horaires exceptionnels, rendez-vous qui occupent déjà un créneau, délai
 * minimal de réservation et horizon. Les heures de Douala sont converties en instants UTC avec le décalage fixe
 * (UTC+1, sans heure d'été) : un créneau de 09:00 reste à 08:00 UTC toute l'année.
 */

export const AGENCY_TIMEZONE = 'Africa/Douala';
export const AGENCY_TIMEZONE_LABEL = 'Heure de Douala (UTC+1)';
/** Période maximale d'une demande de disponibilités (`to` au plus 62 jours après `from`). */
export const MAX_AVAILABILITY_SPAN_DAYS = 62;

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

export interface AvailabilityRuleValue {
  id?: string | null;
  weekday: number;
  startTime: string;
  endTime: string;
  slotMinutes: number;
  formats: AppointmentFormat[];
}

export interface AvailabilityExceptionValue {
  id?: string | null;
  date: DateKey;
  closed: boolean;
  startTime: string | null;
  endTime: string | null;
  label: string | null;
}

/** Délai minimal (heures) et horizon (jours) de la prise de rendez-vous en ligne. */
export interface BookingPolicy {
  minNoticeHours: number;
  maxAdvanceDays: number;
}

/** Plage occupée `[start, end[` (millisecondes). */
export interface BusyInterval {
  start: number;
  end: number;
}

export interface AvailabilitySlot {
  startsAt: string;
  endsAt: string;
  formats: AppointmentFormat[];
}

export interface AvailabilityDay {
  date: DateKey;
  available: boolean;
  closedReason: string | null;
  slots: AvailabilitySlot[];
}

export interface Availability {
  timezone: typeof AGENCY_TIMEZONE;
  timezoneLabel: string;
  days: AvailabilityDay[];
}

export interface AvailabilityInput {
  rules: readonly AvailabilityRuleValue[];
  exceptions: readonly AvailabilityExceptionValue[];
  policy: BookingPolicy;
  busy: readonly BusyInterval[];
  from: DateKey;
  to: DateKey;
  format?: AppointmentFormat | undefined;
  now: Date;
}

export function overlaps(a: BusyInterval, b: BusyInterval): boolean {
  return a.start < b.end && a.end > b.start;
}

interface CandidateSlot extends BusyInterval {
  formats: AppointmentFormat[];
}

/**
 * Plages d'un jour : fermeture exceptionnelle (aucune plage), horaires exceptionnels (une plage, durée et formats de
 * la première règle du jour, à défaut de la première règle de la semaine), sinon les règles du jour de la semaine.
 */
function dayRules(
  day: DateKey,
  rules: readonly AvailabilityRuleValue[],
  exception: AvailabilityExceptionValue | undefined,
): AvailabilityRuleValue[] {
  if (exception?.closed) return [];
  const weekday = rules.filter((rule) => rule.weekday === isoWeekday(day));
  if (exception && exception.startTime !== null && exception.endTime !== null) {
    const model = weekday[0] ?? rules[0];
    return model ? [{ ...model, startTime: exception.startTime, endTime: exception.endTime }] : [];
  }
  return weekday;
}

/** Créneaux d'une plage : du début, par pas de la durée, tant que le créneau tient avant la fin. */
function candidateSlots(day: DateKey, rules: readonly AvailabilityRuleValue[]): CandidateSlot[] {
  const slots: CandidateSlot[] = [];
  for (const rule of rules) {
    const first = minutesOfTime(rule.startTime);
    const last = minutesOfTime(rule.endTime);
    if (first === null || last === null || rule.slotMinutes <= 0) continue;
    for (let minute = first; minute + rule.slotMinutes <= last; minute += rule.slotMinutes) {
      const start = doualaInstant(day, minute).getTime();
      slots.push({ start, end: start + rule.slotMinutes * MINUTE_MS, formats: [...rule.formats] });
    }
  }
  return slots.sort((a, b) => a.start - b.start);
}

/** Jours et créneaux libres de `from` à `to` (inclus), dans l'ordre. */
export function computeAvailability(input: AvailabilityInput): Availability {
  const { rules, exceptions, policy, busy, format, now } = input;
  const earliest = now.getTime() + policy.minNoticeHours * HOUR_MS;
  const latest = now.getTime() + policy.maxAdvanceDays * DAY_MS;
  const byDate = new Map(exceptions.map((exception) => [exception.date, exception]));
  const days: AvailabilityDay[] = [];

  for (let offset = 0; offset <= daysBetween(input.from, input.to); offset += 1) {
    const date = addDays(input.from, offset);
    const exception = byDate.get(date);
    if (exception?.closed) {
      days.push({ date, available: false, closedReason: exception.label ?? 'Fermé', slots: [] });
      continue;
    }
    const open = dayRules(date, rules, exception);
    if (open.length === 0) {
      days.push({
        date,
        available: false,
        closedReason: exception?.label ?? closedWeekdayLabel(isoWeekday(date)),
        slots: [],
      });
      continue;
    }
    let taken = false;
    const slots: AvailabilitySlot[] = [];
    for (const slot of candidateSlots(date, open)) {
      if (slot.start < earliest || slot.start > latest) continue;
      if (busy.some((interval) => overlaps(slot, interval))) {
        taken = true;
        continue;
      }
      if (format !== undefined && !slot.formats.includes(format)) continue;
      slots.push({
        startsAt: new Date(slot.start).toISOString(),
        endsAt: new Date(slot.end).toISOString(),
        formats: slot.formats,
      });
    }
    days.push({
      date,
      available: slots.length > 0,
      closedReason: slots.length > 0 ? null : (exception?.label ?? (taken ? 'Complet' : null)),
      slots,
    });
  }
  return { timezone: AGENCY_TIMEZONE, timezoneLabel: AGENCY_TIMEZONE_LABEL, days };
}

/**
 * Créneau demandé en ligne : `free` (proposé tel quel, avec sa fin), `taken` (proposé mais occupé entre-temps →
 * 409) ou `invalid` (aucun créneau à cette heure pour ce format, ou hors délai → 422).
 */
export type SlotLookup =
  { status: 'free'; slot: AvailabilitySlot } | { status: 'taken' } | { status: 'invalid' };

export function lookupSlot(
  input: Omit<AvailabilityInput, 'from' | 'to'> & { day: DateKey; startsAt: Date; format: AppointmentFormat },
): SlotLookup {
  const find = (busy: readonly BusyInterval[]): AvailabilitySlot | undefined =>
    computeAvailability({ ...input, busy, from: input.day, to: input.day }).days[0]?.slots.find(
      (slot) => Date.parse(slot.startsAt) === input.startsAt.getTime(),
    );
  const slot = find(input.busy);
  if (slot) return { status: 'free', slot };
  return find([]) ? { status: 'taken' } : { status: 'invalid' };
}
