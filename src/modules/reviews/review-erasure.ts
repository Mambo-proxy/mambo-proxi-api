import { requestRevalidation } from '../../common/revalidation/revalidation.js';
import { Prisma } from '../../generated/prisma/client.js';
import { reviewCacheTags } from './review.mapper.js';

/** Nom affiché d'un avis dont l'auteur a été effacé ou la demande anonymisée. */
export const ERASED_REVIEW_AUTHOR = 'Client anonymisé';

/**
 * Avis issus des questionnaires de demandes anonymisées (anonymisation d'une demande, droit à l'effacement d'un
 * contact) : nom affiché, ville et réponses retirés, avis masqué et consentement retiré (il ne peut plus être
 * publié), mise en avant levée. Un avis qui était publié inscrit une demande de revalidation du site. À appeler
 * dans la transaction de l'anonymisation.
 */
export async function anonymizeReviewsOfRequests(
  tx: Prisma.TransactionClient,
  requestIds: readonly string[],
): Promise<void> {
  if (requestIds.length === 0) return;
  const surveys = await tx.survey.findMany({
    where: { requestId: { in: [...requestIds] } },
    select: { id: true },
  });
  if (surveys.length === 0) return;
  const reviews = await tx.review.findMany({
    where: { surveyId: { in: surveys.map((survey) => survey.id) } },
    select: { id: true, status: true, serviceId: true },
  });
  if (reviews.length === 0) return;
  await tx.review.updateMany({
    where: { id: { in: reviews.map((review) => review.id) } },
    data: {
      authorName: ERASED_REVIEW_AUTHOR,
      city: null,
      answersSnapshot: Prisma.DbNull,
      status: 'MASQUE',
      featured: false,
      publishConsent: false,
    },
  });
  const published = reviews.filter((review) => review.status === 'PUBLIE');
  if (published.length === 0) return;
  const publishedIds = published.map((review) => review.id);
  const featuredOn = await tx.serviceFeaturedReview.findMany({
    where: { reviewId: { in: publishedIds } },
    select: { serviceId: true },
  });
  const serviceIds = [
    ...new Set([
      ...published.flatMap((review) => (review.serviceId ? [review.serviceId] : [])),
      ...featuredOn.map((item) => item.serviceId),
    ]),
  ];
  const services =
    serviceIds.length === 0
      ? []
      : await tx.service.findMany({ where: { id: { in: serviceIds } }, select: { slug: true } });
  const categories = await tx.category.findMany({
    where: { testimonialId: { in: publishedIds } },
    select: { slug: true },
  });
  await requestRevalidation(
    tx,
    reviewCacheTags(
      services.map((service) => service.slug),
      categories.map((category) => category.slug),
    ),
  );
}
