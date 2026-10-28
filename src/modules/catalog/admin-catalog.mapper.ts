import { asObject, asObjectArray, type JsonObject } from '../../common/json/json-read.js';
import type { CategoryTint, Prisma, PublishStatus } from '../../generated/prisma/client.js';
import type { MediaImage, Visual } from '../media/visual.mapper.js';
import { mediaImageSelect } from '../media/visual.mapper.js';
import type { ContractTint } from './admin-catalog.schemas.js';
import { serviceHref } from './catalog.mapper.js';
import {
  CATEGORY_TEXT_FIELDS,
  catalogTranslationView,
  SERVICE_TEXT_FIELDS,
  type CatalogTranslationView,
} from './catalog-translations.js';

/**
 * Formats du back-office pour les services et les rubriques (`AdminServiceListItem`, `AdminService`,
 * `Completeness`, `AdminCategory` du contrat) : tous statuts, champs bruts en français, plus la version anglaise des
 * textes modifiables et son statut (`catalogTranslationView`).
 */

export const TINT_TO_CONTRACT: Record<CategoryTint, ContractTint> = {
  ORANGE_50: 'orange-50',
  NEUTRAL_100: 'neutral-100',
  VERT_50: 'vert-50',
  NEUTRAL_900: 'neutral-900',
};

export const TINT_FROM_CONTRACT: Record<ContractTint, CategoryTint> = {
  'orange-50': 'ORANGE_50',
  'neutral-100': 'NEUTRAL_100',
  'vert-50': 'VERT_50',
  'neutral-900': 'NEUTRAL_900',
};

/** Carte d'offre telle qu'enregistrée (fiche service ou carrousel de rubrique). */
export const adminOfferSelect = {
  id: true,
  title: true,
  titleMobile: true,
  text: true,
  textMobile: true,
  icon: true,
  illustration: true,
  imageId: true,
  action: true,
  actionLabel: true,
  actionLabelMobile: true,
  targetServiceId: true,
  sortOrder: true,
  translations: true,
  image: { select: mediaImageSelect },
} satisfies Prisma.ServiceOfferSelect;

export type AdminOfferRecord = Prisma.ServiceOfferGetPayload<{ select: typeof adminOfferSelect }>;

/** Service à éditer, avec ses listes ordonnées (galerie, services liés, avis mis en avant, offres). */
export const adminServiceSelect = {
  id: true,
  slug: true,
  name: true,
  shortName: true,
  categoryId: true,
  kind: true,
  tagline: true,
  summary: true,
  icon: true,
  illustration: true,
  coverImageId: true,
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
  showInMenu: true,
  featuredOnHome: true,
  showWhatsapp: true,
  reviewsTitle: true,
  relatedTitle: true,
  ctaTitle: true,
  ctaText: true,
  seoTitle: true,
  seoDescription: true,
  toComplete: true,
  status: true,
  sortOrder: true,
  version: true,
  publishedAt: true,
  translations: true,
  isDemo: true,
  updatedAt: true,
  category: { select: { id: true, slug: true, name: true, status: true, sortOrder: true } },
  coverImage: { select: mediaImageSelect },
  gallery: { orderBy: [{ sortOrder: 'asc' }, { mediaId: 'asc' }], select: { mediaId: true } },
  related: {
    orderBy: [{ sortOrder: 'asc' }, { relatedServiceId: 'asc' }],
    select: { relatedServiceId: true },
  },
  featuredReviews: { orderBy: [{ sortOrder: 'asc' }, { reviewId: 'asc' }], select: { reviewId: true } },
  offers: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], select: adminOfferSelect },
} satisfies Prisma.ServiceSelect;

export type AdminServiceRecord = Prisma.ServiceGetPayload<{ select: typeof adminServiceSelect }>;

/** Largeur minimale de la photo principale « en haute définition » (variante la plus large des médias). */
export const HD_WIDTH = 1600;

export type CompletenessKey =
  'general' | 'audiences' | 'steps' | 'advantages' | 'faq' | 'related' | 'coverImage';

