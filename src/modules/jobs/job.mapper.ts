import type { Lang } from '../../common/i18n/lang.js';
import { localizeFields } from '../../common/i18n/translations.js';
import { DAY_MS } from '../../common/time/agency-day.js';
import type {
  ApplicationStatus,
  ContactProfile,
  Currency,
  Prisma,
  PublishStatus,
  SalaryPeriod,
} from '../../generated/prisma/client.js';
import {
  CONTACT_SUMMARY_SELECT,
  toContactSummary,
  type ContactSummary,
} from '../contacts/contact-summary.js';

/** Badge « Nouveau » : offre publiée il y a moins de 7 jours. */
export const NEW_JOB_DAYS = 7;

/** Schéma `JobSalary`. */
export interface JobSalary {
  min: number;
  max: number | null;
  currency: Currency;
  period: SalaryPeriod;
}

/** Schéma `JobOfferSummary`. */
export interface JobOfferSummary {
  id: string;
  slug: string;
  title: string;
  city: string;
  country: string;
  contractType: string;
  summary: string;
  publishedAt: string;
  isNew: boolean;
}

/** Schéma `JobOfferDetail`. */
export interface JobOfferDetail extends JobOfferSummary {
  startDate: string | null;
  workingTime: string | null;
  locationLabel: string | null;
  sectors: string[];
  salary: JobSalary | null;
  schedule: string | null;
  description: string | null;
  missions: string[];
  profile: string[];
  benefits: string[];
  expiresAt: string | null;
}

/** Schéma `AdminJobOffer`. */
export interface AdminJobOffer {
  id: string;
  title: string;
  slug: string;
  city: string;
  country: string;
  contractType: string;
  startDate: string | null;
  workingTime: string | null;
  locationLabel: string | null;
  sectors: string[];
  salary: JobSalary | null;
  schedule: string | null;
  summary: string;
  description: string | null;
  missions: string[];
  profile: string[];
  benefits: string[];
  status: PublishStatus;
  expiresAt: string | null;
  applicationsCount: number;
  newApplicationsCount: number;
  publishedAt: string | null;
  createdAt: string;
}

/** Colonnes d'une offre (public et back-office). */
export const JOB_OFFER_SELECT = {
  id: true,
  slug: true,
  title: true,
  city: true,
  country: true,
  contractType: true,
  startDate: true,
  workingTime: true,
  locationLabel: true,
  sectors: true,
  salaryMin: true,
  salaryMax: true,
  salaryCurrency: true,
  salaryPeriod: true,
  schedule: true,
  summary: true,
  description: true,
  missions: true,
  profile: true,
  benefits: true,
  status: true,
  publishedAt: true,
  expiresAt: true,
  translations: true,
  createdAt: true,
} as const satisfies Prisma.JobOfferSelect;

export type JobOfferRow = Prisma.JobOfferGetPayload<{ select: typeof JOB_OFFER_SELECT }>;

/** Champs traduisibles (`translations.en`). */
const TRANSLATED_FIELDS = [
  'title',
  'city',
  'contractType',
  'startDate',
  'workingTime',
  'locationLabel',
  'sectors',
  'schedule',
  'summary',
  'description',
  'missions',
  'profile',
  'benefits',
] as const satisfies readonly (keyof JobOfferRow)[];

/** Offre visible sur le site : publiée, date de publication passée, non expirée. */
export function visibleJobWhere(now: Date): Prisma.JobOfferWhereInput {
  return {
    status: 'PUBLISHED',
    OR: [{ publishedAt: null }, { publishedAt: { lte: now } }],
    AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }],
  };
}

export function salaryOf(
  row: Pick<JobOfferRow, 'salaryMin' | 'salaryMax' | 'salaryCurrency' | 'salaryPeriod'>,
): JobSalary | null {
  if (row.salaryMin === null || row.salaryCurrency === null || row.salaryPeriod === null) return null;
  return { min: row.salaryMin, max: row.salaryMax, currency: row.salaryCurrency, period: row.salaryPeriod };
}

function localized(row: JobOfferRow, lang: Lang): JobOfferRow {
  return localizeFields(row, row.translations, lang, TRANSLATED_FIELDS);
}

