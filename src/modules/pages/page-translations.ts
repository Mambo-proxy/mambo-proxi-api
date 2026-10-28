import {
  applyTexts,
  nextReferenceHash,
  readHashes,
  textEntries,
  textHash,
  unitsStatus,
  type TextRules,
  type TranslationState,
} from '../../common/i18n/text-translation.js';
import { isPlainObject } from '../../common/i18n/translations.js';
import { asObject, asObjectArray, readNullableString, type JsonObject } from '../../common/json/json-read.js';
import type { ProblemFieldError } from '../../common/problem/problem.js';

/**
 * Version anglaise des pages (colonnes `translations` / `draftTranslations` :
 * `{ en: { title, sections, seo, sourceHashes } }`), éditée à la main dans le back-office.
 *
 * Règle unique (schéma `PageTranslationInput` du contrat) : seuls les **textes** viennent de l'anglais, tout le
 * reste (structure, images, liens, réglages d'affichage, `enabled`, ordre) est celui de la section française de même
 * `id`, à l'enregistrement comme à chaque lecture. `sourceHashes` garde, pour chaque section traduite, l'empreinte des
 * textes français au moment où la version anglaise a été enregistrée : une différence avec l'empreinte actuelle
 * signale une traduction périmée. Mécanique commune (textes, empreintes, statut) : `common/i18n/text-translation.ts`.
 */

/** Champs chaîne qui ne sont pas des textes à traduire : toujours ceux du français (sous-arbre compris). */
export const NON_TEXT_KEYS: ReadonlySet<string> = new Set([
  'id',
  'type',
  'variant',
  'tone',
  'layout',
  'icon',
  'href',
  'illustration',
  'image',
  'imageId',
  'source',
  'categorySlug',
  'anchor',
  'kind',
  'key',
  'number',
  'adminLabel',
]);

/** Règles des textes des pages (socle `text-translation`) : toutes les chaînes hors champs techniques. */
const PAGE_TEXT_RULES: TextRules = { nonTextKeys: NON_TEXT_KEYS };

/**
 * Textes anglais posés sur la structure française : une chaîne française non vide est remplacée par la chaîne
 * anglaise de même chemin si elle est renseignée ; listes élément par élément (nombre et ordre du français) ;
 * champs techniques, booléens et nombres du français ; ce qui n'existe pas en français est ignoré.
 */
export function applyEnglishTexts(french: unknown, english: unknown, key?: string): unknown {
  return applyTexts(french, english, PAGE_TEXT_RULES, key);
}

/** Textes d'une section (`[chemin, texte]`, triés par chemin) : ce qui se traduit. */
export function sectionTexts(section: unknown): [string, string][] {
  return textEntries(section, PAGE_TEXT_RULES);
}

/**
 * Empreinte stable des textes d'une section (sha256 de la liste triée `[chemin, texte]`, indépendante de l'ordre des
 * clés JSON) ; `null` si la section n'a aucun texte (rien à traduire).
 */
export function sectionTextHash(section: unknown): string | null {
  return textHash(section, PAGE_TEXT_RULES);
}

/** Version anglaise enregistrée (`translations.en`), lue prudemment. */
export interface EnglishVersion {
  title: string | null;
  sections: JsonObject[];
  seo: JsonObject;
  sourceHashes: Record<string, string>;
}

export function readEnglish(translations: unknown): EnglishVersion | null {
  const english = asObject(translations)['en'];
  if (!isPlainObject(english)) return null;
  return {
    title: readNullableString(english, 'title'),
    sections: asObjectArray(english['sections']).filter((section) => typeof section['id'] === 'string'),
    seo: asObject(english['seo']),
    sourceHashes: readHashes(english['sourceHashes']),
  };
}

/** Section anglaise équivalente à une section française (même `id`, type identique ou non précisé). */
function englishFor(french: JsonObject, english: Map<unknown, JsonObject>): JsonObject | undefined {
  const section = english.get(french['id']);
  if (section === undefined) return undefined;
  return section['type'] === undefined || section['type'] === french['type'] ? section : undefined;
}

function byId(sections: JsonObject[]): Map<unknown, JsonObject> {
  return new Map(sections.map((section) => [section['id'], section]));
}

/** Lecture anglaise : chaque section française, recouverte de ses textes anglais s'ils existent. */
export function translateSections(french: JsonObject[], english: JsonObject[]): JsonObject[] {
  const translated = byId(english);
  return french.map((section) => {
    const match = englishFor(section, translated);
    return match === undefined ? section : (applyEnglishTexts(section, match) as JsonObject);
  });
}

/** Sections françaises qui ont une version anglaise, recomposées (vue « version anglaise » du back-office). */
export function englishSections(french: JsonObject[], english: JsonObject[]): JsonObject[] {
  const translated = byId(english);
  return french.flatMap((section): JsonObject[] => {
    const match = englishFor(section, translated);
    return match === undefined ? [] : [applyEnglishTexts(section, match) as JsonObject];
  });
}

/** SEO anglais : seuls `title` et `description` sont traduits. */
export function translateSeo(french: unknown, english: JsonObject): JsonObject {
  const seo = asObject(french);
  return {
    ...seo,
    title: readNullableString(english, 'title') ?? seo['title'] ?? null,
    description: readNullableString(english, 'description') ?? seo['description'] ?? null,
  };
}

/** Schéma `PageTranslationStatus` du contrat. */
export interface TranslationStatus {
  state: TranslationState;
  missingSectionIds: string[];
  outdatedSectionIds: string[];
}

/**
 * Empreinte de référence d'une section anglaise : celle mémorisée, sinon (traduction antérieure au suivi) celle des
 * textes français publiés — une traduction du seed est à jour tant que le français publié n'a pas changé.
 */
