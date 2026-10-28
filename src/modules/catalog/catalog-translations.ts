import type { Lang } from '../../common/i18n/lang.js';
import {
  hashTexts,
  localizeTexts,
  nextReferenceHash,
  pickTexts,
  readHashes,
  textEntries,
  textTranslationStatus,
  translatedEntries,
  type TextRules,
  type TextTranslationStatus,
} from '../../common/i18n/text-translation.js';
import { translationFor } from '../../common/i18n/translations.js';
import { asObject, type JsonObject } from '../../common/json/json-read.js';
import type { ProblemFieldError } from '../../common/problem/problem.js';

/**
 * Version anglaise des services et des rubriques (colonne `translations` : `{ en: { …textes, sourceHashes } }`),
 * contrat `CatalogTranslations`.
 *
 * - Lecture publique : **textes seuls sur la structure française** (`applyTexts`) pour tous les champs traduisibles
 *   (y compris ceux qui ne se modifient pas dans le back-office) : icônes, images, liens, nombres, réglages et
 *   nombre d'éléments des listes sont toujours ceux du français.
 * - Back-office : seuls les champs modifiables en français s'éditent en anglais (`SERVICE_TEXT_FIELDS`,
 *   `CATEGORY_TEXT_FIELDS`) ; les textes anglais des autres champs (import) sont conservés tels quels.
 * - Suivi par champ de premier niveau : `sourceHashes[champ]` = empreinte des textes français traduits.
 */

/** Clés jamais traduites dans les blocs du catalogue (`name`, `type`… des champs du devis, liens, visuels…). */
export const CATALOG_NON_TEXT_KEYS: ReadonlySet<string> = new Set([
  'id',
  'icon',
  'imageId',
  'image',
  'illustration',
  'kind',
  'href',
  'external',
  'serviceSlugs',
  'name',
  'type',
  'width',
  'required',
  'min',
  'max',
]);

/**
 * Règles des textes du catalogue. Appliquées champ par champ : la clé `name` n'est écartée qu'à l'intérieur des
 * blocs (nom technique d'un champ du devis), jamais pour le nom du service ou de la rubrique.
 */
export const CATALOG_TEXT_RULES: TextRules = { nonTextKeys: CATALOG_NON_TEXT_KEYS };

/**
 * Règles des textes modifiables (objet `{ champ: valeur }` parcouru d'un bloc) : seule l'icône des avantages n'est
 * pas un texte.
 */
const EDITABLE_TEXT_RULES: TextRules = { nonTextKeys: new Set(['icon']) };

/** Textes d'un service modifiables dans le back-office (forme `ServiceTexts`). */
export const SERVICE_TEXT_FIELDS = [
  'name',
  'tagline',
  'summary',
  'audiences',
  'steps',
  'advantages',
  'faq',
  'seoTitle',
  'seoDescription',
] as const;

/** Textes d'une rubrique modifiables dans le back-office (forme `CategoryTexts`). */
export const CATEGORY_TEXT_FIELDS = [
  'name',
  'tagline',
  'description',
  'eyebrow',
  'heroTitle',
  'heroLead',
  'audiencesTitle',
  'servicesTitle',
  'servicesLead',
  'processTitle',
  'ctaTitle',
  'ctaText',
  'homeCard',
  'seoTitle',
  'seoDescription',
] as const;

/** Champs listés d'un enregistrement du catalogue dans la langue demandée (textes seuls). */
export function localizeCatalog<T extends object, K extends keyof T>(
  record: T,
  translations: unknown,
  lang: Lang,
  fields: readonly K[],
): T {
  const english = translationFor(translations, lang);
  return english === undefined ? record : localizeTexts(record, english, CATALOG_TEXT_RULES, fields);
}

/** Champ `translations` d'un enregistrement (`CatalogTranslations` du contrat). */
export interface CatalogTranslationsInput {
  en: JsonObject | null;
  reviewedFields?: string[] | undefined;
}

/** Champs `translations` / `translationStatus` renvoyés par le back-office. */
export interface CatalogTranslationView {
  translations: { en: JsonObject | null };
  translationStatus: { en: TextTranslationStatus };
}

const englishOf = (translations: unknown): JsonObject => asObject(asObject(translations)['en']);

/** Textes français modifiables d'un enregistrement (`{ champ: valeur }`). */
function frenchTexts(fields: readonly string[], record: object): JsonObject {
  const source = record as JsonObject;
  return Object.fromEntries(fields.map((field) => [field, source[field] ?? null]));
}

const inField = (field: string) => (path: string) => path === field || path.startsWith(`${field}.`);

