import { z } from 'zod';
import { sanitizeRichText } from '../../common/html/rich-text.js';
import {
  faqItemSchema,
  iconSchema,
  keyFigureSchema,
  linkSchema,
  nullableText,
  seoSchema,
  slugSchema,
  visualInputSchema,
} from '../../common/validation/content.schemas.js';

/**
 * Sections de pages (union `PageSection` du contrat, discriminée par `type`) : validées à chaque enregistrement du
 * brouillon. Les visuels sont enregistrés par référence au média (`{ illustration, imageId, alt }`) et le HTML des
 * articles (`richText`) est assaini (liste blanche de `common/html/rich-text.ts`). Les propriétés inconnues sont
 * ignorées.
 */

export const SECTION_TYPES = [
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
] as const;
export type SectionType = (typeof SECTION_TYPES)[number];

const accentText = z.string().trim().max(400);
const tone = z.enum(['light', 'muted', 'dark', 'green', 'orange']);
const optionalLink = linkSchema.nullable().optional();
const optionalVisual = visualInputSchema.nullable().optional();

const sectionBase = {
  id: z.string().trim().min(1).max(64),
  enabled: z.boolean(),
  adminLabel: nullableText(80).optional(),
  anchor: z
    .string()
    .regex(/^[a-z0-9-]+$/, { error: 'Lettres minuscules, chiffres et tirets uniquement (ex. notre-equipe).' })
    .nullable()
    .optional(),
  tone: tone.optional(),
  eyebrow: nullableText(80).optional(),
  title: accentText.nullable().optional(),
  lead: nullableText(600).optional(),
  titleMobile: accentText.nullable().optional(),
  // Chaîne vide = chapô masqué en mobile : gardée telle quelle.
  leadMobile: z.string().max(300).nullable().optional(),
};

const sectionItem = z.object({
  icon: iconSchema.nullable().optional(),
  number: nullableText(4).optional(),
  title: z.string().trim().min(1, { error: 'Indiquez un titre.' }).max(160),
  subtitle: nullableText(200).optional(),
  text: nullableText(800).optional(),
  textMobile: nullableText(300).optional(),
  visual: optionalVisual,
  tone: tone.optional(),
  chips: z.array(z.string().trim().max(60)).max(8).optional(),
  cta: optionalLink,
});

const hero = z.object({
  ...sectionBase,
  type: z.literal('hero'),
  title: accentText.min(1, { error: 'Ce champ est obligatoire.' }).nullable().optional(),
  variant: z.enum(['home', 'page', 'centered', 'legal']),
  badge: z
    .object({ tag: nullableText(60).optional(), text: z.string().trim().min(1).max(120) })
    .nullable()
    .optional(),
  primaryCta: optionalLink,
  secondaryCta: optionalLink,
  showWhatsapp: z.boolean().optional(),
  visual: optionalVisual,
  visualSecondary: optionalVisual,
  socialProof: nullableText(160).optional(),
  anchors: z.array(linkSchema).max(12).optional(),
  floatingCards: z
    .array(
      z.object({
        icon: iconSchema.nullable().optional(),
        title: z.string().trim().min(1).max(120),
        text: nullableText(200).optional(),
        progress: z.number().min(0).max(1).nullable().optional(),
        footnote: nullableText(120).optional(),
      }),
    )
    .max(3)
    .optional(),
  sticker: nullableText(60).optional(),
  updatedLabel: nullableText(120).optional(),
});

const marquee = z.object({
  ...sectionBase,
  type: z.literal('marquee'),
  items: z
    .array(z.string().trim().min(1, { error: 'Saisissez la mention ou supprimez-la.' }).max(60))
    .min(1, { error: 'Ajoutez au moins une mention.' })
    .max(30),
  itemsMobile: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
});

const steps = z.object({
  ...sectionBase,
  type: z.literal('steps'),
  layout: z.enum(['cards', 'timeline', 'rail']),
  items: z.array(sectionItem).min(1, { error: 'Ajoutez au moins une étape.' }).max(8),
  channelsLabel: nullableText(60).optional(),
  channels: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(60),
        kind: z.enum(['form', 'whatsapp', 'appointment', 'phone', 'email']),
      }),
    )
    .max(6)
    .optional(),
  note: nullableText(300).optional(),
});

const featureList = z.object({
  ...sectionBase,
  type: z.literal('featureList'),
  items: z.array(sectionItem).max(8),
  visual: optionalVisual,
  figures: z.array(keyFigureSchema).max(8).optional(),
});

const cardGrid = z.object({
  ...sectionBase,
  type: z.literal('cardGrid'),
  layout: z.enum(['cards', 'numbered', 'illustrated', 'horizontal', 'compact']),
  columns: z.number().int().min(1).max(4),
  items: z.array(sectionItem).max(12),
  cta: optionalLink,
});

