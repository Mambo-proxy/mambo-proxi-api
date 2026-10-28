import { createHash } from 'node:crypto';
import { isPlainObject } from './translations.js';

/**
 * Socle des traductions anglaises saisies à la main dans le back-office (pages, paramètres, zones…).
 *
 * Règle commune : seuls les **textes** viennent de l'anglais ; la structure, les nombres, les booléens et les champs
 * techniques sont toujours ceux du français, à l'enregistrement comme à chaque lecture. Les listes sont alignées par
 * rang (nombre et ordre du français). Une traduction mémorise, par unité (section de page, champ, chemin…),
 * l'empreinte des textes français qu'elle traduit : une empreinte différente de celle du français actuel la signale
 * périmée.
 *
 * Ce qui est un texte se règle par `TextRules` :
 * - `nonTextKeys` : clés jamais traduites (sous-arbre compris), par exemple `id`, `href`, `imageId` ;
 * - `paths` : liste blanche de chemins pointés (`agency.addressLines.*`, `keyFigures.*.label`, `*` = n'importe
 *   quel rang ou clé) ; absente, toute chaîne hors `nonTextKeys` est un texte.
 */

export interface TextRules {
  nonTextKeys?: ReadonlySet<string>;
  paths?: readonly string[];
}

/** Chemin pointé d'un texte (`agency.addressLines.0`) conforme à la liste blanche (toujours vrai sans liste). */
export function isTextPath(path: string, rules: TextRules): boolean {
  if (rules.paths === undefined) return true;
  const segments = path.split('.');
  return rules.paths.some((pattern) => {
    const parts = pattern.split('.');
    return (
      parts.length === segments.length &&
      parts.every((part, index) => part === '*' || part === segments[index])
    );
  });
}

const join = (path: string, segment: string) => (path === '' ? segment : `${path}.${segment}`);

function compose(
  french: unknown,
  english: unknown,
  rules: TextRules,
  path: string,
  key: string | undefined,
): unknown {
  if (key !== undefined && rules.nonTextKeys?.has(key) === true) return french;
  if (typeof french === 'string') {
    if (french === '' || typeof english !== 'string' || !isTextPath(path, rules)) return french;
    return english.trim() !== '' ? english : french;
  }
  if (Array.isArray(french)) {
    const list: unknown[] = Array.isArray(english) ? english : [];
    return french.map((item, index) =>
      compose(item, list[index], rules, join(path, String(index)), undefined),
    );
  }
  if (isPlainObject(french)) {
    const source = isPlainObject(english) ? english : {};
    return Object.fromEntries(
      Object.entries(french).map(([field, value]) => [
        field,
        compose(value, source[field], rules, join(path, field), field),
      ]),
    );
  }
  return french;
}

/**
 * Textes anglais posés sur la structure française : une chaîne française non vide (et textuelle selon `rules`) est
 * remplacée par la chaîne anglaise de même chemin si elle est renseignée ; listes élément par élément (nombre et
 * ordre du français) ; champs techniques, booléens et nombres du français ; ce qui n'existe pas en français est
 * ignoré. `key` : clé sous laquelle se trouve `french` (une clé non textuelle garde le français).
 */
export function applyTexts(french: unknown, english: unknown, rules: TextRules, key?: string): unknown {
  return compose(french, english, rules, '', key);
}

/**
 * Champs listés d'un enregistrement dont les textes viennent de `english` (`applyTexts` champ par champ) ; les autres
 * champs sont rendus tels quels. Sert aux contenus dont la colonne `translations.en` a la forme des champs français.
 */
export function localizeTexts<T extends object, K extends keyof T>(
  record: T,
  english: unknown,
  rules: TextRules,
  fields: readonly K[],
): T {
  if (!isPlainObject(english)) return record;
  const result = { ...record };
  for (const field of fields) {
    result[field] = applyTexts(record[field], english[String(field)], rules) as T[K];
  }
  return result;
}

/** Textes de `value` (`[chemin, texte]`, non vides, triés par chemin) : ce qui se traduit. */
export function textEntries(value: unknown, rules: TextRules): [string, string][] {
  const texts: [string, string][] = [];
  const walk = (item: unknown, path: string, key?: string): void => {
    if (key !== undefined && rules.nonTextKeys?.has(key) === true) return;
    if (typeof item === 'string') {
      if (item.trim() !== '' && isTextPath(path, rules)) texts.push([path, item]);
    } else if (Array.isArray(item)) {
      item.forEach((child, index) => walk(child, join(path, String(index))));
    } else if (isPlainObject(item)) {
      for (const [field, child] of Object.entries(item)) walk(child, join(path, field), field);
    }
  };
  walk(value, '');
  return texts.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Empreinte stable (sha256) d'une liste `[chemin, texte]` ; `null` si elle est vide (rien à traduire). */
export function hashTexts(texts: readonly (readonly [string, string])[]): string | null {
  if (texts.length === 0) return null;
  return createHash('sha256').update(JSON.stringify(texts)).digest('hex');
}

/** Empreinte des textes de `value`, indépendante de l'ordre des clés JSON ; `null` sans texte. */
export function textHash(value: unknown, rules: TextRules): string | null {
  return hashTexts(textEntries(value, rules));
}

/** Empreinte d'un texte seul (unité « champ ») ; `null` s'il est vide. */
export function fieldHash(text: string | null | undefined): string | null {
  return typeof text === 'string' && text.trim() !== '' ? hashTexts([['', text]]) : null;
}

/**
 * Textes anglais à garder (`[chemin, texte]`), alignés sur le français : seuls les chemins textuels dont le français
 * est renseigné, avec un texte anglais non vide.
 */
export function translatedEntries(french: unknown, english: unknown, rules: TextRules): [string, string][] {
  return textEntries(french, rules).flatMap(([path]): [string, string][] => {
    const text = textAt(english, path);
    return text === null ? [] : [[path, text]];
  });
}

function valueAt(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (Array.isArray(current)) return current[Number(segment)];
    return isPlainObject(current) ? current[segment] : undefined;
  }, value);
}

