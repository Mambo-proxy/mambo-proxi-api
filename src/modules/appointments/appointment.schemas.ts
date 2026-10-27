import { z } from 'zod';
import { antiSpamSchema } from '../../common/anti-spam/anti-spam.schema.js';
import { LANGS } from '../../common/i18n/lang.js';
import { optionalParam } from '../../common/pagination/pagination.js';
import { CONSENT_MESSAGE, PHONE_MESSAGE, COUNTRY_MESSAGE } from '../forms/forms.schemas.js';
import { formatSchema } from './availability.schemas.js';

/** Corps et paramètres des rendez-vous (schémas `AppointmentInput`, `AdminAppointmentInput`, `AppointmentAction`). */

export const APPOINTMENT_REASONS = ['DEVIS', 'IMMOBILIER', 'PARTENARIAT', 'RECRUTEMENT', 'AUTRE'] as const;
export const APPOINTMENT_STATUSES = [
  'A_CONFIRMER',
  'CONFIRME',
  'AUTRE_CRENEAU_PROPOSE',
  'ANNULE',
  'TERMINE',
] as const;

const reasonSchema = z.enum(APPOINTMENT_REASONS, { error: 'Choisissez le motif du rendez-vous.' });
const dateTimeSchema = z.iso.datetime({ offset: true, error: 'Date et heure ISO 8601 attendues.' });
const idSchema = z.string().min(1).max(64);

function optionalText(max: number) {
  return z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value ? value : null));
}

const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));
const phoneSchema = z
  .string()
  .trim()
  .min(1, { abort: true })
  .regex(/^\+[1-9]\d{6,14}$/, { error: PHONE_MESSAGE });
const countrySchema = z
  .string()
  .trim()
  .min(1, { abort: true })
  .regex(/^[A-Z]{2}$/, { error: COUNTRY_MESSAGE });

/** Schéma `ContactIdentity` (pays et ville facultatifs). */
const contactIdentitySchema = z.object({
  fullName: z.string().trim().min(1, { abort: true }).min(2).max(120),
  email: emailSchema,
  phone: phoneSchema,
  country: countrySchema.nullish().transform((value) => value ?? null),
  city: optionalText(80),
});

/** `POST /v1/appointments` (`AppointmentInput`) ; `lang` : langue des e-mails, comme les formulaires. */
export const appointmentInputSchema = z.object({
  reason: reasonSchema,
  format: formatSchema,
  startsAt: dateTimeSchema,
  contact: contactIdentitySchema,
  message: optionalText(1000),
  consent: z.literal(true, { error: CONSENT_MESSAGE }),
  antiSpam: antiSpamSchema,
  lang: z.enum(LANGS).optional(),
});
export type AppointmentInput = z.output<typeof appointmentInputSchema>;

/** `POST /v1/appointments/{reference}/accept-proposal` */
export const acceptProposalInputSchema = z.object({
  token: z.string().trim().min(1, { abort: true }).max(512),
});
export type AcceptProposalInput = z.output<typeof acceptProposalInputSchema>;

export const REFERENCE_PATTERN = /^MP-\d{4}-\d{4,}$/;

const videoLinkSchema = z
  .union([
    z.url({ protocol: /^https?$/, error: 'Saisissez un lien de visio valide (https://…).' }).max(500),
    z.literal(''),
    z.null(),
  ])
  .optional()
  .transform((value) => (value === undefined ? undefined : value || null));
const locationSchema = z
  .string()
  .trim()
  .max(200)
  .nullable()
  .optional()
  .transform((value) => (value === undefined ? undefined : value || null));

/** `POST /v1/admin/appointments` (`AdminAppointmentInput`) : saisie manuelle, confirmée d'office. */
export const adminAppointmentInputSchema = z.object({
  contact: contactIdentitySchema,
  reason: reasonSchema,
  format: formatSchema,
  startsAt: dateTimeSchema,
  durationMinutes: z.number().int().min(15).max(480).default(90),
  location: locationSchema,
  videoLink: videoLinkSchema,
  notes: optionalText(2000),
  notifyClient: z.boolean().default(true),
  assignedToId: idSchema.nullable().optional(),
});
export type AdminAppointmentInput = z.output<typeof adminAppointmentInputSchema>;

const actionMessage = optionalText(1000);

/** `PATCH /v1/admin/appointments/{id}` (`AppointmentAction`). */
export const appointmentActionSchema = z.discriminatedUnion(
  'action',
  [
    z.object({ action: z.literal('confirm'), videoLink: videoLinkSchema, location: locationSchema }),
    z.object({ action: z.literal('propose'), proposedStartsAt: dateTimeSchema, message: actionMessage }),
    z.object({ action: z.literal('cancel'), message: actionMessage }),
    z.object({ action: z.literal('complete') }),
    z.object({ action: z.literal('notes'), notes: optionalText(2000) }),
    z.object({ action: z.literal('assign'), assignedToId: idSchema.nullable() }),
  ],
  { error: 'Action inconnue : confirm, propose, cancel, complete, notes ou assign.' },
);
export type AppointmentAction = z.output<typeof appointmentActionSchema>;

/** `GET /v1/admin/appointments` : période (instants ISO, `to` exclu), statut, personne assignée. */
export const listAppointmentsQuerySchema = z
  .object({
    from: dateTimeSchema,
    to: dateTimeSchema,
    status: optionalParam(z.enum(APPOINTMENT_STATUSES, { error: 'Statut inconnu.' })),
    assignee: optionalParam(z.union([z.enum(['me', 'none']), idSchema])),
  })
  .superRefine((query, ctx) => {
    const span = Date.parse(query.to) - Date.parse(query.from);
    if (span <= 0)
      ctx.addIssue({ code: 'custom', path: ['to'], message: 'La fin de la période doit suivre son début.' });
    else if (span > 400 * 24 * 60 * 60 * 1000)
      ctx.addIssue({ code: 'custom', path: ['to'], message: 'La période ne peut pas dépasser 400 jours.' });
  });
export type ListAppointmentsQuery = z.output<typeof listAppointmentsQuerySchema>;