const textMedia = z.object({
  ...sectionBase,
  type: z.literal('textMedia'),
  paragraphs: z
    .array(z.string().trim().min(1, { error: 'Saisissez le paragraphe ou supprimez-le.' }).max(1500))
    .max(8),
  visual: optionalVisual,
  reverse: z.boolean().optional(),
  chips: z.array(z.string().trim().min(1).max(40)).max(12).optional(),
  quote: nullableText(400).optional(),
  signature: nullableText(160).optional(),
  cta: optionalLink,
});

const quote = z.object({
  ...sectionBase,
  type: z.literal('quote'),
  text: z.string().trim().min(1, { error: 'Ce champ est obligatoire.' }).max(600),
  author: nullableText(120).optional(),
  role: nullableText(160).optional(),
  visual: optionalVisual,
});

const statsGrid = z.object({
  ...sectionBase,
  type: z.literal('statsGrid'),
  items: z.array(keyFigureSchema).max(8),
});

const team = z.object({
  ...sectionBase,
  type: z.literal('team'),
  members: z
    .array(
      z.object({
        name: z.string().trim().min(1, { error: 'Indiquez le nom.' }).max(80),
        role: z.string().trim().min(1, { error: 'Indiquez le rôle.' }).max(120),
        location: nullableText(80).optional(),
        visual: visualInputSchema,
      }),
    )
    .max(24),
});

const faq = z.object({
  ...sectionBase,
  type: z.literal('faq'),
  items: z.array(faqItemSchema).max(30),
});

const richText = z.object({
  ...sectionBase,
  type: z.literal('richText'),
  articles: z
    .array(
      z.object({
        title: z.string().trim().min(1, { error: 'Indiquez le titre de l’article.' }).max(160),
        html: z.string().max(200_000).transform(sanitizeRichText),
      }),
    )
    .max(60),
  toComplete: z.boolean().optional(),
});

const ctaBand = z.object({
  ...sectionBase,
  type: z.literal('ctaBand'),
  text: nullableText(300).optional(),
  textMobile: nullableText(200).optional(),
  primaryCta: optionalLink,
  secondaryCta: optionalLink,
  showWhatsapp: z.boolean().optional(),
});

export const DYNAMIC_SOURCES = [
  'categories-bento',
  'categories-list',
  'reviews-highlight',
  'reviews-list',
  'partners-strip',
  'partners-grid',
  'trainings-catalog',
  'jobs-list',
  'contact-cards',
  'appointment-booking',
  'agency-map',
  'quote-form',
  'registration-form',
  'partner-form',
  'training-form',
  'application-form',
  'suivi-preview',
  'formulas',
  'zones-map',
] as const;

const dynamic = z.object({
  ...sectionBase,
  type: z.literal('dynamic'),
  source: z.enum(DYNAMIC_SOURCES),
  categorySlug: slugSchema.nullable().optional(),
  link: optionalLink,
  limit: z.number().int().min(1).max(50).nullable().optional(),
  note: nullableText(400).optional(),
  visual: optionalVisual,
  items: z.array(sectionItem).max(12).optional(),
});

export const pageSectionSchema = z.discriminatedUnion(
  'type',
  [
    hero,
    marquee,
    steps,
    featureList,
    cardGrid,
    textMedia,
    quote,
    statsGrid,
    team,
    faq,
    richText,
    ctaBand,
    dynamic,
  ],
  { error: 'Type de section inconnu.' },
);
export type PageSectionInput = z.output<typeof pageSectionSchema>;

/**
 * Section anglaise (`PageTranslationInput.sections`) : seuls `id` et `type` sont lus ici ; les textes sont posés
 * sur la section française de même `id` puis validés avec `pageSectionSchema` (voir `AdminPagesService`).
 */
const translationSectionSchema = z
  .object({ id: z.string().trim().min(1).max(64), type: z.string().max(40).optional() })
  .loose();

/** Schéma `PageTranslationInput` du contrat. */
export const pageTranslationSchema = z.object({
  title: nullableText(160).optional(),
  sections: z
    .array(translationSectionSchema, { error: 'La version anglaise doit contenir la liste des sections.' })
    .max(40, { error: 'Une page compte au plus 40 sections.' }),
  seo: seoSchema.optional(),
  reviewedSectionIds: z
    .array(z.string().trim().min(1).max(64), { error: 'Liste des sections revues invalide.' })
    .max(40, { error: 'Au plus 40 sections peuvent être marquées revues.' })
    .optional(),
});
export type PageTranslationInput = z.output<typeof pageTranslationSchema>;

/** Schéma `PageDraftInput` du contrat. */
export const pageDraftSchema = z.object({
  sections: z
    .array(pageSectionSchema, { error: 'Le brouillon doit contenir la liste des sections.' })
    .max(40, { error: 'Une page compte au plus 40 sections.' }),
  seo: seoSchema.optional(),
  translations: z.object({ en: pageTranslationSchema.optional() }).optional(),
});
export type PageDraftInput = z.output<typeof pageDraftSchema>;
