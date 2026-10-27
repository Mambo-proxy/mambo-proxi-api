import { z } from 'zod';
import { langSchema } from '../../common/i18n/lang.js';
import { optionalParam } from '../../common/pagination/pagination.js';
import { idSchema } from '../../common/validation/content.schemas.js';

/** Catégories de partenaires (schéma `PartnerCategory`). */
export const PARTNER_CATEGORIES = ['EXPERIENCE', 'IMMOBILIER', 'ENTREPRISES'] as const;
const categorySchema = z.enum(PARTNER_CATEGORIES, { error: 'Choisissez une catégorie.' });

/** `GET /v1/partners` */
export const listPartnersQuerySchema = z.object({
  lang: langSchema,
  category: optionalParam(categorySchema),
});
export type ListPartnersQuery = z.output<typeof listPartnersQuerySchema>;

/** `GET /v1/admin/partners` */
export const listAdminPartnersQuerySchema = z.object({ category: optionalParam(categorySchema) });
export type ListAdminPartnersQuery = z.output<typeof listAdminPartnersQuerySchema>;

/** Schéma `PartnerFields`. */
const partnerFields = {
  name: z.string().trim().min(1, { abort: true }).max(120),
  category: categorySchema,
  logoImageId: idSchema.nullable(),
  url: z
    .url({ protocol: /^https?$/, error: 'Saisissez une adresse web valide (https://…).' })
    .max(500)
    .nullable(),
  visible: z.boolean(),
};

/** `POST /v1/admin/partners` (`PartnerInput`). */
export const partnerInputSchema = z.object({
  ...partnerFields,
  logoImageId: partnerFields.logoImageId.optional(),
  url: partnerFields.url.optional(),
  visible: partnerFields.visible.optional(),
});
export type PartnerInput = z.output<typeof partnerInputSchema>;

/** `PATCH /v1/admin/partners/{id}` (`PartnerPatch`) : au moins un champ. */
export const partnerPatchSchema = z
  .object(partnerFields)
  .partial()
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), {
    error: 'Aucune modification à enregistrer.',
  });
export type PartnerPatch = z.output<typeof partnerPatchSchema>;