/**
 * Textes anglais seuls, de la forme (partielle) du français : objets réduits aux clés traduites, listes de la
 * longueur utile avec `null` pour un élément sans traduction. `null` si rien n'est traduit. Sert à l'enregistrement
 * (le reste de l'envoi est ignoré) et à la relecture du back-office.
 */
export function pickTexts(french: unknown, english: unknown, rules: TextRules): unknown {
  const entries = translatedEntries(french, english, rules);
  if (entries.length === 0) return null;
  let result: unknown = null;
  for (const [path, text] of entries) result = setPath(result, path.split('.'), text, french);
  return result;
}

function setPath(target: unknown, segments: string[], text: string, frenchNode: unknown): unknown {
  const [head, ...rest] = segments;
  if (head === undefined) return text;
  if (Array.isArray(frenchNode)) {
    const index = Number(head);
    const list: unknown[] = Array.isArray(target) ? [...(target as unknown[])] : [];
    while (list.length < index) list.push(null);
    list[index] = setPath(list[index], rest, text, frenchNode[index]);
    return list;
  }
  const object = isPlainObject(target) ? { ...target } : {};
  object[head] = setPath(object[head], rest, text, isPlainObject(frenchNode) ? frenchNode[head] : undefined);
  return object;
}

/** Texte d'un chemin (`agency.addressLines.0`), s'il est renseigné ; `null` sinon. */
export function textAt(source: unknown, path: string): string | null {
  const value = valueAt(source, path);
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/** Empreintes mémorisées (`{ unité: sha256 }`), lues prudemment. */
export function readHashes(value: unknown): Record<string, string> {
  if (!isPlainObject(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

export type TranslationState = 'MISSING' | 'OUTDATED' | 'UP_TO_DATE';

/** Unité de traduction : section, champ ou chemin. */
export interface TranslationUnit {
  id: string;
  /** Empreinte des textes français actuels ; `null` = rien à traduire (unité ignorée). */
  hash: string | null;
  /** Une version anglaise existe pour cette unité. */
  translated: boolean;
  /** Empreinte des textes français traduits ; `null` = inconnue (traduction considérée à jour). */
  reference: string | null;
}

export interface UnitsStatus {
  state: TranslationState;
  missing: string[];
  outdated: string[];
}

/**
 * État d'une traduction : `MISSING` sans traduction (`hasTranslation` faux) ou s'il manque une unité, sinon
 * `OUTDATED` si une unité est périmée, sinon `UP_TO_DATE`.
 */
export function unitsStatus(units: readonly TranslationUnit[], hasTranslation = true): UnitsStatus {
  const missing: string[] = [];
  const outdated: string[] = [];
  for (const unit of units) {
    if (unit.hash === null) continue;
    if (!hasTranslation || !unit.translated) missing.push(unit.id);
    else if (unit.reference !== null && unit.reference !== unit.hash) outdated.push(unit.id);
  }
  const state: TranslationState =
    !hasTranslation || missing.length > 0 ? 'MISSING' : outdated.length > 0 ? 'OUTDATED' : 'UP_TO_DATE';
  return { state, missing, outdated };
}

/**
 * Empreinte à mémoriser pour une unité traduite enregistrée : celle des textes français actuels (`current`) si
 * l'unité est nouvelle ou modifiée (`unchanged` faux) ou marquée revue ; sinon l'empreinte gardée (une traduction
 * inchangée reste périmée si le français a changé), à défaut `fallback` (traduction antérieure au suivi : empreinte
 * du français qu'elle traduisait), à défaut `current`.
 */
export function nextReferenceHash(options: {
  current: string | null;
  unchanged: boolean;
  reviewed: boolean;
  stored: string | undefined;
  fallback?: string | null;
}): string | null {
  const { current, unchanged, reviewed, stored, fallback } = options;
  if (reviewed || !unchanged) return current;
  return stored ?? fallback ?? current;
}

/** Schéma `TextTranslationStatus` du contrat (unités « champ » ou « chemin » : paramètres, zones…). */
export interface TextTranslationStatus {
  state: TranslationState;
  missingFields: string[];
  outdatedFields: string[];
}

export function textTranslationStatus(units: readonly TranslationUnit[]): TextTranslationStatus {
  const { state, missing, outdated } = unitsStatus(units);
  return { state, missingFields: missing, outdatedFields: outdated };
}