export function toJobOfferSummary(row: JobOfferRow, lang: Lang, now: Date): JobOfferSummary {
  const job = localized(row, lang);
  const publishedAt = job.publishedAt ?? job.createdAt;
  return {
    id: job.id,
    slug: job.slug,
    title: job.title,
    city: job.city,
    country: job.country,
    contractType: job.contractType,
    summary: job.summary,
    publishedAt: publishedAt.toISOString(),
    isNew: now.getTime() - publishedAt.getTime() < NEW_JOB_DAYS * DAY_MS,
  };
}

export function toJobOfferDetail(row: JobOfferRow, lang: Lang, now: Date): JobOfferDetail {
  const job = localized(row, lang);
  return {
    ...toJobOfferSummary(row, lang, now),
    startDate: job.startDate,
    workingTime: job.workingTime,
    locationLabel: job.locationLabel,
    sectors: job.sectors,
    salary: salaryOf(job),
    schedule: job.schedule,
    description: job.description,
    missions: job.missions,
    profile: job.profile,
    benefits: job.benefits,
    expiresAt: job.expiresAt?.toISOString() ?? null,
  };
}

export function toAdminJobOffer(
  row: JobOfferRow,
  counts: { applications: number; newApplications: number },
): AdminJobOffer {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    city: row.city,
    country: row.country,
    contractType: row.contractType,
    startDate: row.startDate,
    workingTime: row.workingTime,
    locationLabel: row.locationLabel,
    sectors: row.sectors,
    salary: salaryOf(row),
    schedule: row.schedule,
    summary: row.summary,
    description: row.description,
    missions: row.missions,
    profile: row.profile,
    benefits: row.benefits,
    status: row.status,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    applicationsCount: counts.applications,
    newApplicationsCount: counts.newApplications,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

// ─────────────────────────── Candidatures ───────────────────────────

/** Libellés des statuts de candidature (journal d'activité). */
export const APPLICATION_STATUS_LABELS: Record<ApplicationStatus, string> = {
  NOUVEAU: 'Nouveau',
  LU: 'Lu',
  RETENU: 'Retenu',
  REFUSE: 'Refusé',
};

/** Schéma `Attachment`. */
export interface AttachmentSummary {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
}

/** Schéma `AdminApplication`. */
export interface AdminApplication {
  id: string;
  requestId: string;
  reference: string;
  status: ApplicationStatus;
  job: { id: string; title: string } | null;
  contact: ContactSummary;
  message: string | null;
  cv: AttachmentSummary;
  createdAt: string;
}

export const ADMIN_APPLICATION_SELECT = {
  id: true,
  requestId: true,
  status: true,
  createdAt: true,
  jobOffer: { select: { id: true, title: true } },
  cvAttachment: { select: { id: true, fileName: true, mimeType: true, size: true } },
  request: {
    select: {
      reference: true,
      subject: true,
      message: true,
      contact: { select: CONTACT_SUMMARY_SELECT },
    },
  },
} as const satisfies Prisma.JobApplicationSelect;

export interface AdminApplicationRow {
  id: string;
  requestId: string;
  status: ApplicationStatus;
  createdAt: Date;
  jobOffer: { id: string; title: string } | null;
  cvAttachment: AttachmentSummary;
  request: {
    reference: string;
    subject: string | null;
    message: string | null;
    contact: {
      id: string;
      fullName: string;
      email: string;
      phone: string | null;
      country: string | null;
      city: string | null;
      profile: ContactProfile;
    };
  };
}

export function toAdminApplication(row: AdminApplicationRow): AdminApplication {
  return {
    id: row.id,
    requestId: row.requestId,
    reference: row.request.reference,
    status: row.status,
    job: row.jobOffer ? { id: row.jobOffer.id, title: row.jobOffer.title } : null,
    contact: toContactSummary(row.request.contact),
    message: row.request.message,
    cv: {
      id: row.cvAttachment.id,
      fileName: row.cvAttachment.fileName,
      mimeType: row.cvAttachment.mimeType,
      size: row.cvAttachment.size,
    },
    createdAt: row.createdAt.toISOString(),
  };
}

/** Lien du back-office vers une candidature (écran Recrutement). */
export function adminApplicationPath(applicationId: string): string {
  return `/admin/recrutement?candidature=${encodeURIComponent(applicationId)}`;
}