export interface Completeness {
  percent: number;
  criteria: { key: CompletenessKey; label: string; done: boolean }[];
}

const COMPLETENESS_LABELS: Record<CompletenessKey, string> = {
  general: 'Informations générales',
  audiences: 'Public',
  steps: 'Étapes',
  advantages: 'Avantages',
  faq: 'Questions fréquentes',
  related: 'Services liés',
  coverImage: 'Photo principale en haute définition',
};

const filled = (value: unknown): boolean => typeof value === 'string' && value.trim() !== '';

/**
 * Indicateur de complétude (7 critères, docs/05 §4 ; règles du back-office simulé) : informations générales (nom
 * d'au moins 2 caractères, rubrique, accroche, description courte), au moins un public, une étape, un avantage,
 * une question avec sa réponse, un service lié, et une photo principale d'au moins 1 600 px de large.
 * Pourcentage = critères remplis / 7, arrondi.
 */
export function serviceCompleteness(service: AdminServiceRecord): Completeness {
  const done: Record<CompletenessKey, boolean> = {
    general:
      service.name.trim().length >= 2 &&
      service.categoryId !== '' &&
      filled(service.tagline) &&
      filled(service.summary),
    audiences: service.audiences.some(filled),
    steps: asObjectArray(service.steps).some((step) => filled(step['title'])),
    advantages: asObjectArray(service.advantages).some((item) => filled(item['title'])),
    faq: asObjectArray(service.faq).some((item) => filled(item['question']) && filled(item['answer'])),
    related: service.related.length > 0,
    coverImage:
      service.coverImage !== null &&
      service.coverImage.status !== 'FAILED' &&
      (service.coverImage.width ?? 0) >= HD_WIDTH,
  };
  const criteria = (Object.keys(COMPLETENESS_LABELS) as CompletenessKey[]).map((key) => ({
    key,
    label: COMPLETENESS_LABELS[key],
    done: done[key],
  }));
  const count = criteria.filter((criterion) => criterion.done).length;
  return { percent: Math.round((count / criteria.length) * 100), criteria };
}

/** Valeur de l'en-tête `If-Match` (et du champ `version`) : `v<numéro>`. */
export function serviceVersion(version: number): string {
  return `v${String(version)}`;
}

