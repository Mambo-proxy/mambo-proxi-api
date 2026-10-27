import { z } from 'zod';
import { langSchema } from '../../common/i18n/lang.js';
import { optionalParam, pageSchema } from '../../common/pagination/pagination.js';
import {
  idSchema,
  illustrationSchema,
  nullableText,
  slugSchema,
} from '../../common/validation/content.schemas.js';
import { PUBLISH_STATUSES } from '../jobs/job.schemas.js';

/** Booléen d'une chaîne de requête (`true` / `false`, `1` / `0`). */
const booleanParam = z.preprocess(
  (value) => (value === 'true' || value === '1' ? true : value === 'false' || value === '0' ? false : value),
  z.boolean({ error: 'Valeur attendue : true ou false.' }),
);

/** `GET /v1/events` */
export const listEventsQuerySchema = z.object({
  lang: langSchema,
  upcoming: optionalParam(booleanParam).transform((value) => value ?? true),
  limit: optionalParam(z.coerce.number().int().min(1).max(50)),
  page: pageSchema,
});
export type ListEventsQuery = z.output<typeof listEventsQuerySchema>;

/** `GET /v1/admin/events` */
export const listAdminEventsQuerySchema = z.object({
  period: optionalParam(z.enum(['upcoming', 'past', 'all'])).transform((value) => value ?? 'upcoming'),
});
export type ListAdminEventsQuery = z.output<typeof listAdminEventsQuerySchema>;

const requiredText = (max: number) => z.string().trim().min(1, { abort: true }).max(max);
const dateTime = z.iso.datetime({ offset: true, error: 'Choisissez une date et une heure valides.' });

/** Schéma `EventFields`. */
const eventFields = {
  title: requiredText(120),
  slug: slugSchema,
  startsAt: dateTime,
  endsAt: dateTime.nullable(),
  city: requiredText(80),
  place: nullableText(120),
  tag: requiredText(40),
  illustration: illustrationSchema,
  imageId: idSchema.nullable(),
  description: nullableText(3000),
  capacity: z
    .number()
    .int()
    .min(1, { error: 'Indiquez un nombre de places supérieur à 0, ou laissez vide.' })
    .nullable(),
  limited: z.boolean(),
  status: z.enum(PUBLISH_STATUSES, { error: 'Statut inconnu.' }),
};

/** `POST /v1/admin/events` (`EventInput`) : slug tiré du titre s'il est absent ; brouillon par défaut. */
export const eventInputSchema = z.object({
  ...eventFields,
  slug: eventFields.slug.optional(),
  endsAt: eventFields.endsAt.optional(),
  place: eventFields.place.optional(),
  imageId: eventFields.imageId.optional(),
  description: eventFields.description.optional(),
  capacity: eventFields.capacity.optional(),
  limited: eventFields.limited.optional(),
  status: eventFields.status.optional(),
});
export type EventInput = z.output<typeof eventInputSchema>;

/** `PATCH /v1/admin/events/{id}` (`EventPatch`) : au moins un champ. */
export const eventPatchSchema = z
  .object(eventFields)
  .partial()
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), {
    error: 'Aucune modification à enregistrer.',
  });
export type EventPatch = z.output<typeof eventPatchSchema>;