function referenceHash(
  id: string,
  english: EnglishVersion,
  published: Map<unknown, JsonObject>,
): string | null {
  const stored = english.sourceHashes[id];
  if (stored !== undefined) return stored;
  const section = published.get(id);
  return section === undefined ? null : sectionTextHash(section);
}

/** État de la traduction anglaise par rapport aux sections françaises actuelles (brouillon s'il existe). */
export function translationStatus(
  french: JsonObject[],
  english: EnglishVersion | null,
  publishedFrench: JsonObject[],
): TranslationStatus {
  const translated = byId(english?.sections ?? []);
  const published = byId(publishedFrench);
  const units = french.flatMap((section) => {
    const id = section['id'];
    if (typeof id !== 'string') return [];
    const isTranslated = english !== null && englishFor(section, translated) !== undefined;
    return [
      {
        id,
        hash: sectionTextHash(section),
        translated: isTranslated,
        reference: english !== null && isTranslated ? referenceHash(id, english, published) : null,
      },
    ];
  });
  const { state, missing, outdated } = unitsStatus(units, english !== null);
  return { state, missingSectionIds: missing, outdatedSectionIds: outdated };
}

/**
 * Règles des `id` anglais : chaque section anglaise correspond à une section française de même `id` et de même
 * `type`, sans doublon, dans l'ordre du français (sous-suite : des sections françaises peuvent manquer).
 */
export function englishSectionErrors(
  french: readonly { id: string; type: string }[],
  english: readonly { id: string; type?: unknown }[],
  basePath: string,
): ProblemFieldError[] {
  const errors: ProblemFieldError[] = [];
  const rank = new Map(french.map((section, index) => [section.id, index]));
  const seen = new Set<string>();
  let last = -1;
  english.forEach((section, index) => {
    const path = `${basePath}.${String(index)}`;
    const position = rank.get(section.id);
    if (seen.has(section.id)) {
      errors.push({
        path: `${path}.id`,
        code: 'duplicate',
        message: 'Cette section est déjà traduite plus haut.',
      });
    } else if (position === undefined) {
      errors.push({
        path: `${path}.id`,
        code: 'unknown_section',
        message: 'Cette section n’existe pas dans la version française.',
      });
    } else if (position < last) {
      errors.push({
        path: `${path}.id`,
        code: 'section_order',
        message: 'Les sections anglaises doivent suivre l’ordre des sections françaises.',
      });
    } else {
      last = position;
      if (section.type !== undefined && section.type !== french[position]?.type) {
        errors.push({
          path: `${path}.type`,
          code: 'type_mismatch',
          message: 'La section anglaise doit être du même type que la section française.',
        });
      }
    }
    seen.add(section.id);
  });
  return errors;
}

/**
 * Sections marquées « revues » (`PageTranslationInput.reviewedSectionIds`) : chaque `id` doit être celui d'une
 * section anglaise du même envoi (`422` sur `translations.en.reviewedSectionIds.N` sinon).
 */
export function reviewedSectionErrors(
  english: readonly { id: string }[],
  reviewed: readonly string[],
  basePath: string,
): ProblemFieldError[] {
  const sent = new Set(english.map((section) => section.id));
  return reviewed.flatMap((id, index): ProblemFieldError[] =>
    sent.has(id)
      ? []
      : [
          {
            path: `${basePath}.${String(index)}`,
            code: 'unknown_section',
            message: 'Cette section ne fait pas partie de la version anglaise envoyée.',
          },
        ],
  );
}

/**
 * Empreinte à mémoriser pour une section anglaise enregistrée : celle des textes français actuels (`source`) si la
 * section est nouvelle, si ses textes anglais ont changé ou si elle est marquée revue ; sinon l'empreinte gardée
 * (une traduction inchangée reste périmée si le français a changé ; une traduction antérieure au suivi prend
 * l'empreinte du français publié).
 */
export function nextSourceHash(options: {
  source: JsonObject;
  section: JsonObject;
  before: JsonObject | undefined;
  stored: string | undefined;
  published: JsonObject | undefined;
  reviewed: boolean;
}): string | null {
  const { source, section, before, stored, published, reviewed } = options;
  return nextReferenceHash({
    current: sectionTextHash(source),
    unchanged:
      before !== undefined && sectionTextHash(applyEnglishTexts(source, before)) === sectionTextHash(section),
    reviewed,
    stored,
    fallback: published === undefined ? null : sectionTextHash(published),
  });
}

/**
 * Empreintes des traductions antérieures au suivi, posées à la publication : chaque section anglaise sans empreinte
 * reçoit celle des textes français publiés jusque-là (ceux qu'elle traduit), pour que les changements du français
 * publié ensuite la signalent périmée. `undefined` si rien ne change.
 */
export function stampLegacyHashes(
  translations: unknown,
  previousPublishedFrench: JsonObject[],
): JsonObject | undefined {
  if (!isPlainObject(translations)) return undefined;
  const english = readEnglish(translations);
  if (english === null) return undefined;
  const published = byId(previousPublishedFrench);
  const added: Record<string, string> = {};
  for (const section of english.sections) {
    const id = section['id'] as string;
    if (english.sourceHashes[id] !== undefined) continue;
    const source = published.get(id);
    const hash = source === undefined ? null : sectionTextHash(source);
    if (hash !== null) added[id] = hash;
  }
  if (Object.keys(added).length === 0) return undefined;
  return {
    ...translations,
    en: { ...asObject(translations['en']), sourceHashes: { ...english.sourceHashes, ...added } },
  };
}
