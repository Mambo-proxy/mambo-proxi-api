import { z } from 'zod';
import { optionalParam, pageSchema, pageSizeSchema } from '../../common/pagination/pagination.js';
import { DASHBOARD_RANGES } from './dashboard-periods.js';

const idSchema = z
  .string({ error: 'Identifiant attendu.' })
  .min(1, { error: 'Identifiant attendu.' })
  .max(64, { error: 'Identifiant trop long.' });

export const dashboardQuerySchema = z.object({
  range: z.preprocess(
    (value) => (value === '' || value === undefined ? '30d' : value),
    z.enum(DASHBOARD_RANGES, { error: 'Période attendue : 7d, 30d ou 12m.' }),
  ),
});
export type DashboardQuery = z.output<typeof dashboardQuerySchema>;

export const adminSearchQuerySchema = z.object({
  q: z
    .string({ error: 'Saisissez au moins 2 caractères.' })
    .trim()
    .min(2, { error: 'Saisissez au moins 2 caractères.' })
    .max(120, { error: 'La recherche ne doit pas dépasser 120 caractères.' }),
});
export type AdminSearchQuery = z.output<typeof adminSearchQuerySchema>;

/** `PATCH /v1/admin/notifications/read` : identifiants à marquer (absent = toutes). */
export const markNotificationsReadSchema = z.object({
  ids: z.array(idSchema).max(500, { error: '500 notifications au plus.' }).optional(),
});
export type MarkNotificationsRead = z.output<typeof markNotificationsReadSchema>;

const dateTimeSchema = z.iso.datetime({ offset: true, error: 'Date et heure ISO 8601 attendues.' });

export const auditLogQuerySchema = z.object({
  actor: optionalParam(idSchema),
  entity: optionalParam(z.string().max(64, { error: 'Type de contenu trop long.' })),
  from: optionalParam(dateTimeSchema),
  to: optionalParam(dateTimeSchema),
  page: pageSchema,
  pageSize: pageSizeSchema,
});
export type AuditLogQuery = z.output<typeof auditLogQuerySchema>;
