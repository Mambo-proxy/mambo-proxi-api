import { z } from 'zod';
import { emailSchema } from '../auth/auth.schemas.js';
import { ROLES } from '../auth/permissions.js';

/** Corps des opérations `Admin — Utilisateurs` du contrat. Messages en français ; propriétés inconnues ignorées. */

const nameSchema = z.string().trim().min(1, { error: 'Indiquez le nom.' }).max(120);
const roleSchema = z.enum(ROLES, { error: 'Choisissez un rôle.' });

export const inviteUserInputSchema = z.object({
  email: emailSchema,
  name: nameSchema,
  role: roleSchema,
});
export type InviteUserInput = z.output<typeof inviteUserInputSchema>;

/** `minProperties: 1` du contrat : au moins un champ connu. */
export const updateUserInputSchema = z
  .object({
    name: nameSchema.optional(),
    role: roleSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .refine((input) => input.name !== undefined || input.role !== undefined || input.isActive !== undefined, {
    error: 'Indiquez au moins une modification (nom, rôle ou activation).',
    params: { code: 'required' },
  });
export type UpdateUserInput = z.output<typeof updateUserInputSchema>;
