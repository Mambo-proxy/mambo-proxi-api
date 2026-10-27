import { z } from 'zod';
import { optionalParam, pageSchema, pageSizeSchema, sortSchema } from '../../common/pagination/pagination.js';
import { SLUG_MAX_LENGTH, SLUG_PATTERN } from '../catalog/catalog.schemas.js';
import { districtSchema, searchSchema } from '../requests/request.schemas.js';

/** Paramètres des opérations « Admin — Contacts » du contrat. Messages en français. */

const filterShape = {
  profile: optionalParam(z.enum(['PARTICULIER', 'PROFESSIONNEL'], { error: 'Profil inconnu.' })),
  country: optionalParam(z.string().regex(/^[A-Z]{2}$/, { error: 'Code pays ISO 3166-1 attendu (ex. CM).' })),
  district: optionalParam(districtSchema),
  interest: optionalParam(
    z.string().max(SLUG_MAX_LENGTH).regex(SLUG_PATTERN, { error: 'Rubrique inconnue.' }),
  ),
};

export const CONTACT_SORT_FIELDS = ['createdAt', 'updatedAt', 'fullName', 'lastActivityAt'] as const;

/** `GET /v1/admin/contacts` */
export const listContactsQuerySchema = z.object({
  ...filterShape,
  q: optionalParam(searchSchema),
  page: pageSchema,
  pageSize: pageSizeSchema,
  sort: sortSchema(CONTACT_SORT_FIELDS, '-createdAt'),
});
export type ListContactsQuery = z.output<typeof listContactsQuerySchema>;

/** `GET /v1/admin/contacts/export.csv` : filtres de la liste (sans recherche ni pagination, comme le contrat). */
export const exportContactsQuerySchema = z.object(filterShape);
export type ContactFilters = z.output<typeof exportContactsQuerySchema>;
