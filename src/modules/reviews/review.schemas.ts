import { z } from 'zod';
import { langSchema } from '../../common/i18n/lang.js';
import { optionalParam, pageSchema, pageSizeSchema } from '../../common/pagination/pagination.js';
import { idSchema, nullableText, slugSchema } from '../../common/validation/content.schemas.js';

/** Paramètres et corps des avis (site et back-office). */

export const REVIEW_STATUSES = ['A_VALIDER', 'PUBLIE', 'MASQUE'] as const;
const statusSchema = z.enum(REVIEW_STATUSES, { error: 'Statut inconnu (A_VALIDER, PUBLIE, MASQUE).' });

const booleanParam = z.enum(['true', 'false']).transform((value) => value === 'true');

/** `GET /v1/reviews` (12 avis par page, 50 au plus). */
export const listReviewsQuerySchema = z.object({
  lang: langSchema,
  category: optionalParam(slugSchema),
  service: optionalParam(slugSchema),
  featured: optionalParam(booleanParam),
  sort: z.preprocess(
    (value) => (value === '' || value === undefined ? 'recent' : value),
    z.enum(['recent', 'rating'], { error: 'Tri possible : recent, rating.' }),
  ),
  page: pageSchema,
  pageSize: z.preprocess(
    (value) => (value === '' || value === undefined ? 12 : value),
    z.coerce.number().int().min(1).max(50),
  ),
});
export type ListReviewsQuery = z.output<typeof listReviewsQuerySchema>;

/** `GET /v1/reviews/summary` */
export const reviewSummaryQuerySchema = z.object({
  lang: langSchema,
  category: optionalParam(slugSchema),
  service: optionalParam(slugSchema),
});
export type ReviewSummaryQuery = z.output<typeof reviewSummaryQuerySchema>;

/** `GET /v1/admin/reviews` */
export const adminListReviewsQuerySchema = z.object({
  status: optionalParam(statusSchema),
  service: optionalParam(slugSchema),
  page: pageSchema,
  pageSize: pageSizeSchema,
});
export type AdminListReviewsQuery = z.output<typeof adminListReviewsQuerySchema>;

const ratingSchema = z
  .number({ error: 'Choisissez une note de 1 à 5 étoiles.' })
  .int({ error: 'Choisissez une note de 1 à 5 étoiles.' })
  .min(1, { error: 'Choisissez une note de 1 à 5 étoiles.' })
  .max(5, { error: 'Choisissez une note de 1 à 5 étoiles.' });

/** Schéma `ReviewInput` : témoignage saisi par l'équipe (« non vérifié »). */
export const reviewInputSchema = z.object({
  authorName: z
    .string({ error: 'Indiquez le nom affiché (ex. « Aurélie K. »).' })
    .trim()
    .min(1, { error: 'Indiquez le nom affiché (ex. « Aurélie K. »).' })
    .max(60),
  city: nullableText(80).optional(),
  rating: ratingSchema,
  text: z
    .string({ error: 'Saisissez le texte de l’avis.' })
    .trim()
    .min(10, { error: 'L’avis doit compter au moins 10 caractères.' })
    .max(2000),
  serviceId: idSchema.nullable().optional(),
  date: z.iso.datetime({ offset: true, error: 'Date ISO 8601 attendue.' }).nullable().optional(),
  status: statusSchema.optional(),
});
export type ReviewInput = z.output<typeof reviewInputSchema>;

/** `PATCH /v1/admin/reviews/{id}` : publier, masquer, mettre en avant, service. */
export const reviewPatchSchema = z
  .object({
    status: statusSchema.optional(),
    featured: z.boolean().optional(),
    serviceId: idSchema.nullable().optional(),
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    error: 'Indiquez au moins une modification.',
  });
export type ReviewPatch = z.output<typeof reviewPatchSchema>;

/** `POST /v1/admin/reviews/{id}/reply` : `null` (ou texte vide) supprime la réponse. */
export const reviewReplySchema = z.object({
  reply: nullableText(2000),
});
export type ReviewReplyInput = z.output<typeof reviewReplySchema>;
