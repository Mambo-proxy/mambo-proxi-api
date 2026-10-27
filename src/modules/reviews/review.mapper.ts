import { asArray, asObject } from '../../common/json/json-read.js';
import { CACHE_TAGS } from '../../common/revalidation/revalidation.js';
import type { Prisma, ReviewStatus } from '../../generated/prisma/client.js';
import { initialsOf } from '../catalog/catalog.mapper.js';

/** Avis du back-office (schéma `AdminReview` du contrat). */
export interface AdminReview {
  id: string;
  authorName: string;
  initials: string;
  city: string | null;
  rating: number;
  text: string;
  service: { slug: string; name: string } | null;
  requestReference: string | null;
  serviceDate: string | null;
  status: ReviewStatus;
  verified: boolean;
  featured: boolean;
  publishConsent: boolean;
  answers: { question: string; answer: string }[];
  reply: string | null;
  publishedAt: string | null;
  createdAt: string;
}

export const ADMIN_REVIEW_SELECT = {
  id: true,
  authorName: true,
  city: true,
  rating: true,
  text: true,
  status: true,
  verified: true,
  featured: true,
  publishConsent: true,
  answersSnapshot: true,
  serviceDate: true,
  reply: true,
  publishedAt: true,
  createdAt: true,
  serviceId: true,
  service: { select: { slug: true, name: true } },
  survey: { select: { request: { select: { reference: true, anonymizedAt: true } } } },
} satisfies Prisma.ReviewSelect;

export type AdminReviewRow = Prisma.ReviewGetPayload<{ select: typeof ADMIN_REVIEW_SELECT }>;

/** Réponses au questionnaire `[{ question, answer }]` (instantané pris à la réponse). */
function answersOf(snapshot: unknown): AdminReview['answers'] {
  return asArray(snapshot).flatMap((item) => {
    const entry = asObject(item);
    const question = entry['question'];
    const answer = entry['answer'];
    return typeof question === 'string' && typeof answer === 'string' ? [{ question, answer }] : [];
  });
}

export function toAdminReview(row: AdminReviewRow): AdminReview {
  const request = row.survey?.request ?? null;
  return {
    id: row.id,
    authorName: row.authorName,
    initials: initialsOf(row.authorName),
    city: row.city,
    rating: row.rating,
    text: row.text,
    service: row.service ? { slug: row.service.slug, name: row.service.name } : null,
    requestReference: request && request.anonymizedAt === null ? request.reference : null,
    serviceDate: row.serviceDate?.toISOString() ?? null,
    status: row.status,
    verified: row.verified,
    featured: row.featured,
    publishConsent: row.publishConsent,
    answers: answersOf(row.answersSnapshot),
    reply: row.reply,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Étiquettes de cache du site touchées par un avis publié (ou qui vient de cesser de l'être) : listes et synthèse
 * (`reviews`, accueil et page « Avis clients »), fiche de son service (avis et note), rubriques qui le citent en
 * témoignage.
 */
export function reviewCacheTags(
  serviceSlugs: Iterable<string | null | undefined>,
  categorySlugs: Iterable<string> = [],
): string[] {
  const tags: string[] = [CACHE_TAGS.reviews];
  for (const slug of serviceSlugs) if (slug) tags.push(CACHE_TAGS.service(slug));
  for (const slug of categorySlugs) tags.push(CACHE_TAGS.category(slug));
  return tags;
}
