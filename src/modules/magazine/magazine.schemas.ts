import { z } from 'zod';
import { langSchema, previewSchema } from '../../common/i18n/lang.js';
import { optionalParam } from '../../common/pagination/pagination.js';
import { idSchema, nullableText } from '../../common/validation/content.schemas.js';

/** Texte obligatoire (espaces retirés). */
const requiredText = (max: number) => z.string().trim().min(1, { abort: true }).max(max);
const dateTimeSchema = z.iso.datetime({ offset: true, error: 'Choisissez une date et une heure valides.' });
const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));
const noChanges = { error: 'Aucune modification à enregistrer.' };

// ─────────────────────────── Site public ───────────────────────────

/** `GET /v1/magazine` */
export const magazineQuerySchema = z.object({
  lang: langSchema,
  edition: optionalParam(idSchema),
  preview: previewSchema,
});
export type MagazineQuery = z.output<typeof magazineQuerySchema>;

// ─────────────────────────── Back-office : éditions ───────────────────────────

/** Schéma `MagazineEditionFields`. */
const editionFields = {
  number: z.number().int().min(1).nullable(),
  title: requiredText(120),
  titleEn: nullableText(120),
  subtitle: nullableText(120),
  subtitleEn: nullableText(120),
  themes: nullableText(80),
  publishAt: dateTimeSchema.nullable(),
  coverId: idSchema.nullable(),
  editorial: nullableText(20000),
  editorialEn: nullableText(20000),
  signature: nullableText(120),
  signatureEn: nullableText(120),
};

/** `POST /v1/admin/magazine/editions` (`MagazineEditionInput`) : numéro suivant si `number` est absent. */
export const editionInputSchema = z.object(editionFields).partial().extend({ title: editionFields.title });
export type EditionInput = z.output<typeof editionInputSchema>;

/** `PATCH /v1/admin/magazine/editions/{id}` (`MagazineEditionPatch`) : au moins un champ. */
export const editionPatchSchema = z
  .object(editionFields)
  .partial()
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), noChanges);
export type EditionPatch = z.output<typeof editionPatchSchema>;

/** `POST /v1/admin/magazine/editions/{id}/publish` (corps facultatif). */
export const publishInputSchema = z
  .object({ publishAt: dateTimeSchema.nullish() })
  .optional()
  .transform((value) => ({ publishAt: value?.publishAt ?? null }));
export type PublishInput = z.output<typeof publishInputSchema>;

/** `PUT /v1/admin/magazine/editions/{id}/articles` */
export const editionArticlesInputSchema = z.object({
  ids: z
    .array(idSchema)
    .max(40)
    .refine((ids) => new Set(ids).size === ids.length, { error: 'Un article figure deux fois.' }),
});
export type EditionArticlesInput = z.output<typeof editionArticlesInputSchema>;

/** `POST /v1/admin/magazine/editions/{id}/newsletter/test` */
export const newsletterTestInputSchema = z.object({ email: emailSchema });
export type NewsletterTestInput = z.output<typeof newsletterTestInputSchema>;

/** `POST /v1/admin/magazine/editions/{id}/newsletter/schedule` */
export const newsletterScheduleInputSchema = z.object({ scheduledAt: dateTimeSchema });
export type NewsletterScheduleInput = z.output<typeof newsletterScheduleInputSchema>;

// ─────────────────────────── Back-office : articles ───────────────────────────

/** Schéma `MagazineArticleFields`. */
const articleFields = {
  title: requiredText(160),
  titleEn: nullableText(160),
  theme: requiredText(60),
  themeEn: nullableText(60),
  excerpt: nullableText(400),
  excerptEn: nullableText(400),
  body: nullableText(60000),
  bodyEn: nullableText(60000),
  imageId: idSchema.nullable(),
  editionId: idSchema.nullable(),
};

/** `POST /v1/admin/magazine/articles` (`MagazineArticleInput`). */
export const articleInputSchema = z
  .object(articleFields)
  .partial()
  .extend({ title: articleFields.title, theme: articleFields.theme });
export type ArticleInput = z.output<typeof articleInputSchema>;

/** `PATCH /v1/admin/magazine/articles/{id}` (`MagazineArticlePatch`). */
export const articlePatchSchema = z
  .object(articleFields)
  .partial()
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), noChanges);
export type ArticlePatch = z.output<typeof articlePatchSchema>;

/** `GET /v1/admin/magazine/articles` : `edition` = identifiant ou `none` (articles sans édition). */
export const listArticlesQuerySchema = z.object({
  edition: optionalParam(z.string().trim().min(1).max(64)),
  q: optionalParam(z.string().trim().max(120)),
});
export type ListArticlesQuery = z.output<typeof listArticlesQuerySchema>;
