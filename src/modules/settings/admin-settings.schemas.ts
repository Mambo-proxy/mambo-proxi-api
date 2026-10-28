import { z } from 'zod';
import { idSchema, keyFigureSchema, nullableText } from '../../common/validation/content.schemas.js';

/**
 * Groupes de paramètres du back-office (`SettingsGroup`, formes `Settings*` du contrat) : chaque `PUT` envoie le
 * groupe complet, discriminé par `group` (identique à celui de l'adresse). Messages du back-office.
 */

export const SETTINGS_GROUPS = [
  'coordonnees',
  'whatsapp',
  'reseaux',
  'emails',
  'seo',
  'analytics',
  'chiffres',
  'rgpd',
  'securite',
] as const;
export type SettingsGroup = (typeof SETTINGS_GROUPS)[number];

/** Groupes réservés aux administrateurs (`settings:admin`) ; les autres demandent `settings:write`. */
export const ADMIN_SETTINGS_GROUPS: ReadonlySet<SettingsGroup> = new Set(['analytics', 'securite']);

export function isSettingsGroup(value: string): value is SettingsGroup {
  return (SETTINGS_GROUPS as readonly string[]).includes(value);
}

const PHONE_MESSAGE = 'Saisissez un numéro au format +237 6 00 00 00 00.';
const phone = z
  .string({ error: PHONE_MESSAGE })
  .trim()
  .regex(/^\+[1-9]\d{6,14}$/, { error: PHONE_MESSAGE });
const email = z.email({ error: 'Saisissez une adresse e-mail valide.' }).max(254);
const httpUrl = z.url({ protocol: /^https?$/, error: 'Saisissez une adresse valide.' }).max(500);

const agencySchema = z.object({
  name: z.string().trim().min(1).max(120),
  addressLines: z.array(z.string().trim().min(1).max(160)).max(6),
  city: z.string().trim().min(1).max(80),
  country: z.string().regex(/^[A-Z]{2}$/, { error: 'Code pays ISO 3166-1 attendu (ex. CM).' }),
  phone: phone.nullable().optional(),
  phoneDisplay: nullableText(40).optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  mapsUrl: httpUrl.nullable().optional(),
  openingHours: z
    .array(z.object({ label: z.string().trim().min(1).max(60), hours: z.string().trim().min(1).max(60) }))
    .max(10),
  parcelReceptionNote: nullableText(300).optional(),
});

/**
 * Textes anglais d'un groupe (`translations.en`, schémas `Settings*Texts` du contrat) : seuls les chemins de la liste
 * blanche sont gardés (`SETTING_TEXT_PATHS`), un texte vide ou `null` laisse le français.
 */
const englishText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { error: `${String(max)} caractères au maximum.` })
    .nullable()
    .optional();

const translationsInput = <T extends z.ZodType>(texts: T) =>
  z
    .object({
      en: texts.nullable(),
      reviewedFields: z.array(z.string().min(1).max(120)).max(80).optional(),
    })
    .optional();

/** Statut de la traduction : lecture seule, renvoyé par `GET`, ignoré à l'enregistrement. */
const translationStatusInput = z.unknown().optional();

const coordonneesTexts = z.object({
  hoursLabel: englishText(120),
  agency: z
    .object({
      name: englishText(120),
      addressLines: z.array(englishText(160)).max(6).optional(),
      openingHours: z
        .array(z.object({ label: englishText(60), hours: englishText(60) }).nullable())
        .max(10)
        .optional(),
      parcelReceptionNote: englishText(300),
    })
    .optional(),
});

const chiffresTexts = z.object({
  keyFigures: z
    .array(
      z
        .object({
          label: englishText(80),
          labelMobile: englishText(80),
          suffix: englishText(16),
          valueText: englishText(24),
        })
        .nullable(),
    )
    .max(8)
    .optional(),
});

const integer = (min: number, max: number, message: string) =>
  z
    .number({ error: message })
    .int({ error: message })
    .min(min, { error: message })
    .max(max, { error: message });

