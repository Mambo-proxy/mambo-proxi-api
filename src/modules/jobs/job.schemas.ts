import { z } from 'zod';
import { LANGS, langSchema, previewSchema } from '../../common/i18n/lang.js';
import { optionalParam, pageSchema, pageSizeSchema } from '../../common/pagination/pagination.js';
import { SLUG_MAX_LENGTH, SLUG_PATTERN } from '../catalog/catalog.schemas.js';
import { CONSENT_MESSAGE, PHONE_MESSAGE } from '../forms/forms.schemas.js';
import { isUploadedFile, type UploadedFile } from '../storage/storage.service.js';

/** Statuts de publication (schéma `PublishStatus`) et de candidature (schéma `ApplicationStatus`). */
export const PUBLISH_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;
export const APPLICATION_STATUSES = ['NOUVEAU', 'LU', 'RETENU', 'REFUSE'] as const;
/** Valeur du filtre `job` des candidatures spontanées. */
export const SPONTANEOUS_JOB = 'spontaneous';

// ─────────────────────────── Lecture publique ───────────────────────────

/** `GET /v1/jobs` */
export const listJobsQuerySchema = z.object({
  lang: langSchema,
  city: optionalParam(z.string().trim().max(80)),
  contract: optionalParam(z.string().trim().max(40)),
  q: optionalParam(z.string().trim().max(120)),
});
export type ListJobsQuery = z.output<typeof listJobsQuerySchema>;

/** `GET /v1/jobs/{slug}` */
export const jobDetailQuerySchema = z.object({ lang: langSchema, preview: previewSchema });
export type JobDetailQuery = z.output<typeof jobDetailQuerySchema>;

// ─────────────────────────── Back-office : offres ───────────────────────────

/** Texte obligatoire : vide → « Ce champ est obligatoire. ». */
const requiredText = (max: number) => z.string().trim().min(1, { abort: true }).max(max);
/** Texte facultatif : `null` ou vide → `null`. */
const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((value) => (value ? value : null));
const listOf = (max: number) =>
  z.array(z.string().trim().min(1, { error: 'Complétez ou supprimez cette ligne.' }).max(max)).max(20);

export const SALARY_MAX_MESSAGE = 'Le maximum doit être supérieur ou égal au minimum.';

/** Schéma `JobSalary`. */
const salarySchema = z
  .object({
    min: z.number().int().min(0),
    max: z.number().int().min(0).nullable(),
    currency: z.enum(['XAF', 'EUR']),
    period: z.enum(['HOUR', 'DAY', 'WEEK', 'MONTH', 'YEAR']),
  })
  .superRefine((salary, ctx) => {
    if (salary.max !== null && salary.max < salary.min)
      ctx.addIssue({ code: 'custom', path: ['max'], message: SALARY_MAX_MESSAGE });
  });

/** Schéma `JobOfferFields` (champs modifiables d'une offre). */
const jobOfferFields = {
  title: requiredText(120),
  slug: z.string().trim().min(1, { abort: true }).max(SLUG_MAX_LENGTH).regex(SLUG_PATTERN, {
    error: 'L’adresse ne peut contenir que des lettres minuscules sans accents, des chiffres et des tirets.',
  }),
  city: requiredText(80),
  country: z
    .string()
    .trim()
    .regex(/^[A-Z]{2}$/, { error: 'Choisissez le pays.' }),
  contractType: requiredText(40),
  startDate: nullableText(60),
  workingTime: nullableText(60),
  locationLabel: nullableText(120),
  sectors: z.array(z.string().trim().min(1).max(80)).max(20),
  salary: salarySchema.nullable(),
  schedule: nullableText(120),
  summary: requiredText(1000),
  description: nullableText(3000),
  missions: listOf(300),
  profile: listOf(300),
  benefits: listOf(300),
  status: z.enum(PUBLISH_STATUSES),
  expiresAt: z.iso.datetime({ offset: true }).nullable(),
};

