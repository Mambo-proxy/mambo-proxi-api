import { z } from 'zod';
import { antiSpamSchema } from '../../common/anti-spam/anti-spam.schema.js';
import { LANGS } from '../../common/i18n/lang.js';
import { SLUG_MAX_LENGTH, SLUG_PATTERN } from '../catalog/catalog.schemas.js';

/**
 * Corps des formulaires publics (schémas `…Input` du contrat). Messages en français prêts à afficher ; les messages
 * génériques (champ obligatoire, longueur, choix) viennent de la table commune (`common/validation/zod-issues`).
 * Les propriétés inconnues sont ignorées (le contrat ne les interdit pas).
 */

export const CONSENT_MESSAGE = "Merci d'accepter le traitement de vos données pour envoyer votre demande.";
export const PHONE_MESSAGE = 'Saisissez un numéro au format international (ex. +237 6 00 00 00 00).';
export const COUNTRY_MESSAGE = 'Choisissez un pays dans la liste.';

const PHONE_PATTERN = /^\+[1-9]\d{6,14}$/;
const COUNTRY_PATTERN = /^[A-Z]{2}$/;

/** Texte obligatoire : vide → « Ce champ est obligatoire. », puis longueurs du contrat. */
function requiredText(max: number, min = 1) {
  const base = z.string().trim().min(1, { abort: true });
  return (min > 1 ? base.min(min) : base).max(max);
}

/** Texte facultatif : absent, `null` ou vide → `null`. */
function optionalText(max: number) {
  return z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value ? value : null));
}

const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));
const phoneSchema = z.string().trim().min(1, { abort: true }).regex(PHONE_PATTERN, { error: PHONE_MESSAGE });
const countrySchema = z
  .string()
  .trim()
  .min(1, { abort: true })
  .regex(COUNTRY_PATTERN, { error: COUNTRY_MESSAGE });
const slugSchema = z.string().trim().min(1, { abort: true }).max(SLUG_MAX_LENGTH).regex(SLUG_PATTERN);
const optionalSlug = slugSchema.nullish().transform((value) => value ?? null);
const consentSchema = z.literal(true, { error: CONSENT_MESSAGE });
/** Langue de l'envoi (absente du contrat) : celle des e-mails ; à défaut, l'en-tête `Accept-Language`. */
const langSchema = z.enum(LANGS).optional();

/** Schéma `ContactIdentity` (pays et ville facultatifs ; `null` accepté comme absence). */
const contactIdentitySchema = z.object({
  fullName: requiredText(120, 2),
  email: emailSchema,
  phone: phoneSchema,
  country: countrySchema.nullish().transform((value) => value ?? null),
  city: optionalText(80),
});

const needValueSchema = z.union([
  z.string().max(500),
  z.number(),
  z.array(z.string().max(120)).max(20),
  z.null(),
]);

/** Nombre maximal de champs dynamiques d'un devis (une rubrique en définit au plus 12). */
export const MAX_NEEDS = 30;

/** `POST /v1/quote-requests` (`QuoteRequestInput`). */
export const quoteRequestInputSchema = z.object({
  categorySlug: slugSchema,
  serviceSlug: optionalSlug,
  needs: z
    .record(z.string().max(60), needValueSchema)
    .refine((needs) => Object.keys(needs).length <= MAX_NEEDS, { error: 'Trop de champs envoyés.' }),
  description: requiredText(3000, 20),
  contact: contactIdentitySchema.extend({ country: countrySchema }),
  contactPreference: z.enum(['WHATSAPP', 'TELEPHONE', 'EMAIL']),
  consent: consentSchema,
  antiSpam: antiSpamSchema,
  lang: langSchema,
});
export type QuoteRequestInput = z.output<typeof quoteRequestInputSchema>;

