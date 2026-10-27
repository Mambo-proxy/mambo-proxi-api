import {
  DAY_MS,
  addDays,
  doualaDate,
  doualaDay,
  isoWeekday,
  type DateKey,
} from '../../common/time/agency-day.js';

export const DASHBOARD_RANGES = ['7d', '30d', '12m'] as const;
export type DashboardRange = (typeof DASHBOARD_RANGES)[number];

/** Période du tableau de bord et période précédente de même durée (instants UTC, fin exclue). */
export interface DashboardPeriod {
  start: Date;
  end: Date;
  previousStart: Date;
  /** Jours de Douala couverts (mesure d'audience), dernier inclus. */
  fromDay: DateKey;
  toDay: DateKey;
  previousFromDay: DateKey;
  previousToDay: DateKey;
}

/** Instant UTC du début d'un jour de Douala. */
export function dayStart(day: DateKey): Date {
  return doualaDay(new Date(`${day}T12:00:00.000Z`)).start;
}

/** Premier jour du mois (de Douala) décalé de `offset` mois. */
function monthStart(day: DateKey, offset: number): DateKey {
  const [year, month] = day.split('-').map(Number) as [number, number];
  const date = new Date(Date.UTC(year, month - 1 + offset, 1));
  return date.toISOString().slice(0, 10);
}

/**
 * Période en jours entiers de Douala jusqu'à maintenant : 7 jours ou 30 jours (aujourd'hui compris), 12 mois (mois
 * en cours compris). La période précédente a la même durée et se termine au début de la période.
 */
export function dashboardPeriod(range: DashboardRange, now: Date): DashboardPeriod {
  const today = doualaDate(now);
  const fromDay =
    range === '7d' ? addDays(today, -6) : range === '30d' ? addDays(today, -29) : monthStart(today, -11);
  const previousFromDay =
    range === '12m' ? monthStart(today, -23) : addDays(fromDay, range === '7d' ? -7 : -30);
  const start = dayStart(fromDay);
  return {
    start,
    end: new Date(now.getTime() + 1),
    previousStart: dayStart(previousFromDay),
    fromDay,
    toDay: today,
    previousFromDay,
    previousToDay: addDays(fromDay, -1),
  };
}

/** Point du graphique « Demandes reçues ». */
export interface SeriesBucket {
  label: string;
  start: DateKey;
  from: Date;
  to: Date;
}

const WEEKDAY = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', timeZone: 'UTC' });
const MONTH = new Intl.DateTimeFormat('fr-FR', { month: 'short', timeZone: 'UTC' });

/** Numéro de semaine ISO 8601 d'un jour. */
export function isoWeekNumber(day: DateKey): number {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  const target = new Date(Date.UTC(year, month - 1, date));
  target.setUTCDate(target.getUTCDate() + 4 - isoWeekday(day));
  const yearStart = Date.UTC(target.getUTCFullYear(), 0, 1);
  return Math.ceil(((target.getTime() - yearStart) / DAY_MS + 1) / 7);
}

/**
 * Découpage du graphique : 7 jours (un point par jour), 30 jours (12 semaines du lundi au dimanche, comme la
 * maquette), 12 mois (un point par mois). Le dernier point est la période en cours.
 */
export function seriesBuckets(range: DashboardRange, now: Date): SeriesBucket[] {
  const today = doualaDate(now);
  const end = new Date(now.getTime() + 1);
  if (range === '7d') {
    return Array.from({ length: 7 }, (_, index) => {
      const day = addDays(today, index - 6);
      return {
        label: WEEKDAY.format(new Date(`${day}T12:00:00.000Z`)).replace('.', ''),
        start: day,
        from: dayStart(day),
        to: index === 6 ? end : dayStart(addDays(day, 1)),
      };
    });
  }
  if (range === '30d') {
    const monday = addDays(today, 1 - isoWeekday(today));
    return Array.from({ length: 12 }, (_, index) => {
      const day = addDays(monday, (index - 11) * 7);
      return {
        label: `S${String(isoWeekNumber(day))}`,
        start: day,
        from: dayStart(day),
        to: index === 11 ? end : dayStart(addDays(day, 7)),
      };
    });
  }
  return Array.from({ length: 12 }, (_, index) => {
    const day = monthStart(today, index - 11);
    return {
      label: MONTH.format(new Date(`${day}T12:00:00.000Z`)),
      start: day,
      from: dayStart(day),
      to: index === 11 ? end : dayStart(monthStart(today, index - 10)),
    };
  });
}

/** Arrondi à une décimale. */
export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Évolution en pourcentage (une décimale) ; `null` sans valeur de comparaison. */
export function deltaPercent(value: number | null, previous: number | null): number | null {
  if (value === null || previous === null || previous === 0) return null;
  return round1(((value - previous) / previous) * 100);
}
