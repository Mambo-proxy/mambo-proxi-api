import { z } from 'zod';

/** Actions mesurées (`AnalyticsAction` du contrat), dans l'ordre de l'énumération. */
export const ANALYTICS_ACTIONS = [
  'quote',
  'whatsapp',
  'call',
  'email',
  'participate',
  'newsletter',
  'appointment',
  'sign_up',
  'contact',
  'application',
  'partner',
  'training',
] as const;
export type AnalyticsActionName = (typeof ANALYTICS_ACTIONS)[number];

/** Libellés des actions (description de `AnalyticsAction`). */
export const ANALYTICS_ACTION_LABELS: Record<AnalyticsActionName, string> = {
  quote: 'Devis',
  whatsapp: 'WhatsApp',
  call: 'Appel',
  email: 'E-mail',
  participate: '« Je participe »',
  newsletter: 'Inscription newsletter',
  appointment: 'Rendez-vous',
  sign_up: 'Inscription',
  contact: 'Message de contact',
  application: 'Candidature',
  partner: 'Demande de partenariat',
  training: 'Demande de formation',
};

/** Taille maximale d'un lot (contrat : 16 Kio, 50 événements). */
export const MAX_BATCH_BYTES = 16 * 1024;
export const MAX_BATCH_EVENTS = 50;

const eventBase = {
  path: z
    .string({ error: 'Adresse de page attendue.' })
    .max(300, { error: 'Adresse trop longue (300 caractères au plus).' })
    .regex(/^\//, { error: 'L’adresse doit commencer par « / ».' }),
  lang: z.enum(['fr', 'en'], { error: 'Langue attendue : fr ou en.' }),
  occurredAt: z.iso.datetime({ offset: true, error: 'Date et heure ISO 8601 attendues.' }),
  device: z
    .enum(['mobile', 'tablet', 'desktop'], { error: 'Appareil attendu : mobile, tablet ou desktop.' })
    .optional(),
};

const pageViewSchema = z.object({
  type: z.literal('page_view'),
  ...eventBase,
  referrerHost: z.string().max(253, { error: 'Domaine trop long.' }).nullable().optional(),
});

const actionSchema = z.object({
  type: z.literal('action'),
  ...eventBase,
  action: z.enum(ANALYTICS_ACTIONS, { error: 'Action inconnue.' }),
  step: z.enum(['click', 'submit'], { error: 'Étape attendue : click ou submit.' }).default('click'),
  target: z.string().max(120, { error: '120 caractères au plus.' }).nullable().optional(),
  placement: z.string().max(40, { error: '40 caractères au plus.' }).nullable().optional(),
});

export const analyticsEventSchema = z.discriminatedUnion('type', [pageViewSchema, actionSchema], {
  error: 'Type d’événement attendu : page_view ou action.',
});
export type AnalyticsEvent = z.output<typeof analyticsEventSchema>;

export const analyticsBatchSchema = z
  .object({
    consent: z.boolean({ error: 'Indiquez le consentement (true ou false).' }),
    visitorId: z.uuid({ error: 'Identifiant de visiteur invalide (UUID attendu).' }).optional(),
    events: z
      .array(analyticsEventSchema, { error: 'Liste d’événements attendue.' })
      .min(1, { error: 'Envoyez au moins un événement.' })
      .max(MAX_BATCH_EVENTS, { error: `Envoyez au plus ${String(MAX_BATCH_EVENTS)} événements par lot.` }),
  })
  .superRefine((batch, ctx) => {
    if (!batch.consent && batch.visitorId !== undefined)
      ctx.addIssue({
        code: 'custom',
        path: ['visitorId'],
        message: 'Aucun identifiant de visiteur ne doit être envoyé sans consentement.',
      });
  });
export type AnalyticsBatch = z.output<typeof analyticsBatchSchema>;

export const ANALYTICS_PERIODS = ['7d', '30d', '90d'] as const;
export type AnalyticsPeriod = (typeof ANALYTICS_PERIODS)[number];

export const analyticsSummaryQuerySchema = z.object({
  period: z.preprocess(
    (value) => (value === '' || value === undefined ? '30d' : value),
    z.enum(ANALYTICS_PERIODS, { error: 'Période attendue : 7d, 30d ou 90d.' }),
  ),
  lang: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.enum(['fr', 'en'], { error: 'Langue attendue : fr ou en.' }).optional(),
  ),
});
export type AnalyticsSummaryQuery = z.output<typeof analyticsSummaryQuerySchema>;
