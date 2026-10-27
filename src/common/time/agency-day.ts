/**
 * Journée calendaire de l'agence (fuseau `Africa/Douala`, UTC+1 toute l'année, sans heure d'été) : filtres
 * « aujourd'hui » du back-office, dates des exports.
 */
const DOUALA_OFFSET_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;

/** Début (inclus) et fin (exclue) de la journée de Douala qui contient `date`. */
export function doualaDay(date: Date): { start: Date; end: Date } {
  const local = date.getTime() + DOUALA_OFFSET_MS;
  const start = local - (((local % DAY_MS) + DAY_MS) % DAY_MS) - DOUALA_OFFSET_MS;
  return { start: new Date(start), end: new Date(start + DAY_MS) };
}

/** Date de Douala au format `AAAA-MM-JJ` (nom des fichiers exportés, colonnes de date). */
export function doualaDate(date: Date): string {
  return new Date(date.getTime() + DOUALA_OFFSET_MS).toISOString().slice(0, 10);
}