/** `POST /v1/contact-messages` (`ContactMessageInput`) : téléphone, pays et sujet facultatifs. */
export const contactMessageInputSchema = z.object({
  type: z.enum(['CONTACT', 'INFORMATION']),
  contact: z.object({
    fullName: requiredText(120, 2),
    email: emailSchema,
    phone: phoneSchema.nullish().transform((value) => value ?? null),
    country: countrySchema.nullish().transform((value) => value ?? null),
    city: optionalText(80),
  }),
  subject: optionalText(120),
  serviceSlug: optionalSlug,
  message: requiredText(3000, 10),
  consent: consentSchema,
  antiSpam: antiSpamSchema,
  lang: langSchema,
});
export type ContactMessageInput = z.output<typeof contactMessageInputSchema>;

/** `POST /v1/registrations` (`RegistrationInput`) : structure et activité obligatoires pour un professionnel. */
export const registrationInputSchema = z
  .object({
    profile: z.enum(['PARTICULIER', 'PROFESSIONNEL']),
    firstName: requiredText(60),
    lastName: requiredText(60),
    email: emailSchema,
    phone: phoneSchema,
    country: countrySchema.nullish().transform((value) => value ?? null),
    city: optionalText(80),
    interests: z.array(slugSchema).max(10).default([]),
    organization: optionalText(120),
    activity: optionalText(120),
    newsletter: z.boolean().default(false),
    consent: consentSchema,
    antiSpam: antiSpamSchema,
    lang: langSchema,
  })
  .superRefine((input, ctx) => {
    if (input.profile !== 'PROFESSIONNEL') return;
    for (const field of ['organization', 'activity'] as const) {
      if (input[field] === null) {
        ctx.addIssue({
          code: 'custom',
          path: [field],
          params: { code: 'required' },
          message: 'Ce champ est obligatoire.',
        });
      }
    }
  });
export type RegistrationInput = z.output<typeof registrationInputSchema>;

/** Valeur de `trainingSlug` pour une formation hors catalogue (précisée dans `otherTraining`). */
export const OTHER_TRAINING_SLUG = 'autre';

/** `POST /v1/training-requests` (`TrainingRequestInput`). */
export const trainingRequestInputSchema = z
  .object({
    trainingSlug: requiredText(120),
    otherTraining: optionalText(200),
    organization: optionalText(120),
    participants: z.number().int().min(1).max(500),
    period: optionalText(120),
    contact: contactIdentitySchema,
    message: optionalText(3000),
    consent: consentSchema,
    antiSpam: antiSpamSchema,
    lang: langSchema,
  })
  .superRefine((input, ctx) => {
    if (input.trainingSlug === OTHER_TRAINING_SLUG && input.otherTraining === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['otherTraining'],
        params: { code: 'required' },
        message: 'Précisez la formation souhaitée.',
      });
    }
  });
export type TrainingRequestInput = z.output<typeof trainingRequestInputSchema>;

/** `POST /v1/partner-requests` (`PartnerRequestInput`) : pays et ville obligatoires. */
export const partnerRequestInputSchema = z.object({
  partnershipType: z.enum(['PRESTATAIRE_EXPERIENCE', 'IMMOBILIER', 'ENTREPRISE_PRESTATAIRE', 'AUTRE']),
  organization: requiredText(120),
  activity: requiredText(120),
  contact: contactIdentitySchema.extend({ country: countrySchema, city: requiredText(80) }),
  presentation: optionalText(3000),
  consent: consentSchema,
  antiSpam: antiSpamSchema,
  lang: langSchema,
});
export type PartnerRequestInput = z.output<typeof partnerRequestInputSchema>;

/** `POST /v1/event-registrations` (`EventRegistrationInput`). */
export const eventRegistrationInputSchema = z.object({
  eventSlug: slugSchema,
  seats: z.number().int().min(1).max(10),
  contact: contactIdentitySchema,
  consent: consentSchema,
  antiSpam: antiSpamSchema,
  lang: langSchema,
});
export type EventRegistrationInput = z.output<typeof eventRegistrationInputSchema>;
