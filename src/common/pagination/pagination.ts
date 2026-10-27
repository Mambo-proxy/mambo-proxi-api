import { z } from 'zod';

/**
 * Pagination et tri des listes du back-office (paramètres `Page`, `PageSize`, `Sort` du contrat) :
 * `?page=&pageSize=` → `{ data, meta: { page, pageSize, total, totalPages } }`, `?sort=-createdAt`.
 */

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/** Paramètre de requête vide (`?q=`) traité comme absent. */
export function optionalParam<T extends z.ZodType>(schema: T) {
  return z.preprocess((value) => (value === '' ? undefined : value), schema.optional());
}

export const pageSchema = z.preprocess(
  (value) => (value === '' || value === undefined ? 1 : value),
  z.coerce.number().int().min(1).max(100_000),
);

export const pageSizeSchema = z.preprocess(
  (value) => (value === '' || value === undefined ? DEFAULT_PAGE_SIZE : value),
  z.coerce.number().int().min(1).max(MAX_PAGE_SIZE),
);

export interface SortOrder<F extends string> {
  field: F;
  direction: 'asc' | 'desc';
}

/** `sort` : un des champs autorisés, préfixé de `-` pour un tri décroissant. */
export function sortSchema<const F extends readonly [string, ...string[]]>(fields: F, fallback: string) {
  const allowed = new Set<string>(fields);
  return z
    .preprocess((value) => (value === '' || value === undefined ? fallback : value), z.string().max(40))
    .refine((value) => allowed.has(value.replace(/^-/, '')), {
      error: `Tri possible sur : ${fields.join(', ')} (préfixe « - » pour l’ordre décroissant).`,
    })
    .transform((value): SortOrder<F[number]> => ({
      field: value.replace(/^-/, ''),
      direction: value.startsWith('-') ? 'desc' : 'asc',
    }));
}

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface Page<T> {
  data: T[];
  meta: PaginationMeta;
}

export function paginationMeta(page: number, pageSize: number, total: number): PaginationMeta {
  return { page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
}

/** `skip` / `take` de Prisma pour une page. */
export function pageWindow(page: number, pageSize: number): { skip: number; take: number } {
  return { skip: (page - 1) * pageSize, take: pageSize };
}
