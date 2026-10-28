import { z } from 'zod';
import { optionalParam } from '../../common/pagination/pagination.js';
import {
  faqItemSchema,
  iconSchema,
  iconTextItemSchema,
  idSchema,
  illustrationSchema,
  linkSchema,
  nullableText,
  slugSchema,
  stepItemSchema,
} from '../../common/validation/content.schemas.js';

/** Paramètres et corps des opérations « Admin — Services » du contrat (services et rubriques). */

const PUBLISH_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;
export const publishStatusSchema = z.enum(PUBLISH_STATUSES, { error: 'Statut inconnu.' });

/** Liste d'identifiants sans doublon (le premier est gardé). */
function idList(max: number, message: string) {
  return z
    .array(idSchema)
    .max(max, { error: message })
    .transform((ids) => [...new Set(ids)]);
}

/** `GET /v1/admin/services` */
export const listAdminServicesQuerySchema = z.object({
  category: optionalParam(slugSchema),
  status: optionalParam(publishStatusSchema),
  q: optionalParam(z.string().trim().max(120)),
});
export type ListAdminServicesQuery = z.output<typeof listAdminServicesQuerySchema>;

/** Schéma `ServiceOfferInput` du contrat (carte du carrousel « Nos offres »). */
export const offerInputSchema = z.object({
  id: idSchema.nullable().optional(),
  title: z.string().trim().min(2).max(80),
  titleMobile: nullableText(60).optional(),
  text: z.string().trim().min(2).max(200),
  textMobile: nullableText(160).optional(),
  icon: iconSchema.nullable().optional(),
  illustration: illustrationSchema.optional(),
  imageId: idSchema.nullable().optional(),
  action: z.enum(['QUOTE', 'BOOKING'], { error: 'Action : QUOTE (devis) ou BOOKING (rendez-vous).' }),
  actionLabel: z.string().trim().min(2).max(40),
  actionLabelMobile: nullableText(24).optional(),
  serviceId: idSchema.nullable().optional(),
});
export type OfferInput = z.output<typeof offerInputSchema>;

// ─────────────────────────── Version anglaise (`CatalogTranslations`) ───────────────────────────

/** Texte anglais : vide ou `null` = texte français (limites du français). */
const englishString = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { error: `${String(max)} caractères au maximum.` })
    .nullable();
const englishText = (max: number) => englishString(max).optional();

/** Champ `translations` : textes anglais (`en`, `null` = supprimer) et champs marqués revus. */
const catalogTranslationsInput = <T extends z.ZodType>(texts: T) =>
  z
    .object({
      en: texts.nullable(),
      reviewedFields: z.array(z.string().min(1).max(60)).max(40).optional(),
    })
    .optional();

const englishItems = <T extends z.ZodType>(item: T, max: number) =>
  z.array(item.nullable()).max(max).optional();

/** Schéma `ServiceTexts` (les autres clés envoyées sont ignorées). */
const serviceTextsSchema = z.object({
  name: englishText(120),
  tagline: englishText(120),
  summary: englishText(240),
  audiences: z.array(englishString(200)).max(12).optional(),
  steps: englishItems(z.object({ title: englishText(120), text: englishText(600) }), 10),
  advantages: englishItems(z.object({ title: englishText(120), text: englishText(600) }), 8),
  faq: englishItems(z.object({ question: englishText(200), answer: englishText(2000) }), 20),
  seoTitle: englishText(60),
  seoDescription: englishText(160),
});

/** Schéma `CategoryTexts`. */
const categoryTextsSchema = z.object({
  name: englishText(80),
  tagline: englishText(120),
  description: englishText(600),
  eyebrow: englishText(60),
  heroTitle: englishText(400),
  heroLead: englishText(400),
  audiencesTitle: englishText(160),
  servicesTitle: englishText(160),
  servicesLead: englishText(300),
  processTitle: englishText(160),
  ctaTitle: englishText(120),
  ctaText: englishText(300),
  homeCard: z
    .object({
      title: englishText(80),
      text: englishText(200),
      textMobile: englishText(120),
      chips: z.array(englishString(40)).max(6).optional(),
    })
    .optional(),
  seoTitle: englishText(60),
  seoDescription: englishText(160),
});