/** Version demandée par `If-Match` (`v3`, `"v3"`, `W/"v3"`), sans guillemets. */
export function parseIfMatch(header: string | undefined): string | undefined {
  if (header === undefined || header.trim() === '' || header.trim() === '*') return undefined;
  return header
    .trim()
    .replace(/^W\//, '')
    .replace(/^"(.*)"$/, '$1');
}

export interface MediaResolver {
  image(media: AdminServiceRecord['coverImage']): MediaImage | null;
  visual(
    illustration: AdminServiceRecord['illustration'],
    media: AdminServiceRecord['coverImage'],
    alt?: string | null,
  ): Visual;
}

export interface AdminOffer {
  id: string;
  title: string;
  titleMobile: string | null;
  text: string;
  textMobile: string | null;
  icon: string | null;
  illustration: string;
  imageId: string | null;
  image: MediaImage | null;
  action: 'QUOTE' | 'BOOKING';
  actionLabel: string;
  actionLabelMobile: string | null;
  serviceId: string | null;
}

export function toAdminOffer(offer: AdminOfferRecord, media: MediaResolver): AdminOffer {
  return {
    id: offer.id,
    title: offer.title,
    titleMobile: offer.titleMobile,
    text: offer.text,
    textMobile: offer.textMobile,
    icon: offer.icon,
    illustration: offer.illustration,
    imageId: offer.imageId,
    image: media.image(offer.image),
    action: offer.action,
    actionLabel: offer.actionLabel,
    actionLabelMobile: offer.actionLabelMobile,
    serviceId: offer.targetServiceId,
  };
}

/** Schéma `AdminServiceListItem` du contrat. */
export interface AdminServiceListItem {
  id: string;
  slug: string;
  name: string;
  category: { slug: string; name: string };
  status: PublishStatus;
  showInMenu: boolean;
  featuredOnHome: boolean;
  sortOrder: number;
  visual: Visual;
  path: string;
  requests30d: number;
  completeness: number;
  toComplete: boolean;
  isDemo: boolean;
  updatedAt: string;
}

/** Schéma `AdminService` du contrat (champs bruts, plus `categoryId` et les titres des blocs). */
export interface AdminService extends AdminServiceListItem, CatalogTranslationView {
  categoryId: string;
  shortName: string | null;
  tagline: string;
  summary: string;
  icon: string;
  illustration: string;
  coverImageId: string | null;
  coverImage: MediaImage | null;
  galleryImageIds: string[];
  cities: string[];
  audiences: string[];
  steps: JsonObject[];
  advantages: JsonObject[];
  faq: JsonObject[];
  quoteBullets: string[];
  offersEyebrow: string | null;
  offersTitle: string | null;
  offersLead: string | null;
  offersLeadMobile: string | null;
  offers: AdminOffer[];
  relatedServiceIds: string[];
  featuredReviewIds: string[];
  showWhatsapp: boolean;
  reviewsTitle: string | null;
  relatedTitle: string | null;
  ctaTitle: string | null;
  ctaText: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  publishedAt: string | null;
  completenessDetail: Completeness;
  version: string;
}

export function servicePath(service: Pick<AdminServiceRecord, 'slug' | 'kind' | 'category'>): string {
  return serviceHref(service.category.slug, service.slug, service.kind);
}

export function toAdminServiceListItem(
  service: AdminServiceRecord,
  media: MediaResolver,
  requests30d: number,
): AdminServiceListItem {
  return {
    id: service.id,
    slug: service.slug,
    name: service.name,
    category: { slug: service.category.slug, name: service.category.name },
    status: service.status,
    showInMenu: service.showInMenu,
    featuredOnHome: service.featuredOnHome,
    sortOrder: service.sortOrder,
    visual: media.visual(service.illustration, service.coverImage),
    path: servicePath(service),
    requests30d,
    completeness: serviceCompleteness(service).percent,
    toComplete: service.toComplete,
    isDemo: service.isDemo,
    updatedAt: service.updatedAt.toISOString(),
  };
}

export function toAdminService(
  service: AdminServiceRecord,
  media: MediaResolver,
  requests30d: number,
): AdminService {
  return {
    ...toAdminServiceListItem(service, media, requests30d),
    categoryId: service.categoryId,
    shortName: service.shortName,
    tagline: service.tagline,
    summary: service.summary,
    icon: service.icon,
    illustration: service.illustration,
    coverImageId: service.coverImageId,
    coverImage: media.image(service.coverImage),
    galleryImageIds: service.gallery.map((item) => item.mediaId),
    cities: service.cities,
    audiences: service.audiences,
    steps: asObjectArray(service.steps),
    advantages: asObjectArray(service.advantages),
    faq: asObjectArray(service.faq),
    quoteBullets: service.quoteBullets,
    offersEyebrow: service.offersEyebrow,
    offersTitle: service.offersTitle,
    offersLead: service.offersLead,
    offersLeadMobile: service.offersLeadMobile,
    offers: service.offers.map((offer) => toAdminOffer(offer, media)),
    relatedServiceIds: service.related.map((item) => item.relatedServiceId),
    featuredReviewIds: service.featuredReviews.map((item) => item.reviewId),
    showWhatsapp: service.showWhatsapp,
    reviewsTitle: service.reviewsTitle,
    relatedTitle: service.relatedTitle,
    ctaTitle: service.ctaTitle,
    ctaText: service.ctaText,
    seoTitle: service.seoTitle,
    seoDescription: service.seoDescription,
    publishedAt: service.publishedAt?.toISOString() ?? null,
    completenessDetail: serviceCompleteness(service),
    version: serviceVersion(service.version),
    ...catalogTranslationView(SERVICE_TEXT_FIELDS, service, service.translations),
  };
}

// ─────────────────────────────── Rubriques ───────────────────────────────

export const adminCategorySelect = {
  id: true,
  slug: true,
  name: true,
  tagline: true,
  description: true,
  eyebrow: true,
  heroTitle: true,
  heroLead: true,
  audiencesTitle: true,
  servicesTitle: true,
  servicesLead: true,
  processTitle: true,
  homeCard: true,
  icon: true,
  illustration: true,
  imageId: true,
  tint: true,
  status: true,
  audiences: true,
  processSteps: true,
  testimonialId: true,
  groups: true,
  highlight: true,
  quoteFields: true,
  ctaTitle: true,
  ctaText: true,
  seoTitle: true,
  seoDescription: true,
  sortOrder: true,
  translations: true,
  isDemo: true,
  updatedAt: true,
  offerSections: {
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      eyebrow: true,
      title: true,
      titleMobile: true,
      lead: true,
      leadMobile: true,
      offers: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], select: adminOfferSelect },
    },
  },
  _count: { select: { services: true } },
} satisfies Prisma.CategorySelect;

