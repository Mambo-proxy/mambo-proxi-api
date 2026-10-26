import type { Lang } from './lang.js';

/**
 * Fusion des traductions anglaises (`?lang=en`), selon `docs/MODELE_DE_DONNEES.md` :
 * - colonnes `…En` (zones, quartiers) : `pickLocalized` ;
 * - colonne JSON `translations` `{ "en": { champ: valeur } }`, de même forme que le champ français : `localize`.
 * Un champ absent, nul ou vide dans la traduction est renvoyé en français, champ par champ (y compris à l'intérieur
 * des structures JSON : étapes, FAQ, sections de pages…).
 */

type PlainObject = Record<string, unknown>;

export function isPlainObject(value: unknown): value is PlainObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Valeur traduite considérée comme absente : le français est conservé. */
function isMissing(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}

function hasStringId(value: unknown): value is PlainObject & { id: string } {
  return isPlainObject(value) && typeof value['id'] === 'string';
}

function mergeArrays(base: unknown[], translated: unknown[]): unknown[] {
  if (translated.length === 0) return base;
  // Listes d'éléments identifiés (sections de pages, offres…) : appariement par `id`, ordre et liste du français.
  if (base.length > 0 && base.every(hasStringId) && translated.every(hasStringId)) {
    const byId = new Map(translated.map((item) => [item.id, item]));
    return base.map((item) => mergeTranslation(item, byId.get(item.id)));
  }
  // Autres listes : la traduction fixe la liste ; chaque élément complète l'élément français de même rang.
  return translated.map((item, index) => mergeTranslation(base[index], item));
}

/**
 * Recouvre `base` (français) par `translated` (anglais), récursivement :
 * objets fusionnés clé par clé, listes élément par élément, valeurs simples remplacées.
 */
export function mergeTranslation<T>(base: T, translated: unknown): T {
  if (isMissing(translated)) return base;
  if (Array.isArray(base) && Array.isArray(translated)) return mergeArrays(base, translated) as T;
  if (isPlainObject(base) && isPlainObject(translated)) {
    const merged: PlainObject = { ...base };
    for (const [key, value] of Object.entries(translated)) merged[key] = mergeTranslation(base[key], value);
    return merged as T;
  }
  if (base === undefined || base === null) return translated as T;
  // Une traduction de forme différente (objet à la place d'un texte…) est ignorée : le français reste affiché.
  if (
    Array.isArray(base) !== Array.isArray(translated) ||
    isPlainObject(base) !== isPlainObject(translated)
  ) {
    return base;
  }
  return translated as T;
}

/** Recouvrement anglais d'une colonne `translations` (`{ en: {…} }`) ; `undefined` en français ou sans traduction. */
export function translationFor(translations: unknown, lang: Lang): PlainObject | undefined {
  if (lang === 'fr' || !isPlainObject(translations)) return undefined;
  const translated = translations[lang];
  return isPlainObject(translated) ? translated : undefined;
}

/** Valeur dans la langue demandée, à partir d'une colonne `translations`. */
export function localize<T>(value: T, translations: unknown, lang: Lang): T {
  const translated = translationFor(translations, lang);
  return translated === undefined ? value : mergeTranslation(value, translated);
}

/**
 * Champs traduisibles d'un enregistrement dans la langue demandée : seuls les champs listés peuvent être recouverts
 * (un identifiant, un statut ou un slug présent par erreur dans `translations` est ignoré).
 */
export function localizeFields<T extends object, K extends keyof T>(
  record: T,
  translations: unknown,
  lang: Lang,
  fields: readonly K[],
): T {
  const translated = translationFor(translations, lang);
  if (translated === undefined) return record;
  const result = { ...record };
  for (const field of fields) {
    result[field] = mergeTranslation(record[field], translated[String(field)]);
  }
  return result;
}

/** Colonnes `…En` : la valeur anglaise si elle est renseignée, sinon le français. */
export function pickLocalized<T extends string | null | undefined>(
  french: T,
  english: string | null | undefined,
  lang: Lang,
): T | string {
  return lang === 'en' && !isMissing(english) ? (english as string) : french;
}
