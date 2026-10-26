import { z } from 'zod';
import { langSchema, previewSchema } from '../../common/i18n/lang.js';

/** Schéma `Slug` du contrat. */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SLUG_MAX_LENGTH = 120;

/** Un identifiant d'adresse qui ne peut pas être un slug ne désigne aucun contenu (404, pas 400). */
export function isSlug(value: string): boolean {
  return value.length <= SLUG_MAX_LENGTH && SLUG_PATTERN.test(value);
}

const slugSchema = z.string().max(SLUG_MAX_LENGTH).regex(SLUG_PATTERN);

/** `GET /v1/categories` */
export const listCategoriesQuerySchema = z.object({
  lang: langSchema,
  include: z.enum(['services']).optional(),
});
export type ListCategoriesQuery = z.output<typeof listCategoriesQuerySchema>;

/** `GET /v1/services` */
export const listServicesQuerySchema = z.object({
  lang: langSchema,
  category: slugSchema.optional(),
  featured: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  q: z.string().trim().max(120).optional(),
});
export type ListServicesQuery = z.output<typeof listServicesQuerySchema>;

/** `GET /v1/categories/{slug}`, `GET /v1/services/{slug}` */
export const catalogDetailQuerySchema = z.object({
  lang: langSchema,
  preview: previewSchema,
});
export type CatalogDetailQuery = z.output<typeof catalogDetailQuerySchema>;