export type AdminCategoryRecord = Prisma.CategoryGetPayload<{ select: typeof adminCategorySelect }>;

/** Schéma `AdminCategory` du contrat. */
export interface AdminCategory extends CatalogTranslationView {
  id: string;
  slug: string;
  name: string;
  tagline: string;
  description: string;
  eyebrow: string | null;
  heroTitle: string;
  heroLead: string;
  audiencesTitle: string | null;
  servicesTitle: string | null;
  servicesLead: string | null;
  processTitle: string | null;
  homeCard: JsonObject;
  icon: string;
  illustration: string;
  imageId: string | null;
  tint: ContractTint;
  status: PublishStatus;
  audiences: JsonObject[];
  processSteps: JsonObject[];
  testimonialId: string | null;
  groups: JsonObject[];
  highlight: JsonObject | null;
  offerSections: (JsonObject & { offers: AdminOffer[] })[];
  quoteFields: JsonObject[];
  ctaTitle: string | null;
  ctaText: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  sortOrder: number;
  serviceCount: number;
  updatedAt: string;
}

export function toAdminCategory(category: AdminCategoryRecord, media: MediaResolver): AdminCategory {
  const highlight = asObject(category.highlight);
  return {
    id: category.id,
    slug: category.slug,
    name: category.name,
    tagline: category.tagline,
    description: category.description,
    eyebrow: category.eyebrow,
    heroTitle: category.heroTitle,
    heroLead: category.heroLead,
    audiencesTitle: category.audiencesTitle,
    servicesTitle: category.servicesTitle,
    servicesLead: category.servicesLead,
    processTitle: category.processTitle,
    homeCard: asObject(category.homeCard),
    icon: category.icon,
    illustration: category.illustration,
    imageId: category.imageId,
    tint: TINT_TO_CONTRACT[category.tint],
    status: category.status,
    audiences: asObjectArray(category.audiences),
    processSteps: asObjectArray(category.processSteps),
    testimonialId: category.testimonialId,
    groups: asObjectArray(category.groups),
    highlight: Object.keys(highlight).length === 0 ? null : highlight,
    offerSections: category.offerSections.map((section) => ({
      id: section.id,
      eyebrow: section.eyebrow,
      title: section.title,
      titleMobile: section.titleMobile,
      lead: section.lead,
      leadMobile: section.leadMobile,
      offers: section.offers.map((offer) => toAdminOffer(offer, media)),
    })),
    quoteFields: asObjectArray(category.quoteFields),
    ctaTitle: category.ctaTitle,
    ctaText: category.ctaText,
    seoTitle: category.seoTitle,
    seoDescription: category.seoDescription,
    sortOrder: category.sortOrder,
    serviceCount: category._count.services,
    updatedAt: category.updatedAt.toISOString(),
    ...catalogTranslationView(CATEGORY_TEXT_FIELDS, category, category.translations),
  };
}
