import {
  fieldHash,
  nextReferenceHash,
  readHashes,
  textTranslationStatus,
  type TextTranslationStatus,
  type TranslationUnit,
} from '../../common/i18n/text-translation.js';
import type { ProblemFieldError } from '../../common/problem/problem.js';

/**
 * Version anglaise des zones (colonnes `…En` des zones et des quartiers) et son suivi : la colonne
 * `translationHashes` garde l'empreinte du texte français traduit, par champ (`name`, `description`, `result`) et par
 * texte de quartier (`quarter:<clé du quartier>:detail` / `:mapLabel`, la clé étant le nom sans accents ni casse).
 * Statut exposé (`AdminZone.translationStatus.en`) : chemins `name`, `description`, `result`,
 * `quarters.N.detail`, `quarters.N.mapLabel` (N = rang du quartier dans la zone).
 */

export const ZONE_TEXT_FIELDS = [
  ['name', 'nameEn'],
  ['description', 'descriptionEn'],
  ['result', 'resultEn'],
] as const;

export const QUARTER_TEXT_FIELDS = [
  ['detail', 'detailEn'],
  ['mapLabel', 'mapLabelEn'],
] as const;

export type ZoneTextField = (typeof ZONE_TEXT_FIELDS)[number][0];
export type QuarterTextField = (typeof QUARTER_TEXT_FIELDS)[number][0];

/** Chemins acceptés par `reviewedFields`. */
export const REVIEWED_FIELD_PATTERN = /^(name|description|result|quarters\.\d+\.(detail|mapLabel))$/;

export interface ZoneTexts {
  name: string;
  nameEn: string | null;
  description: string;
  descriptionEn: string | null;
  result: string;
  resultEn: string | null;
  translationHashes: unknown;
  quarters: readonly QuarterTexts[];
}

export interface QuarterTexts {
  normalizedName: string;
  detail: string | null;
  detailEn: string | null;
  mapLabel: string | null;
  mapLabelEn: string | null;
}

const filled = (value: string | null | undefined): value is string =>
  typeof value === 'string' && value.trim() !== '';

export const quarterHashKey = (normalizedName: string, field: QuarterTextField) =>
  `quarter:${normalizedName}:${field}`;

/** Statut de la traduction anglaise d'une zone ; une traduction sans empreinte est considérée à jour. */
export function zoneTranslationStatus(zone: ZoneTexts): TextTranslationStatus {
  const hashes = readHashes(zone.translationHashes);
  const units: TranslationUnit[] = ZONE_TEXT_FIELDS.map(([field, english]) => ({
    id: field,
    hash: fieldHash(zone[field]),
    translated: filled(zone[english]),
    reference: hashes[field] ?? null,
  }));
  zone.quarters.forEach((quarter, index) => {
    for (const [field, english] of QUARTER_TEXT_FIELDS) {
      units.push({
        id: `quarters.${String(index)}.${field}`,
        hash: fieldHash(quarter[field]),
        translated: filled(quarter[english]),
        reference: hashes[quarterHashKey(quarter.normalizedName, field)] ?? null,
      });
    }
  });
  return textTranslationStatus(units);
}

/**
 * `reviewedFields` : chaque chemin doit désigner un texte traduit de la zone enregistrée (`422` sur
 * `reviewedFields.N` sinon).
 */
export function reviewedZoneFieldErrors(zone: ZoneTexts, reviewed: readonly string[]): ProblemFieldError[] {
  return reviewed.flatMap((path, index): ProblemFieldError[] => {
    const [head, rank, field] = path.split('.');
    const zoneField = ZONE_TEXT_FIELDS.find(([name]) => name === head);
    const quarterField = QUARTER_TEXT_FIELDS.find(([name]) => name === field);
    const quarter = head === 'quarters' ? zone.quarters[Number(rank)] : undefined;
    const translated =
      zoneField !== undefined
        ? filled(zone[zoneField[1]])
        : quarter !== undefined && quarterField !== undefined && filled(quarter[quarterField[1]]);
    return translated
      ? []
      : [
          {
            path: `reviewedFields.${String(index)}`,
            code: 'unknown_field',
            message: 'Ce champ n’a pas de traduction anglaise à marquer comme revue.',
          },
        ];
  });
}

/**
 * Empreintes à enregistrer après une modification : pour chaque texte traduit, celle du texte français actuel si
 * la traduction est nouvelle, modifiée ou marquée revue ; sinon l'empreinte gardée, à défaut celle du texte français
 * précédent (traduction antérieure au suivi, quartier repris d'une autre zone). `previousQuarters` : quartiers
 * remplacés (toutes zones), par clé.
 */
export function nextZoneHashes(options: {
  before: ZoneTexts | null;
  after: ZoneTexts;
  previousQuarters: ReadonlyMap<string, QuarterTexts>;
  reviewed: readonly string[];
}): Record<string, string> {
  const { before, after, previousQuarters } = options;
  const reviewed = new Set(options.reviewed);
  const stored = readHashes(before?.translationHashes);
  const next: Record<string, string> = {};
  for (const [field, english] of ZONE_TEXT_FIELDS) {
    if (!filled(after[english])) continue;
    const hash = nextReferenceHash({
      current: fieldHash(after[field]),
      unchanged: before !== null && before[english] === after[english],
      reviewed: reviewed.has(field),
      stored: stored[field],
      fallback: before === null ? null : fieldHash(before[field]),
    });
    if (hash !== null) next[field] = hash;
  }
  after.quarters.forEach((quarter, index) => {
    const previous = previousQuarters.get(quarter.normalizedName);
    for (const [field, english] of QUARTER_TEXT_FIELDS) {
      if (!filled(quarter[english])) continue;
      const key = quarterHashKey(quarter.normalizedName, field);
      const hash = nextReferenceHash({
        current: fieldHash(quarter[field]),
        // Les textes anglais des quartiers ne se modifient pas dans le back-office : ils suivent le quartier.
        unchanged: previous !== undefined && previous[english] === quarter[english],
        reviewed: reviewed.has(`quarters.${String(index)}.${field}`),
        stored: stored[key],
        fallback: previous === undefined ? null : fieldHash(previous[field]),
      });
      if (hash !== null) next[key] = hash;
    }
  });
  return next;
}
