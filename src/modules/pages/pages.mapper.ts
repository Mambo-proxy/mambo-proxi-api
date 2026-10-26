import type { Lang } from '../../common/i18n/lang.js';
import { localizeFields } from '../../common/i18n/translations.js';
import {
  asObject,
  asObjectArray,
  readBoolean,
  readNullableString,
  type JsonObject,
} from '../../common/json/json-read.js';
import type { Prisma } from '../../generated/prisma/client.js';

/** Clés de page du contrat (`PageKey`). */
export const PAGE_KEYS = [
  'accueil',
  'services',
  'zones-d-intervention',
  'magazine',
  'qui-sommes-nous',
  'mission',
  'partenaires',
  'formation',
  'recrutement',
  'avis-clients',
  'contact',
  'devis',
  'devis-confirmation',
  'inscription',
  'suivi-mambo',
  'questionnaire',
  'mentions-legales',
  'confidentialite',
  'cookies',
  'cgu',
  '404',
  'erreur',
  'maintenance',
  'newsletter-confirmation',
  'newsletter-desinscription',
] as const;
export type PageKey = (typeof PAGE_KEYS)[number];

const PAGE_KEY_SET: ReadonlySet<string> = new Set(PAGE_KEYS);

export function isPageKey(value: string): value is PageKey {
  return PAGE_KEY_SET.has(value);
}

/** Types de sections du contrat (`PageSectionType`). */
const SECTION_TYPES: ReadonlySet<unknown> = new Set([
  'hero',
  'marquee',
  'steps',
  'featureList',
  'cardGrid',
  'textMedia',
  'quote',
  'statsGrid',
  'team',
  'faq',
  'richText',
  'ctaBand',
  'dynamic',
]);

/** Version publiée d'une page (le brouillon n'est jamais lu ici). */
export const publishedPageSelect = {
  key: true,
  title: true,
  sections: true,
  seo: true,
  translations: true,
  publishedAt: true,
} satisfies Prisma.PageSelect;

export type PublishedPageRecord = Prisma.PageGetPayload<{ select: typeof publishedPageSelect }>;

/** Champs traduits d'une page (`translations.en` : `{ title, sections, seo }`). */
const PAGE_FIELDS = ['title', 'sections', 'seo'] as const;

/** Schéma `Page` du contrat. */
export interface Page {
  key: PageKey;
  title: string;
  sections: JsonObject[];
  seo: { title: string | null; description: string | null; ogImageUrl: string | null; noindex: boolean };
  isPreview: boolean;
  updatedAt: string;
}

/** Page publiée dans la langue demandée (les références d'images des sections sont résolues ensuite). */
export function localizePage(page: PublishedPageRecord, lang: Lang): PublishedPageRecord {
  return localizeFields(page, page.translations, lang, PAGE_FIELDS);
}

/** Sections visibles : sections valides dont l'interrupteur `enabled` n'est pas désactivé, dans l'ordre enregistré. */
export function visibleSections(sections: unknown): JsonObject[] {
  return asObjectArray(sections).filter(
    (section) =>
      typeof section['id'] === 'string' && SECTION_TYPES.has(section['type']) && section['enabled'] !== false,
  );
}

function toSeo(value: unknown): Page['seo'] {
  const seo = asObject(value);
  const ogImageUrl = readNullableString(seo, 'ogImageUrl');
  return {
    title: readNullableString(seo, 'title'),
    description: readNullableString(seo, 'description'),
    ogImageUrl: ogImageUrl !== null && /^https?:\/\//.test(ogImageUrl) ? ogImageUrl : null,
    noindex: readBoolean(seo, 'noindex', false),
  };
}

/** `Page` publiée (`publishedAt` renseigné), sections déjà traduites et résolues. */
export function toPage(
  page: PublishedPageRecord & { key: PageKey },
  sections: JsonObject[],
  publishedAt: Date,
): Page {
  return {
    key: page.key,
    title: page.title,
    sections,
    seo: toSeo(page.seo),
    isPreview: false,
    updatedAt: publishedAt.toISOString(),
  };
}
