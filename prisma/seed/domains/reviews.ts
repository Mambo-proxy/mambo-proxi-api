// Avis clients de démonstration (publiés, à valider, masqués), questionnaires correspondants, avis mis en avant
// sur les fiches services et témoignages des pages rubriques.
import { Language, SurveyStatus } from '../../../src/generated/prisma/client.js';
import { logCount, mapId, nullableJson, readSeedData, sha256, type SeedClock, type Tx } from '../support.js';
import type { ReviewsSeed } from '../types.js';
import type { CatalogueIds } from './catalogue.js';

const SURVEY_VALIDITY_MS = 30 * 86_400_000;

export async function seedReviews(tx: Tx, clock: SeedClock, catalogue: CatalogueIds): Promise<void> {
  const { reviews, featuredReviews, surveys } = readSeedData<ReviewsSeed>('reviews');

  // Questionnaires remplis (jeton de démonstration inutilisable : seul un condensat est stocké).
  for (const { id, ...survey } of surveys) {
    const completedAt = clock.date(survey.completedAt);
    const data = {
      requestId: survey.requestId,
      status: SurveyStatus.ANSWERED,
      language: Language.FR,
      sentAt: clock.date(survey.sentAt),
      expiresAt: new Date(completedAt.getTime() + SURVEY_VALIDITY_MS),
      completedAt,
      answers: survey.answers,
      rating: survey.rating,
      npsScore: survey.npsScore,
      publishConsent: survey.publishConsent,
      displayName: survey.displayName,
      city: survey.city,
    };
    await tx.survey.upsert({
      where: { id },
      update: data,
      create: { ...data, id, tokenHash: sha256(`demo-survey:${id}`) },
    });
  }
  logCount('Questionnaires remplis', surveys.length);

  for (const { id, surveyId, ...review } of reviews) {
    const data = {
      ...review,
      serviceId: mapId(catalogue.services, review.serviceId),
      surveyId: surveyId ?? null,
      answersSnapshot: nullableJson(review.answersSnapshot),
      serviceDate: clock.optionalDate(review.serviceDate),
      date: clock.date(review.date),
      publishedAt: clock.optionalDate(review.publishedAt),
      createdAt: clock.date(review.createdAt),
      isDemo: true,
    };
    await tx.review.upsert({ where: { id }, update: data, create: { ...data, id } });
  }
  logCount('Avis', reviews.length);

  const featured = featuredReviews.flatMap((link) => {
    const serviceId = catalogue.services.get(link.serviceId);
    return serviceId ? [{ serviceId, reviewId: link.reviewId, sortOrder: link.sortOrder }] : [];
  });
  await tx.serviceFeaturedReview.createMany({ data: featured, skipDuplicates: true });
  logCount('Avis mis en avant sur les fiches', featured.length);

  // Témoignage des pages rubriques : relié seulement s'il n'a pas été choisi dans le back-office.
  const { categories } = readSeedData<{ categories: { id: string; testimonialId: string | null }[] }>(
    'catalogue',
  );
  let testimonials = 0;
  for (const category of categories) {
    const categoryId = catalogue.categories.get(category.id);
    if (!categoryId || !category.testimonialId) continue;
    const { count } = await tx.category.updateMany({
      where: { id: categoryId, testimonialId: null },
      data: { testimonialId: category.testimonialId },
    });
    testimonials += count;
  }
  logCount('Témoignages des rubriques (reliés)', testimonials);
}