/** `POST /v1/admin/jobs` (`JobOfferInput`) : slug tiré du titre s'il est absent ; brouillon par défaut. */
export const jobOfferInputSchema = z.object({
  ...jobOfferFields,
  slug: jobOfferFields.slug.optional(),
  startDate: jobOfferFields.startDate.optional(),
  workingTime: jobOfferFields.workingTime.optional(),
  locationLabel: jobOfferFields.locationLabel.optional(),
  sectors: jobOfferFields.sectors.optional(),
  salary: jobOfferFields.salary.optional(),
  schedule: jobOfferFields.schedule.optional(),
  description: jobOfferFields.description.optional(),
  missions: jobOfferFields.missions.optional(),
  profile: jobOfferFields.profile.optional(),
  benefits: jobOfferFields.benefits.optional(),
  status: jobOfferFields.status.optional(),
  expiresAt: jobOfferFields.expiresAt.optional(),
});
export type JobOfferInput = z.output<typeof jobOfferInputSchema>;

/** `PATCH /v1/admin/jobs/{id}` (`JobOfferPatch`) : au moins un champ. */
export const jobOfferPatchSchema = z
  .object(jobOfferFields)
  .partial()
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), {
    error: 'Aucune modification à enregistrer.',
  });
export type JobOfferPatch = z.output<typeof jobOfferPatchSchema>;

/** `GET /v1/admin/jobs` */
export const listAdminJobsQuerySchema = z.object({ status: optionalParam(z.enum(PUBLISH_STATUSES)) });
export type ListAdminJobsQuery = z.output<typeof listAdminJobsQuerySchema>;

// ─────────────────────────── Back-office : candidatures ───────────────────────────

/** `GET /v1/admin/applications` */
export const listApplicationsQuerySchema = z.object({
  status: optionalParam(z.enum(APPLICATION_STATUSES)),
  job: optionalParam(z.string().trim().min(1).max(64)),
  page: pageSchema,
  pageSize: pageSizeSchema,
});
export type ListApplicationsQuery = z.output<typeof listApplicationsQuerySchema>;

/** `PATCH /v1/admin/applications/{id}` */
export const updateApplicationInputSchema = z.object({ status: z.enum(APPLICATION_STATUSES) });
export type UpdateApplicationInput = z.output<typeof updateApplicationInputSchema>;

// ─────────────────────────── Candidature publique ───────────────────────────

export const CV_REQUIRED_MESSAGE = 'Joignez votre CV (PDF, DOC ou DOCX, 5 Mo maximum).';

/**
 * `POST /v1/job-applications` (`JobApplicationInput`, `multipart/form-data` : champs à plat, chaînes) ; `cv` est le
 * fichier lu par multer, ajouté aux champs avant la validation. `jobSlug` vide → candidature spontanée.
 */
export const jobApplicationInputSchema = z
  .object({
    jobSlug: z
      .string()
      .trim()
      .max(SLUG_MAX_LENGTH)
      .optional()
      .transform((value) => (value ? value : null))
      .refine((value) => value === null || SLUG_PATTERN.test(value), {
        error: 'Choisissez un poste dans la liste.',
      }),
    fullName: z.string().trim().min(1, { abort: true }).min(2).max(120),
    email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
    phone: z
      .string()
      .trim()
      .min(1, { abort: true })
      .transform((value) => value.replace(/[\s.()-]/g, ''))
      .pipe(z.string().regex(/^\+[1-9]\d{6,14}$/, { error: PHONE_MESSAGE })),
    city: z.string().trim().min(1, { abort: true }).max(80),
    message: z
      .string()
      .trim()
      .max(3000)
      .optional()
      .transform((value) => (value ? value : null)),
    cv: z.custom<UploadedFile>(isUploadedFile, { error: CV_REQUIRED_MESSAGE }),
    consent: z.literal('true', { error: CONSENT_MESSAGE }),
    turnstileToken: z.string().max(4096),
    honeypot: z.string().max(4096).optional(),
    startedAt: z.iso.datetime({ offset: true }),
    /** Langue de l'envoi (absente du contrat) : celle des e-mails ; à défaut, l'en-tête `Accept-Language`. */
    lang: z.enum(LANGS).optional(),
  })
  .transform(({ turnstileToken, honeypot, startedAt, ...rest }) => ({
    ...rest,
    antiSpam: { turnstileToken, honeypot, startedAt },
  }));
export type JobApplicationInput = z.output<typeof jobApplicationInputSchema>;