/** Champs `ServiceFields` du contrat. */
const serviceFieldsSchema = z.object({
  name: z
    .string({ error: 'Indiquez le nom du service.' })
    .trim()
    .min(2, { error: 'Le nom doit compter au moins 2 caractères.' })
    .max(120),
  shortName: nullableText(80),
  categoryId: z
    .string({ error: 'Choisissez une rubrique.' })
    .min(1, { error: 'Choisissez une rubrique.' })
    .max(64),
  slug: slugSchema,
  tagline: z.string().trim().max(120),
  summary: z.string().trim().max(240),
  icon: iconSchema,
  illustration: illustrationSchema,
  coverImageId: idSchema.nullable(),
  galleryImageIds: idList(3, '3 visuels au maximum.'),
  cities: z.array(z.string().trim().min(1).max(60)).max(20),
  audiences: z.array(z.string().trim().min(1).max(200)).max(12),
  steps: z.array(stepItemSchema).max(10),
  advantages: z.array(iconTextItemSchema).max(8),
  faq: z.array(faqItemSchema).max(20),
  quoteBullets: z.array(z.string().trim().min(1).max(120)).max(5),
  offersEyebrow: nullableText(40),
  offersTitle: nullableText(120),
  offersLead: nullableText(200),
  offersLeadMobile: nullableText(120),
  offers: z.array(offerInputSchema).max(12),
  relatedServiceIds: idList(6, '6 services liés au maximum.'),
  featuredReviewIds: idList(6, '6 témoignages au maximum.'),
  showInMenu: z.boolean(),
  featuredOnHome: z.boolean(),
  showWhatsapp: z.boolean(),
  reviewsTitle: nullableText(120),
  relatedTitle: nullableText(120),
  ctaTitle: nullableText(120),
  ctaText: nullableText(300),
  seoTitle: nullableText(60),
  seoDescription: nullableText(160),
  toComplete: z.boolean(),
  translations: catalogTranslationsInput(serviceTextsSchema),
});

/** `ServicePatch` : mise à jour partielle (au moins un champ). */
export const servicePatchSchema = serviceFieldsSchema
  .partial()
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), {
    error: 'Aucune modification envoyée.',
  });
export type ServicePatch = z.output<typeof servicePatchSchema>;

/** `ServiceInput` : nom, rubrique et accroche obligatoires ; le reste est pré-rempli. */
export const serviceInputSchema = serviceFieldsSchema.partial().extend({
  name: serviceFieldsSchema.shape.name,
  categoryId: serviceFieldsSchema.shape.categoryId,
  tagline: z
    .string({ error: 'Écrivez une phrase d’accroche.' })
    .trim()
    .min(1, { error: 'Écrivez une phrase d’accroche.' })
    .max(120),
});
export type ServiceInput = z.output<typeof serviceInputSchema>;

/** Schéma `ReorderInput` du contrat. */
export const reorderSchema = z.object({
  scope: z.string().trim().max(120).nullable().optional(),
  ids: z
    .array(idSchema, { error: 'Ordre manquant.' })
    .min(1, { error: 'Ordre manquant.' })
    .max(500)
    .refine((ids) => new Set(ids).size === ids.length, {
      error: 'Un élément figure deux fois dans l’ordre.',
    }),
});
export type ReorderInput = z.output<typeof reorderSchema>;

// ─────────────────────────────── Rubriques ───────────────────────────────

const TINTS = ['orange-50', 'neutral-100', 'vert-50', 'neutral-900'] as const;
export type ContractTint = (typeof TINTS)[number];

const quoteFieldSchema = z.object({
  name: z.string().regex(/^[a-z][a-zA-Z0-9]*$/, { error: 'Nom technique en camelCase (ex. eventDate).' }),
  label: z.string().trim().min(1).max(120),
  type: z.enum(['text', 'textarea', 'date', 'number', 'select', 'chips', 'city']),
  required: z.boolean(),
  placeholder: nullableText(120).optional(),
  helpText: nullableText(300).optional(),
  options: z.array(z.string().trim().min(1).max(120)).max(30).optional(),
  min: z.number().finite().nullable().optional(),
  max: z.number().finite().nullable().optional(),
  width: z.enum(['full', 'half']).optional(),
});

