import { z } from 'zod';
import { optionalParam, pageSchema, pageSizeSchema, sortSchema } from '../../common/pagination/pagination.js';
import { SLUG_MAX_LENGTH, SLUG_PATTERN } from '../catalog/catalog.schemas.js';
import { REQUEST_STATUS_ORDER } from './request.mapper.js';

/** Paramètres et corps des opérations « Admin — Demandes » du contrat. Messages en français. */

const REQUEST_TYPES = [
  'DEVIS',
  'CONTACT',
  'INFORMATION',
  'INSCRIPTION',
  'FORMATION',
  'CANDIDATURE',
  'PARTENARIAT',
  'EVENEMENT',
  'RENDEZ_VOUS',
] as const;
const REQUEST_STATUSES = [
  'NOUVELLE',
  'EN_COURS',
  'PRESTATION_REALISEE',
  'CLOTUREE',
] as const satisfies typeof REQUEST_STATUS_ORDER;

export const idSchema = z.string().min(1).max(64);
const slugSchema = z.string().max(SLUG_MAX_LENGTH).regex(SLUG_PATTERN, { error: 'Rubrique inconnue.' });
const countrySchema = z.string().regex(/^[A-Z]{2}$/, { error: 'Code pays ISO 3166-1 attendu (ex. CM).' });
export const districtSchema = z.string().trim().min(1).max(80);
export const searchSchema = z.string().trim().max(120);
const dateTimeSchema = z.iso.datetime({ offset: true, error: 'Date et heure ISO 8601 attendues.' });

/** Paramètre `assignee` : `me`, `none` ou identifiant d'un utilisateur. */
const assigneeSchema = z.union([z.enum(['me', 'none']), idSchema]);

/** Filtres communs à la liste et à l'export CSV. */
const filterShape = {
  type: optionalParam(z.enum(REQUEST_TYPES, { error: 'Type de demande inconnu.' })),
  status: optionalParam(z.enum(REQUEST_STATUSES, { error: 'Statut inconnu.' })),
  category: optionalParam(slugSchema),
  country: optionalParam(countrySchema),
  district: optionalParam(districtSchema),
  assignee: optionalParam(assigneeSchema),
  due: optionalParam(z.enum(['overdue', 'today', 'week'], { error: 'Échéance : overdue, today ou week.' })),
  from: optionalParam(dateTimeSchema),
  to: optionalParam(dateTimeSchema),
};

export const REQUEST_SORT_FIELDS = [
  'createdAt',
  'updatedAt',
  'dueAt',
  'reference',
  'status',
  'type',
] as const;

/** `GET /v1/admin/requests` */
export const listRequestsQuerySchema = z.object({
  ...filterShape,
  q: optionalParam(searchSchema),
  page: pageSchema,
  pageSize: pageSizeSchema,
  sort: sortSchema(REQUEST_SORT_FIELDS, '-createdAt'),
});
export type ListRequestsQuery = z.output<typeof listRequestsQuerySchema>;

/** `GET /v1/admin/requests/export.csv` : filtres de la liste (sans recherche ni pagination, comme le contrat). */
export const exportRequestsQuerySchema = z.object(filterShape);
export type RequestFilters = z.output<typeof exportRequestsQuerySchema>;

/** `PATCH /v1/admin/requests/{id}` : `minProperties: 1` du contrat ; propriétés inconnues ignorées. */
export const updateRequestInputSchema = z
  .object({
    status: z.enum(REQUEST_STATUSES, { error: 'Choisissez un statut.' }).optional(),
    assignedToId: z.union([idSchema, z.null()], { error: 'Choisissez une personne.' }).optional(),
    dueAt: z.union([dateTimeSchema, z.null()], { error: 'Indiquez une date valide.' }).optional(),
  })
  .refine(
    (input) => input.status !== undefined || input.assignedToId !== undefined || input.dueAt !== undefined,
    {
      error: 'Indiquez au moins une modification (statut, assignation ou échéance).',
      params: { code: 'required' },
    },
  );
export type UpdateRequestInput = z.output<typeof updateRequestInputSchema>;

/** `POST /v1/admin/requests/{id}/notes` */
export const addNoteInputSchema = z.object({
  body: z
    .string({ error: 'Écrivez une note avant de l’enregistrer.' })
    .trim()
    .min(1, { error: 'Écrivez une note avant de l’enregistrer.' })
    .max(5000, { error: 'La note ne peut pas dépasser 5 000 caractères.' }),
});
export type AddNoteInput = z.output<typeof addNoteInputSchema>;
