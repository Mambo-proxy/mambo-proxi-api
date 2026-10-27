/**
 * Journée calendaire de l'agence (fuseau `Africa/Douala`, UTC+1 toute l'année, sans heure d'été) : filtres
 * « aujourd'hui » du back-office, dates des exports, créneaux des rendez-vous. Le décalage est fixe : une heure de
 * Douala se convertit en instant UTC par simple soustraction, sans table des fuseaux (le changement d'heure
 * européen ne déplace aucun créneau).
 */
export const DOUALA_OFFSET_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

/** Date seule `AAAA-MM-JJ` (jour de Douala). */
export type DateKey = string;

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Début (inclus) et fin (exclue) de la journée de Douala qui contient `date`. */
export function doualaDay(date: Date): { start: Date; end: Date } {
  const local = date.getTime() + DOUALA_OFFSET_MS;
  const start = local - (((local % DAY_MS) + DAY_MS) % DAY_MS) - DOUALA_OFFSET_MS;
  return { start: new Date(start), end: new Date(start + DAY_MS) };
}

/** Date de Douala au format `AAAA-MM-JJ` (nom des fichiers exportés, colonnes de date). */
export function doualaDate(date: Date): DateKey {
  return new Date(date.getTime() + DOUALA_OFFSET_MS).toISOString().slice(0, 10);
}

/** Date `AAAA-MM-JJ` réelle du calendrier (« 2026-02-30 » refusée). */
export function isDateKey(value: string): boolean {
  const match = DATE_KEY.exec(value);
  if (!match) return false;
  const [, year, month, day] = match.map(Number) as [number, number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** Minutes depuis minuit d'une heure `HH:MM` (`null` si le format est invalide). */
export function minutesOfTime(value: string): number | null {
  const match = TIME.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/** Heure `HH:MM` de Douala de `date`. */
export function doualaTime(date: Date): string {
  return new Date(date.getTime() + DOUALA_OFFSET_MS).toISOString().slice(11, 16);
}

/** Instant UTC d'un jour de Douala à `minutes` après minuit (heure locale). */
export function doualaInstant(day: DateKey, minutes: number): Date {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) - DOUALA_OFFSET_MS + minutes * MINUTE_MS);
}

/** Jour décalé de `days` jours (`2026-10-31` + 1 → `2026-11-01`). */
export function addDays(day: DateKey, days: number): DateKey {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Jour de la semaine ISO : 1 = lundi … 7 = dimanche. */
export function isoWeekday(day: DateKey): number {
  const weekday = new Date(`${day}T00:00:00.000Z`).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

/** Nombre de jours de `from` à `to` (négatif si `to` précède `from`). */
export function daysBetween(from: DateKey, to: DateKey): number {
  return Math.round((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / DAY_MS);
}