const highlightSchema = z.object({
  kind: z.enum(['PARCEL_RECEPTION', 'AGENDA', 'STEPS_BAND']),
  eyebrow: nullableText(80).optional(),
  title: z.string().trim().min(1).max(400),
  text: nullableText(600).optional(),
  steps: z.array(iconTextItemSchema).max(8).optional(),
  note: nullableText(400).optional(),
  link: linkSchema.nullable().optional(),
});

const offerSectionSchema = z.object({
  id: idSchema.nullable().optional(),
  eyebrow: z.string().trim().min(1).max(40),
  title: z.string().trim().min(1).max(120),
  titleMobile: nullableText(80).optional(),
  lead: nullableText(200).optional(),
  leadMobile: nullableText(120).optional(),
  offers: z.array(offerInputSchema).max(12),
});
export type OfferSectionInput = z.output<typeof offerSectionSchema>;

/** Champs `CategoryFields` du contrat. */
const categoryFieldsSchema = z.object({
  name: z
    .string({ error: 'Indiquez le nom de la rubrique.' })
    .trim()
    .min(1, { error: 'Indiquez le nom de la rubrique.' })
    .max(80),
  slug: slugSchema,
  tagline: z
    .string({ error: 'Écrivez une accroche.' })
    .trim()
    .min(1, { error: 'Écrivez une accroche.' })
    .max(120),
  description: z
    .string({ error: 'Écrivez une description.' })
    .trim()
    .min(1, { error: 'Écrivez une description.' })
    .max(600),
  eyebrow: nullableText(60),
  heroTitle: z.string().trim().min(1).max(400),
  heroLead: z.string().trim().max(400),
  audiencesTitle: nullableText(160),
  servicesTitle: nullableText(160),
  servicesLead: nullableText(300),
  processTitle: nullableText(160),
  homeCard: z.object({
    title: z.string().trim().max(80).optional(),
    text: z.string().trim().max(200).optional(),
    textMobile: nullableText(120).optional(),
    chips: z.array(z.string().trim().min(1).max(40)).max(6).optional(),
  }),
  icon: z.string({ error: 'Indiquez une icône.' }).pipe(iconSchema),
  illustration: illustrationSchema,
  imageId: idSchema.nullable(),
  tint: z.enum(TINTS, { error: 'Choisissez une teinte.' }),
  status: publishStatusSchema,
  audiences: z.array(iconTextItemSchema).max(6),
  processSteps: z.array(stepItemSchema).max(8),
  testimonialId: idSchema.nullable(),
  groups: z
    .array(z.object({ title: z.string().trim().min(1).max(120), serviceSlugs: z.array(slugSchema).max(40) }))
    .max(12),
  highlight: highlightSchema.nullable(),
  offerSections: z.array(offerSectionSchema).max(4),
  quoteFields: z.array(quoteFieldSchema).max(12),
  ctaTitle: nullableText(120),
  ctaText: nullableText(300),
  seoTitle: nullableText(60),
  seoDescription: nullableText(160),
  translations: catalogTranslationsInput(categoryTextsSchema),
});

export const categoryPatchSchema = categoryFieldsSchema
  .partial()
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), {
    error: 'Aucune modification envoyée.',
  });
export type CategoryPatch = z.output<typeof categoryPatchSchema>;

export const categoryInputSchema = categoryFieldsSchema.partial().extend({
  name: categoryFieldsSchema.shape.name,
  tagline: categoryFieldsSchema.shape.tagline,
  description: categoryFieldsSchema.shape.description,
  icon: categoryFieldsSchema.shape.icon,
  tint: z.enum(TINTS, { error: 'Choisissez une teinte.' }),
});
export type CategoryInput = z.output<typeof categoryInputSchema>;