export const settingsGroupSchema = z.discriminatedUnion(
  'group',
  [
    z.object({
      group: z.literal('coordonnees'),
      phoneFrance: phone.nullable().optional(),
      phoneCameroon: phone,
      email,
      hoursLabel: z
        .string({ error: 'Indiquez les horaires.' })
        .trim()
        .min(1, { error: 'Indiquez les horaires.' })
        .max(120),
      agency: agencySchema,
      translations: translationsInput(coordonneesTexts),
      translationStatus: translationStatusInput,
    }),
    z.object({
      group: z.literal('whatsapp'),
      enabled: z.boolean(),
      number: phone,
      message: z.string().trim().max(500, { error: '500 caractères au maximum.' }),
      translations: translationsInput(z.object({ message: englishText(500) })),
      translationStatus: translationStatusInput,
    }),
    z.object({
      group: z.literal('reseaux'),
      social: z
        .array(
          z.object({
            network: z.enum(['instagram', 'facebook', 'linkedin', 'tiktok', 'youtube', 'x'], {
              error: 'Réseau inconnu.',
            }),
            url: httpUrl,
          }),
        )
        .max(6),
    }),
    z.object({
      group: z.literal('emails'),
      teamRecipients: z
        .array(email, { error: 'Indiquez au moins une adresse valide.' })
        .min(1, { error: 'Indiquez au moins une adresse valide.' })
        .max(20),
      senderName: z
        .string({ error: 'Indiquez le nom de l’expéditeur.' })
        .trim()
        .min(1, { error: 'Indiquez le nom de l’expéditeur.' })
        .max(80),
      replyTo: email.nullable().optional(),
      surveyDelayHours: integer(0, 720, 'Entre 0 et 720 heures.'),
      surveyReminderDays: integer(1, 30, 'Entre 1 et 30 jours.').nullable(),
      appointmentReminderHour: integer(0, 23, 'Entre 0 et 23 h.'),
    }),
    z.object({
      group: z.literal('seo'),
      defaultTitle: z
        .string({ error: 'Indiquez le titre.' })
        .trim()
        .min(1, { error: 'Indiquez le titre.' })
        .max(60, { error: '60 caractères au maximum.' }),
      defaultDescription: z
        .string({ error: 'Indiquez la description.' })
        .trim()
        .min(1, { error: 'Indiquez la description.' })
        .max(160, { error: '160 caractères au maximum.' }),
      ogImageId: idSchema.nullable().optional(),
      // Lecture seule : renvoyée par `GET`, ignorée à l'enregistrement.
      ogImage: z.unknown().optional(),
      searchConsoleVerification: nullableText(200).optional(),
      translations: translationsInput(
        z.object({ defaultTitle: englishText(60), defaultDescription: englishText(160) }),
      ),
      translationStatus: translationStatusInput,
    }),
    z.object({
      group: z.literal('analytics'),
      ga4MeasurementId: z
        .string()
        .regex(/^G-[A-Z0-9]+$/, { error: 'Identifiant au format G-XXXXXXXXXX.' })
        .nullable()
        .optional(),
      ga4PropertyId: nullableText(40).optional(),
      newsletterTracking: z.boolean().optional(),
    }),
    z.object({
      group: z.literal('chiffres'),
      keyFigures: z.array(keyFigureSchema).max(8),
      translations: translationsInput(chiffresTexts),
      translationStatus: translationStatusInput,
    }),
    z.object({
      group: z.literal('rgpd'),
      inactiveContactsRetentionMonths: integer(6, 120, 'Entre 6 et 120 mois.'),
      rejectedApplicationsRetentionMonths: integer(1, 60, 'Entre 1 et 60 mois.'),
    }),
    z.object({
      group: z.literal('securite'),
      maintenanceMode: z.boolean(),
      trustedDeviceDays: integer(0, 90, 'Entre 0 et 90 jours.').optional(),
    }),
  ],
  { error: 'Groupe de paramètres inconnu.' },
);
export type SettingsGroupValue = z.output<typeof settingsGroupSchema>;
