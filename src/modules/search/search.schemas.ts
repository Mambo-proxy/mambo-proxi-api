import { z } from 'zod';
import { langSchema } from '../../common/i18n/lang.js';

/** Types de résultats (`SearchResultType`), dans l'ordre par défaut des groupes. */
export const SEARCH_RESULT_TYPES = ['service', 'category', 'page', 'article', 'job', 'training'] as const;
export type SearchResultType = (typeof SEARCH_RESULT_TYPES)[number];

const TYPES_MESSAGE = `Types possibles : ${SEARCH_RESULT_TYPES.join(', ')} (séparés par des virgules, sans doublon).`;

export const searchQuerySchema = z.object({
  q: z
    .string({ error: 'Saisissez au moins 2 caractères.' })
    .trim()
    .min(2, { error: 'Saisissez au moins 2 caractères.' })
    .max(120, { error: 'La recherche ne doit pas dépasser 120 caractères.' }),
  lang: langSchema,
  types: z.preprocess(
    (value) =>
      value === undefined || value === ''
        ? undefined
        : (Array.isArray(value) ? value.join(',') : typeof value === 'string' ? value : '')
            .split(',')
            .map((item) => item.trim()),
    z
      .array(z.enum(SEARCH_RESULT_TYPES, { error: TYPES_MESSAGE }))
      .min(1, { error: TYPES_MESSAGE })
      .refine((items) => new Set(items).size === items.length, { error: TYPES_MESSAGE })
      .optional(),
  ),
  limit: z.preprocess(
    (value) => (value === undefined || value === '' ? 5 : value),
    z.coerce
      .number({ error: 'Nombre entier entre 1 et 20 attendu.' })
      .int({ error: 'Nombre entier entre 1 et 20 attendu.' })
      .min(1, { error: 'Nombre entier entre 1 et 20 attendu.' })
      .max(20, { error: 'Nombre entier entre 1 et 20 attendu.' }),
  ),
});
export type SearchQuery = z.output<typeof searchQuerySchema>;
