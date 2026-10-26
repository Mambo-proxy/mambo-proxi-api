import { randomInt } from 'node:crypto';
import type { Prisma } from '../../generated/prisma/client.js';

/** Fuseau de référence de l'agence : l'année d'une référence est celle de Douala. */
export const AGENCY_TIME_ZONE = 'Africa/Douala';

const yearFormat = new Intl.DateTimeFormat('en-GB', { timeZone: AGENCY_TIME_ZONE, year: 'numeric' });

/** Année civile à Douala (UTC+1) : le 31 décembre à 23 h 30 UTC appartient déjà à l'année suivante. */
export function referenceYear(now: Date): number {
  return Number(yearFormat.format(now));
}

/** Référence lisible `MP-AAAA-NNNN` (schéma `Reference` du contrat ; au-delà de 9999, plus de chiffres). */
export function formatReference(year: number, sequence: number): string {
  return `MP-${String(year)}-${String(sequence).padStart(4, '0')}`;
}

/**
 * Attribue la référence suivante de l'année, dans la transaction de création : `upsert` sur la ligne de l'année
 * (traduit par Prisma en `INSERT … ON CONFLICT (year) DO UPDATE SET last_value = last_value + 1 RETURNING …`).
 * L'incrément est atomique et la ligne reste verrouillée jusqu'à la fin de la transaction : deux envois simultanés
 * obtiennent deux numéros distincts, et un échec de la transaction n'en consomme aucun.
 */
export async function nextReference(tx: Prisma.TransactionClient, now: Date): Promise<string> {
  const year = referenceYear(now);
  const counter = await tx.referenceCounter.upsert({
    where: { year },
    create: { year, lastValue: 1 },
    update: { lastValue: { increment: 1 } },
    select: { lastValue: true },
  });
  return formatReference(year, counter.lastValue);
}

/** Référence vraisemblable renvoyée à un robot (champ piège rempli) : rien n'est enregistré ni consommé. */
export function decoyReference(now: Date): string {
  return formatReference(referenceYear(now), randomInt(1_000, 10_000));
}
