import { z } from 'zod';
import { langSchema } from '../../common/i18n/lang.js';
import { optionalParam, pageSchema, pageSizeSchema } from '../../common/pagination/pagination.js';
import { iconSchema, nullableText, slugSchema } from '../../common/validation/content.schemas.js';
import { PUBLISH_STATUSES } from '../jobs/job.schemas.js';

/** Catégories de formations (schéma `TrainingCategory`). */
export const TRAINING_CATEGORIES = ['PROFESSIONNELS', 'ATELIERS', 'SENSIBILISATION'] as const;
const categorySchema = z.enum(TRAINING_CATEGORIES, { error: 'Choisissez une catégorie.' });

/** Statuts des demandes (schéma `RequestStatus`). */
const REQUEST_STATUSES = ['NOUVELLE', 'EN_COURS', 'PRESTATION_REALISEE', 'CLOTUREE'] as const;

/** `GET /v1/trainings` */
export const listTrainingsQuerySchema = z.object({
  lang: langSchema,
  category: optionalParam(categorySchema),
});
export type ListTrainingsQuery = z.output<typeof listTrainingsQuerySchema>;

/** `GET /v1/admin/training-requests` */
export const listTrainingRequestsQuerySchema = z.object({
  status: optionalParam(z.enum(REQUEST_STATUSES)),
  page: pageSchema,
  pageSize: pageSizeSchema,
});
export type ListTrainingRequestsQuery = z.output<typeof listTrainingRequestsQuerySchema>;

const requiredText = (max: number) => z.string().trim().min(1, { abort: true }).max(max);

/** Schéma `TrainingFields`. */
const trainingFields = {
  title: requiredText(120),
  slug: slugSchema,
  category: categorySchema,
  audienceLabel: requiredText(80),
  icon: iconSchema,
  duration: requiredText(40),
  format: requiredText(60),
  location: nullableText(80),
  description: nullableText(2000),
  status: z.enum(PUBLISH_STATUSES, { error: 'Statut inconnu.' }),
};

/** `POST /v1/admin/trainings` (`TrainingInput`) : slug tiré du titre s'il est absent ; brouillon par défaut. */
export const trainingInputSchema = z.object({
  ...trainingFields,
  slug: trainingFields.slug.optional(),
  location: trainingFields.location.optional(),
  description: trainingFields.description.optional(),
  status: trainingFields.status.optional(),
});
export type TrainingInput = z.output<typeof trainingInputSchema>;

/** `PATCH /v1/admin/trainings/{id}` (`TrainingPatch`) : au moins un champ. */
export const trainingPatchSchema = z
  .object(trainingFields)
  .partial()
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), {
    error: 'Aucune modification à enregistrer.',
  });
export type TrainingPatch = z.output<typeof trainingPatchSchema>;
