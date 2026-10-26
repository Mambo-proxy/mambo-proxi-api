import type { Prisma } from '../../generated/prisma/client.js';
import { mediaImageSelect } from '../media/visual.mapper.js';

/**
 * Requêtes Prisma du catalogue public : colonnes et relations strictement nécessaires aux réponses du contrat,
 * relations chargées dans la même requête (aucune requête par élément).
 */

/** Rubrique ou service publié (statut). */
export const PUBLISHED = 'PUBLISHED' as const;

/** Service publié : statut `PUBLISHED` et date de publication atteinte (ou non renseignée). */
export function publishedServiceWhere(now: Date): Prisma.ServiceWhereInput {
  return { status: PUBLISHED, OR: [{ publishedAt: null }, { publishedAt: { lte: now } }] };
}

/** Service visible sur le site : publié, dans une rubrique publiée. */
export function visibleServiceWhere(now: Date): Prisma.ServiceWhereInput {
  return { ...publishedServiceWhere(now), category: { status: PUBLISHED } };
}

export const categoryRefSelect = {
  slug: true,
  name: true,
  translations: true,
} satisfies Prisma.CategorySelect;

/** Colonnes de `ServiceSummary` (cartes, listes, menus). */
export const serviceSummarySelect = {
  id: true,
  slug: true,
  name: true,
  shortName: true,
  summary: true,
  icon: true,
  illustration: true,
  kind: true,
  featuredOnHome: true,
  showInMenu: true,
  sortOrder: true,
  translations: true,
  publishedAt: true,
  updatedAt: true,
  coverImage: { select: mediaImageSelect },
  category: { select: categoryRefSelect },
} satisfies Prisma.ServiceSelect;

export type ServiceSummaryRecord = Prisma.ServiceGetPayload<{ select: typeof serviceSummarySelect }>;

/** Avis publié (schéma `Review`) avec son service. */
export const reviewSelect = {
  id: true,
  authorName: true,
  city: true,
  rating: true,
  text: true,
  excerpt: true,
  verified: true,
  featured: true,
  date: true,
  reply: true,
  status: true,
  service: {
    select: { slug: true, name: true, translations: true, category: { select: categoryRefSelect } },
  },
} satisfies Prisma.ReviewSelect;

export type ReviewRecord = Prisma.ReviewGetPayload<{ select: typeof reviewSelect }>;

/** Carte d'un carrousel « Nos offres » (fiche service ou rubrique). */
export const offerSelect = {
  id: true,
  title: true,
  titleMobile: true,
  text: true,
  textMobile: true,
  icon: true,
  illustration: true,
  action: true,
  actionLabel: true,
  actionLabelMobile: true,
  translations: true,
  image: { select: mediaImageSelect },
  targetService: {
    select: { slug: true, status: true, publishedAt: true, category: { select: { status: true } } },
  },
} satisfies Prisma.ServiceOfferSelect;

export type OfferRecord = Prisma.ServiceOfferGetPayload<{ select: typeof offerSelect }>;

/** Résumé d'une rubrique (`CategorySummary`) avec ses services publiés (nombre, `include=services`, méga-menu). */
export function categorySummarySelect(now: Date) {
  return {
    id: true,
    slug: true,
    name: true,
    tagline: true,
    description: true,
    icon: true,
    iconColor: true,
    tint: true,
    illustration: true,
    visuals: true,
    homeCard: true,
    sortOrder: true,
    translations: true,
    updatedAt: true,
    image: { select: mediaImageSelect },
    services: {
      where: publishedServiceWhere(now),
      orderBy: [{ sortOrder: 'asc' }, { slug: 'asc' }],
      select: serviceSummarySelect,
    },
  } satisfies Prisma.CategorySelect;
}

export type CategorySummaryRecord = Prisma.CategoryGetPayload<{
  select: ReturnType<typeof categorySummarySelect>;
}>;

/** Contenu propre à la page rubrique (`CategoryDetail`), en plus du résumé. */
export const categoryDetailSelect = {
  id: true,
  eyebrow: true,
  heroTitle: true,
  heroLead: true,
  audiencesTitle: true,
  audiences: true,
  servicesTitle: true,
  servicesLead: true,
  groups: true,
  highlight: true,
  processEyebrow: true,
  processTitle: true,
  processSteps: true,
  quoteFields: true,
  ctaTitle: true,
  ctaText: true,
  seoTitle: true,
  seoDescription: true,
  translations: true,
  testimonial: { select: reviewSelect },
  offerSections: {
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      eyebrow: true,
      title: true,
      titleMobile: true,
      lead: true,
      leadMobile: true,
      translations: true,
      offers: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], select: offerSelect },
    },
  },
} satisfies Prisma.CategorySelect;

export type CategoryDetailRecord = Prisma.CategoryGetPayload<{ select: typeof categoryDetailSelect }>;

/** Fiche service (`ServiceDetail`). */
export const serviceDetailSelect = {
  ...serviceSummarySelect,
  tagline: true,
  cities: true,
  audiences: true,
  steps: true,
  advantages: true,
  faq: true,
  quoteBullets: true,
  offersEyebrow: true,
  offersTitle: true,
  offersLead: true,
  offersLeadMobile: true,
  showWhatsapp: true,
  reviewsTitle: true,
  relatedTitle: true,
  ctaTitle: true,
  ctaText: true,
  seoTitle: true,
  seoDescription: true,
  toComplete: true,
  gallery: {
    orderBy: [{ sortOrder: 'asc' }, { mediaId: 'asc' }],
    take: 3,
    select: { alt: true, media: { select: mediaImageSelect } },
  },
  offers: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], take: 12, select: offerSelect },
  related: {
    orderBy: [{ sortOrder: 'asc' }, { relatedServiceId: 'asc' }],
    select: {
      relatedService: {
        select: {
          ...serviceSummarySelect,
          status: true,
          category: { select: { ...categoryRefSelect, status: true } },
        },
      },
    },
  },
  featuredReviews: {
    orderBy: [{ sortOrder: 'asc' }, { reviewId: 'asc' }],
    select: { review: { select: reviewSelect } },
  },
} satisfies Prisma.ServiceSelect;

export type ServiceDetailRecord = Prisma.ServiceGetPayload<{ select: typeof serviceDetailSelect }>;
