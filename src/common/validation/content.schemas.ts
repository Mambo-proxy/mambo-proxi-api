import { z } from 'zod';

/**
 * Briques zod des contenus éditables du back-office (schémas communs du contrat : `Id`, `Slug`, `IconName`,
 * `IllustrationScene`, `Link`, `Visual`, `StepItem`, `IconTextItem`, `FaqItem`, `KeyFigure`, `Seo`). Messages en
 * français ; les messages génériques (longueurs, types) viennent de `frenchErrorMap`.
 */

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SLUG_MESSAGE = 'Adresse invalide : lettres minuscules, chiffres et tirets uniquement.';

export const idSchema = z.string().min(1).max(64);
export const slugSchema = z.string().trim().max(120).regex(SLUG_PATTERN, { error: SLUG_MESSAGE });
export const iconSchema = z
  .string()
  .max(48)
  .regex(/^[A-Z][A-Za-z0-9]*$/, { error: 'Nom d’icône invalide (ex. « Sparkles », « Building2 »).' });

export const ILLUSTRATIONS = [
  'accueil',
  'chef',
  'colis',
  'courses',
  'culture',
  'equipe',
  'evenement',
  'formation',
  'livraison',
  'logement',
  'marche',
  'massage',
  'photo',
  'portrait',
  'voiture',
] as const;
export const illustrationSchema = z.enum(ILLUSTRATIONS, { error: 'Illustration inconnue.' });

/** Texte facultatif : `null`, ou chaîne (une chaîne vide est enregistrée `null`). */
export function nullableText(max: number) {
  return z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((value) => (value === '' ? null : value));
}

/** Destination d'un bouton ou d'un lien : chemin du site, ancre, `http(s)`, `mailto` ou `tel`. */
export const hrefSchema = z
  .string()
  .trim()
  .min(1, { error: 'Choisissez la destination du bouton.' })
  .max(500)
  .regex(/^(\/(?!\/)|#|https?:\/\/|mailto:|tel:)/i, {
    error: 'Saisissez une adresse commençant par /, https://, mailto: ou tel:.',
  });

export const linkSchema = z.object({
  label: z.string().trim().min(1, { error: 'Indiquez le libellé du bouton.' }).max(80),
  href: hrefSchema,
  external: z.boolean().optional(),
  labelMobile: nullableText(80).optional(),
});

/**
 * Visuel d'un emplacement photo : forme du contrat (`{ illustration, image, alt }`, telle que renvoyée par les
 * lectures) ou référence (`imageId`). Enregistré par référence au média (`{ illustration, imageId, alt }`), résolu à
 * la lecture : seule l'image de la médiathèque désignée par son identifiant est retenue.
 */
export const visualInputSchema = z
  .object({
    illustration: illustrationSchema.default('accueil'),
    image: z.object({ id: idSchema }).loose().nullable().optional(),
    imageId: idSchema.nullable().optional(),
    alt: z.string().trim().max(200).nullable().optional(),
  })
  .transform((visual) => ({
    illustration: visual.illustration,
    imageId: visual.imageId ?? visual.image?.id ?? null,
    alt: visual.alt ?? '',
  }));

export type VisualReference = z.output<typeof visualInputSchema>;

export const stepItemSchema = z.object({
  title: z.string().trim().min(1, { error: 'Indiquez un titre.' }).max(120),
  text: z.string().trim().max(600),
});

export const iconTextItemSchema = z.object({
  icon: iconSchema.nullable().optional(),
  title: z.string().trim().min(1, { error: 'Indiquez un titre.' }).max(120),
  text: z.string().trim().max(600),
});

export const faqItemSchema = z.object({
  question: z.string().trim().min(1, { error: 'Indiquez la question.' }).max(200),
  answer: z.string().trim().min(1, { error: 'Indiquez la réponse.' }).max(2000),
});

export const keyFigureSchema = z.object({
  key: z.string().trim().min(1).max(40),
  value: z.number().finite().optional(),
  valueText: nullableText(24).optional(),
  prefix: z.string().max(4).optional(),
  suffix: z.string().max(16).optional(),
  decimals: z.number().int().min(0).max(2).optional(),
  label: z.string().trim().min(1, { error: 'Indiquez le libellé.' }).max(80),
  labelMobile: nullableText(80).optional(),
});

/** Schéma `Seo` du contrat (titre 70, description 170, image de partage absolue). */
export const seoSchema = z.object({
  title: nullableText(70).optional(),
  description: nullableText(170).optional(),
  ogImageUrl: z
    .url({ protocol: /^https?$/, error: 'Saisissez une adresse web valide.' })
    .nullable()
    .optional(),
  noindex: z.boolean().optional(),
});