/** Empreinte des textes français d'un champ de premier niveau ; `null` sans texte. */
function fieldTextsHash(source: JsonObject, field: string): string | null {
  return hashTexts(textEntries(source, EDITABLE_TEXT_RULES).filter(([path]) => inField(field)(path)));
}

/** Textes anglais retenus (forme partielle du français) ; `{}` sans traduction. */
const picked = (source: JsonObject, english: unknown): JsonObject =>
  asObject(pickTexts(source, english, EDITABLE_TEXT_RULES));

/**
 * Version anglaise pour le back-office : textes anglais des champs modifiables (dont le français est renseigné) et
 * statut par champ de premier niveau (« à traduire » s'il manque un de ses textes). Une traduction sans empreinte
 * (antérieure au suivi) est considérée à jour.
 */
export function catalogTranslationView(
  fields: readonly string[],
  record: object,
  translations: unknown,
): CatalogTranslationView {
  const source = frenchTexts(fields, record);
  const english = englishOf(translations);
  const hashes = readHashes(english['sourceHashes']);
  const texts = textEntries(source, EDITABLE_TEXT_RULES).map(([path]) => path);
  const translated = new Set(translatedEntries(source, english, EDITABLE_TEXT_RULES).map(([path]) => path));
  const units = fields.map((field) => {
    const own = texts.filter(inField(field));
    return {
      id: field,
      hash: fieldTextsHash(source, field),
      translated: own.length > 0 && own.every((path) => translated.has(path)),
      reference: hashes[field] ?? null,
    };
  });
  const en = picked(source, english);
  return {
    translations: { en: Object.keys(en).length === 0 ? null : en },
    translationStatus: { en: textTranslationStatus(units) },
  };
}

/** `reviewedFields` : chaque champ doit être un champ modifiable traduit (`422` sur `translations.reviewedFields.N`). */
export function reviewedCatalogFieldErrors(
  fields: readonly string[],
  record: object,
  input: CatalogTranslationsInput,
): ProblemFieldError[] {
  const en = picked(frenchTexts(fields, record), input.en);
  return (input.reviewedFields ?? []).flatMap((field, index): ProblemFieldError[] =>
    fields.includes(field) && en[field] !== undefined
      ? []
      : [
          {
            path: `translations.reviewedFields.${String(index)}`,
            code: 'unknown_field',
            message: 'Ce champ n’a pas de traduction anglaise à marquer comme revue.',
          },
        ],
  );
}

/**
 * Colonne `translations` à enregistrer avec les nouveaux textes français (`french`) :
 * - textes anglais des champs modifiables : ceux envoyés (`input.en`, `null` = supprimer), sinon ceux déjà
 *   enregistrés, réduits aux textes dont le français est renseigné (structure du français) ;
 * - textes anglais des autres champs (import) et autres langues : conservés ;
 * - empreinte par champ : celle des textes français actuels si la traduction du champ est nouvelle, modifiée ou
 *   marquée revue ; sinon l'empreinte gardée, à défaut celle des textes français précédents (`previousFrench`,
 *   traduction antérieure au suivi).
 * `null` : plus aucune traduction.
 */
export function nextCatalogTranslations(options: {
  fields: readonly string[];
  previousFrench: object | null;
  french: object;
  stored: unknown;
  input: CatalogTranslationsInput | undefined;
}): JsonObject | null {
  const { fields, previousFrench, french, stored, input } = options;
  const before = englishOf(stored);
  const source = frenchTexts(fields, french);
  const previous = previousFrench === null ? null : frenchTexts(fields, previousFrench);
  const texts = picked(source, input === undefined ? before : input.en);
  const kept = picked(source, before);
  const hashes = readHashes(before['sourceHashes']);
  const reviewed = new Set(input?.reviewedFields ?? []);
  const sourceHashes: Record<string, string> = {};
  for (const field of fields) {
    if (texts[field] === undefined) continue;
    const hash = nextReferenceHash({
      current: fieldTextsHash(source, field),
      unchanged: JSON.stringify(texts[field]) === JSON.stringify(kept[field]),
      reviewed: reviewed.has(field),
      stored: hashes[field],
      fallback: previous === null ? null : fieldTextsHash(previous, field),
    });
    if (hash !== null) sourceHashes[field] = hash;
  }
  const others = Object.fromEntries(
    Object.entries(before).filter(([key]) => key !== 'sourceHashes' && !fields.includes(key)),
  );
  const en: JsonObject = { ...others, ...texts };
  const { en: _en, ...languages } = asObject(stored);
  if (Object.keys(en).length === 0) return Object.keys(languages).length === 0 ? null : languages;
  return {
    ...languages,
    en: Object.keys(sourceHashes).length === 0 ? en : { ...en, sourceHashes },
  };
}
