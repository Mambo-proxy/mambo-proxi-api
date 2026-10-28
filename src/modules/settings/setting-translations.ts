import type { Lang } from '../../common/i18n/lang.js';
import {
  applyTexts,
  textAt,
  fieldHash,
  nextReferenceHash,
  pickTexts,
  readHashes,
  textEntries,
  textTranslationStatus,
  translatedEntries,
  type TextRules,
  type TextTranslationStatus,
} from '../../common/i18n/text-translation.js';
import { isPlainObject, localize } from '../../common/i18n/translations.js';
import { asObject, type JsonObject } from '../../common/json/json-read.js';
import type { ProblemFieldError } from '../../common/problem/problem.js';
import type { SettingKey } from './settings.constants.js';

/**
 * Version anglaise des paramètres (colonne `translations` : `{ en: { …textes, sourceHashes } }`), saisie à la main
 * dans le back-office.
 *
 * Pour les groupes qui ont des textes (`SETTING_TEXT_PATHS`), seuls les chemins de la liste blanche viennent de
 * l'anglais, à l'enregistrement comme à la lecture : numéros, adresses e-mail, coordonnées GPS, liens et nombres
 * sont toujours ceux du français (une valeur non textuelle restée dans une ancienne traduction est ignorée).
 * `sourceHashes` garde, par chemin traduit, l'empreinte du texte français traduit (statut « à revoir »).
 */

/** Chemins des textes traduisibles de chaque groupe (`*` = n'importe quel rang). */
export const SETTING_TEXT_PATHS: Partial<Record<SettingKey, readonly string[]>> = {
  coordonnees: [
    'hoursLabel',
    'agency.name',
    'agency.addressLines.*',
    'agency.openingHours.*.label',
    'agency.openingHours.*.hours',
    'agency.parcelReceptionNote',
  ],
  whatsapp: ['message'],
  seo: ['defaultTitle', 'defaultDescription'],
  chiffres: [
    'keyFigures.*.label',
    'keyFigures.*.labelMobile',
    'keyFigures.*.suffix',
    'keyFigures.*.valueText',
  ],
};

export function settingTextRules(key: string): TextRules | null {
  const paths = SETTING_TEXT_PATHS[key as SettingKey];
  return paths === undefined ? null : { paths };
}

/** Valeur d'un groupe dans la langue demandée (site public, e-mails). */
export function localizeSetting(key: string, value: unknown, translations: unknown, lang: Lang): unknown {
  if (lang === 'fr') return value;
  const rules = settingTextRules(key);
  if (rules === null) return localize(value, translations, lang);
  return applyTexts(value, asObject(translations)[lang], rules);
}

/** Champs `translations` / `translationStatus` renvoyés par le back-office pour un groupe qui a des textes. */
export interface SettingTranslationView {
  translations: { en: JsonObject | null };
  translationStatus: { en: TextTranslationStatus };
}

const englishOf = (translations: unknown): JsonObject => asObject(asObject(translations)['en']);

/**
 * Version anglaise d'un groupe pour le back-office : textes anglais (chemins de la liste blanche dont le français
 * est renseigné) et statut par chemin. Une traduction sans empreinte (antérieure au suivi) est considérée à jour.
 */
export function settingTranslationView(
  key: string,
  french: JsonObject,
  translations: unknown,
): SettingTranslationView | null {
  const rules = settingTextRules(key);
  if (rules === null) return null;
  const english = englishOf(translations);
  const hashes = readHashes(english['sourceHashes']);
  const units = textEntries(french, rules).map(([path, text]) => ({
    id: path,
    hash: fieldHash(text),
    translated: textAt(english, path) !== null,
    reference: hashes[path] ?? null,
  }));
  const texts = pickTexts(french, english, rules);
  return {
    translations: { en: isPlainObject(texts) ? texts : null },
    translationStatus: { en: textTranslationStatus(units) },
  };
}

/** Champ `translations` d'un `PUT /v1/admin/settings/{group}` (`SettingsTranslationsInput`). */
export interface SettingTranslationsInput {
  en: JsonObject | null;
  reviewedFields?: string[] | undefined;
}

/**
 * `reviewedFields` : chaque chemin doit être un texte traduit du groupe enregistré (`422` sur
 * `translations.reviewedFields.N` sinon).
 */
export function reviewedFieldErrors(
  key: string,
  french: JsonObject,
  input: SettingTranslationsInput,
): ProblemFieldError[] {
  const rules = settingTextRules(key);
  const reviewed = input.reviewedFields ?? [];
  if (rules === null || reviewed.length === 0) return [];
  const translated = new Set(translatedEntries(french, input.en, rules).map(([path]) => path));
  return reviewed.flatMap((path, index): ProblemFieldError[] =>
    translated.has(path)
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
 * Colonne `translations` à enregistrer avec la nouvelle valeur française d'un groupe qui a des textes :
 * - textes anglais : ceux envoyés (`input.en`, `null` = supprimer la traduction), sinon ceux déjà enregistrés,
 *   réduits aux chemins de la liste blanche dont le français est renseigné ;
 * - empreinte par chemin : celle du texte français actuel si le texte anglais est nouveau, modifié ou marqué revu,
 *   sinon l'empreinte gardée, à défaut celle du texte français précédent (traduction antérieure au suivi).
 * `undefined` : groupe sans textes, colonne inchangée.
 */
export function nextSettingTranslations(options: {
  key: string;
  previousFrench: JsonObject;
  french: JsonObject;
  stored: unknown;
  input: SettingTranslationsInput | undefined;
}): JsonObject | null | undefined {
  const { key, previousFrench, french, stored, input } = options;
  const rules = settingTextRules(key);
  if (rules === null) return undefined;
  const before = englishOf(stored);
  const english = input === undefined ? before : input.en;
  const hashes = readHashes(before['sourceHashes']);
  const reviewed = new Set(input?.reviewedFields ?? []);
  const texts = pickTexts(french, english, rules);
  const sourceHashes: Record<string, string> = {};
  for (const [path, text] of translatedEntries(french, english, rules)) {
    const hash = nextReferenceHash({
      current: fieldHash(textAt(french, path)),
      unchanged: textAt(before, path) === text,
      reviewed: reviewed.has(path),
      stored: hashes[path],
      fallback: fieldHash(textAt(previousFrench, path)),
    });
    if (hash !== null) sourceHashes[path] = hash;
  }
  const { en: _en, ...others } = asObject(stored);
  if (!isPlainObject(texts)) return Object.keys(others).length === 0 ? null : others;
  return { ...others, en: { ...texts, sourceHashes } };
}
