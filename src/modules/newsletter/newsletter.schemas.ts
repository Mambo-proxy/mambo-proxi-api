import { z } from 'zod';
import { antiSpamSchema } from '../../common/anti-spam/anti-spam.schema.js';
import { optionalParam, pageSchema, pageSizeSchema } from '../../common/pagination/pagination.js';
import { PHONE_MESSAGE } from '../forms/forms.schemas.js';

const CONSENT_MESSAGE = "Merci d'accepter de recevoir la newsletter pour vous inscrire.";
const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

// ─────────────────────────── Site public ───────────────────────────

/** Formulaire d'origine (`SubscriberSource`, valeurs du contrat). */
export const SUBSCRIPTION_SOURCES = ['footer', 'suivi-mambo', 'inscription', 'autre'] as const;
export type SubscriptionSource = (typeof SUBSCRIPTION_SOURCES)[number];

/** `POST /v1/newsletter/subscriptions` (`NewsletterSubscriptionInput`). */
export const subscriptionInputSchema = z.object({
  name: z
    .string()
    .trim()
    .max(120)
    .nullish()
    .transform((value) => (value ? value : null)),
  email: emailSchema,
  phone: z
    .string()
    .trim()
    .regex(/^\+[1-9]\d{6,14}$/, { error: PHONE_MESSAGE })
    .nullish()
    .transform((value) => value ?? null),
  source: z.enum(SUBSCRIPTION_SOURCES).default('footer'),
  tags: z.array(z.string().trim().min(1).max(40)).max(5).default([]),
  consent: z.literal(true, { error: CONSENT_MESSAGE }),
  antiSpam: antiSpamSchema,
});
export type SubscriptionInput = z.output<typeof subscriptionInputSchema>;

/** `POST /v1/newsletter/confirm` */
export const confirmInputSchema = z.object({ token: z.string().trim().min(1).max(512) });
export type ConfirmInput = z.output<typeof confirmInputSchema>;

/**
 * `POST /v1/newsletter/unsubscribe` : JSON `{ token }` (page du site) ou formulaire `List-Unsubscribe=One-Click`
 * (RFC 8058, envoyé par la messagerie à l'adresse de l'en-tête, jeton dans `?token=`).
 */
export const unsubscribeBodySchema = z
  .object({ token: z.string().trim().max(512).optional(), 'List-Unsubscribe': z.string().optional() })
  .loose()
  .optional()
  .transform((body) => body ?? {});
export const unsubscribeQuerySchema = z.object({ token: optionalParam(z.string().trim().max(512)) });
export type UnsubscribeBody = z.output<typeof unsubscribeBodySchema>;
export type UnsubscribeQuery = z.output<typeof unsubscribeQuerySchema>;

// ─────────────────────────── Back-office ───────────────────────────

export const SUBSCRIBER_STATUSES = ['EN_ATTENTE', 'CONFIRME', 'DESINSCRIT'] as const;

/** `GET /v1/admin/subscribers` */
export const listSubscribersQuerySchema = z.object({
  status: optionalParam(z.enum(SUBSCRIBER_STATUSES)),
  q: optionalParam(z.string().trim().max(120)),
  page: pageSchema,
  pageSize: pageSizeSchema,
});
export type ListSubscribersQuery = z.output<typeof listSubscribersQuerySchema>;

export const SEGMENT_KINDS = ['ALL', 'FRANCE', 'CAMEROUN', 'PROFESSIONNELS', 'TAGS'] as const;

/** Schéma `CampaignSegment` : `TAGS` demande au moins une étiquette. */
export const segmentSchema = z
  .object({
    kind: z.enum(SEGMENT_KINDS, { error: 'Choisissez les destinataires.' }),
    tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  })
  .transform((segment) => ({
    kind: segment.kind,
    tags: segment.kind === 'TAGS' ? [...new Set(segment.tags ?? [])] : [],
  }))
  .superRefine((segment, ctx) => {
    if (segment.kind === 'TAGS' && segment.tags.length === 0)
      ctx.addIssue({ code: 'custom', path: ['tags'], message: 'Choisissez au moins une étiquette.' });
  });
export type SegmentInput = z.output<typeof segmentSchema>;

/** Schéma `CampaignFields`. */
const campaignFields = {
  subject: z.string().trim().max(150),
  preheader: z
    .string()
    .trim()
    .max(150)
    .nullable()
    .transform((value) => (value ? value : null)),
  html: z.string().max(200_000),
  segment: segmentSchema,
};

/** `POST /v1/admin/campaigns` (`CampaignInput`) : brouillon (objet et contenu vérifiés à la programmation). */
export const campaignInputSchema = z.object({
  ...campaignFields,
  preheader: campaignFields.preheader.optional(),
});
export type CampaignInput = z.output<typeof campaignInputSchema>;

/** `PATCH /v1/admin/campaigns/{id}` (`CampaignPatch`) : au moins un champ. */
export const campaignPatchSchema = z
  .object(campaignFields)
  .partial()
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), {
    error: 'Aucune modification à enregistrer.',
  });
export type CampaignPatch = z.output<typeof campaignPatchSchema>;

/** `POST /v1/admin/campaigns/{id}/test` */
export const campaignTestInputSchema = z.object({ email: emailSchema });
export type CampaignTestInput = z.output<typeof campaignTestInputSchema>;

/** `POST /v1/admin/campaigns/{id}/schedule` */
export const campaignScheduleInputSchema = z.object({
  scheduledAt: z.iso.datetime({ offset: true, error: 'Choisissez une date et une heure valides.' }),
});
export type CampaignScheduleInput = z.output<typeof campaignScheduleInputSchema>;
