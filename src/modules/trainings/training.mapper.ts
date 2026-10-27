import type { Lang } from '../../common/i18n/lang.js';
import { localizeFields } from '../../common/i18n/translations.js';
import type { Prisma, PublishStatus, TrainingCategory } from '../../generated/prisma/client.js';

/** Libellés des catégories (`categoryLabel`), dans la langue du site. */
export const TRAINING_CATEGORY_LABELS: Record<Lang, Record<TrainingCategory, string>> = {
  fr: { PROFESSIONNELS: 'Professionnels', ATELIERS: 'Ateliers', SENSIBILISATION: 'Sensibilisation' },
  en: { PROFESSIONNELS: 'Professionals', ATELIERS: 'Workshops', SENSIBILISATION: 'Awareness' },
};

export const TRAINING_SELECT = {
  id: true,
  slug: true,
  title: true,
  category: true,
  audienceLabel: true,
  icon: true,
  duration: true,
  format: true,
  location: true,
  description: true,
  status: true,
  sortOrder: true,
  translations: true,
} as const satisfies Prisma.TrainingSelect;

export type TrainingRow = Prisma.TrainingGetPayload<{ select: typeof TRAINING_SELECT }>;

/** Schéma `Training` du contrat. */
export interface Training {
  id: string;
  slug: string;
  title: string;
  category: TrainingCategory;
  categoryLabel: string;
  audienceLabel: string;
  icon: string;
  duration: string;
  format: string;
  location: string | null;
  description: string | null;
}

/** Schéma `AdminTraining` du contrat. */
export interface AdminTraining extends Training {
  status: PublishStatus;
  sortOrder: number;
  requestsCount: number;
}

/** Champs traduisibles (`translations.en`). */
const TRANSLATABLE = ['title', 'audienceLabel', 'duration', 'format', 'location', 'description'] as const;

export const TRAINING_ORDER = [
  { sortOrder: 'asc' },
  { title: 'asc' },
] as const satisfies Prisma.TrainingOrderByWithRelationInput[];

export function toTraining(row: TrainingRow, lang: Lang): Training {
  const base: Training = {
    id: row.id,
    slug: row.slug,
    title: row.title,
    category: row.category,
    categoryLabel: TRAINING_CATEGORY_LABELS[lang][row.category],
    audienceLabel: row.audienceLabel,
    icon: row.icon,
    duration: row.duration,
    format: row.format,
    location: row.location,
    description: row.description,
  };
  return localizeFields(base, row.translations, lang, TRANSLATABLE);
}

export function toAdminTraining(row: TrainingRow, requestsCount: number): AdminTraining {
  return { ...toTraining(row, 'fr'), status: row.status, sortOrder: row.sortOrder, requestsCount };
}
