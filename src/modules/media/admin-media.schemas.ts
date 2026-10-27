import { z } from 'zod';
import { optionalParam, pageSchema, pageSizeSchema } from '../../common/pagination/pagination.js';

export const MEDIA_STATUSES = ['PROCESSING', 'READY', 'FAILED'] as const;

const ALT_MESSAGE = 'Décrivez l’image en quelques mots.';

/** Texte alternatif : obligatoire, 200 caractères au plus, espaces de bord retirés. */
export const altSchema = z
  .string({ error: ALT_MESSAGE })
  .trim()
  .min(1, { error: ALT_MESSAGE })
  .max(200, { error: 'Le texte alternatif ne doit pas dépasser 200 caractères.' });

/** `GET /v1/admin/media` */
export const listMediaQuerySchema = z.object({
  q: optionalParam(z.string().trim().max(120)),
  status: optionalParam(z.enum(MEDIA_STATUSES)),
  used: optionalParam(z.enum(['true', 'false']).transform((value) => value === 'true')),
  page: pageSchema,
  pageSize: pageSizeSchema,
});
export type ListMediaQuery = z.output<typeof listMediaQuerySchema>;

/** Champs texte de `POST /v1/admin/media` (`multipart/form-data`) ; le fichier est contrôlé par le service. */
export const uploadMediaFieldsSchema = z.object({ alt: altSchema });
export type UploadMediaFields = z.output<typeof uploadMediaFieldsSchema>;

const focalPointSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});

/** `PATCH /v1/admin/media/{id}` */
export const updateMediaInputSchema = z
  .object({
    alt: altSchema.optional(),
    focalPoint: focalPointSchema.nullable().optional(),
  })
  .refine((patch) => patch.alt !== undefined || patch.focalPoint !== undefined, {
    error: 'Aucune modification à enregistrer.',
  });
export type UpdateMediaInput = z.output<typeof updateMediaInputSchema>;
