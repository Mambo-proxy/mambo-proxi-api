import type { Lang } from '../../common/i18n/lang.js';
import { isPlainObject, localizeFields } from '../../common/i18n/translations.js';
import {
  asObject,
  asObjectArray,
  readNullableString,
  readString,
  readStringArray,
  type JsonObject,
} from '../../common/json/json-read.js';
import type { CategoryTint, IllustrationScene } from '../../generated/prisma/client.js';
import { asVisual, type MediaImage, type MediaRecord, type Visual } from '../media/visual.mapper.js';
import type {
  CategoryDetailRecord,
  CategorySummaryRecord,
  OfferRecord,
  ReviewRecord,
  ServiceDetailRecord,
  ServiceSummaryRecord,
} from './catalog.selects.js';
import type {
  CategoryDetail,
  CategoryHomeCard,
  CategoryRef,
  CategorySummary,
  Cta,
  Review,
  ReviewSummary,
  Seo,
  ServiceDetail,
  ServiceOffer,
  ServiceOffers,
  ServiceSummary,
} from './catalog.types.js';
import { localizeCatalog } from './catalog-translations.js';

/** Construction des images et visuels (implémentée par `MediaService`). */
export interface MediaResolver {
  image(media: MediaRecord | null | undefined): MediaImage | null;
  visual(
    illustration: IllustrationScene | null | undefined,
    media: MediaRecord | null | undefined,
    alt?: string | null,
  ): Visual;
}

/**
 * Champs traduisibles (colonne `translations`, `docs/MODELE_DE_DONNEES.md`). Services et rubriques : textes seuls sur
 * la structure française (`localizeCatalog`) ; offres et en-têtes de carrousels (non modifiables en anglais dans le
 * back-office) : recouvrement champ par champ (`localizeFields`).
 */
const CATEGORY_REF_FIELDS = ['name'] as const;
const SERVICE_SUMMARY_FIELDS = ['name', 'shortName', 'summary'] as const;
const SERVICE_DETAIL_FIELDS = [
  ...SERVICE_SUMMARY_FIELDS,
  'tagline',
  'cities',
  'audiences',
  'steps',
  'advantages',
  'faq',
  'quoteBullets',
  'offersEyebrow',
  'offersTitle',
  'offersLead',
  'offersLeadMobile',
  'reviewsTitle',
  'relatedTitle',
  'ctaTitle',
  'ctaText',
  'seoTitle',
  'seoDescription',
] as const;
const CATEGORY_SUMMARY_FIELDS = ['name', 'tagline', 'description', 'visuals', 'homeCard'] as const;
const CATEGORY_DETAIL_FIELDS = [
  'eyebrow',
  'heroTitle',
  'heroLead',
  'audiencesTitle',
  'audiences',
  'servicesTitle',
  'servicesLead',
  'groups',
  'highlight',
  'processEyebrow',
  'processTitle',
  'processSteps',
  'quoteFields',
  'ctaTitle',
  'ctaText',
  'seoTitle',
  'seoDescription',
] as const;
const OFFER_FIELDS = [
  'title',
  'titleMobile',
  'text',
  'textMobile',
  'actionLabel',
  'actionLabelMobile',
] as const;
const OFFER_SECTION_FIELDS = ['eyebrow', 'title', 'titleMobile', 'lead', 'leadMobile'] as const;

/** Textes par défaut d'un champ facultatif non renseigné dans le back-office. */
const DEFAULTS: Record<Lang, { offersEyebrow: string; offersTitle: string; cta: Cta }> = {
  fr: {
    offersEyebrow: 'Nos offres',
    offersTitle: 'Choisissez l’offre ==adaptée à votre besoin.==',
    cta: { title: 'Un projet ? ==Parlons-en.==', text: 'Votre devis gratuit et sans engagement, sous 24 h.' },
  },
  en: {
    offersEyebrow: 'Our offers',
    offersTitle: 'Choose the offer ==that suits you.==',
    cta: { title: 'A project? ==Let’s talk.==', text: 'Your free, no-obligation quote within 24 hours.' },
  },
};

const TINTS: Record<CategoryTint, CategorySummary['tint']> = {
  ORANGE_50: 'orange-50',
  NEUTRAL_100: 'neutral-100',
  VERT_50: 'vert-50',
  NEUTRAL_900: 'neutral-900',
};

export function categoryHref(categorySlug: string): string {
  return `/services/${categorySlug}`;
}

/** Adresse d'un service ; une formule n'a pas de fiche : elle renvoie à la section des formules de sa rubrique. */
export function serviceHref(categorySlug: string, serviceSlug: string, kind: 'SERVICE' | 'FORMULA'): string {
  return kind === 'FORMULA'
    ? `${categoryHref(categorySlug)}#formules`
    : `${categoryHref(categorySlug)}/${serviceSlug}`;
}

/** Numéro affiché d'une rubrique (`01`, `02`…), selon son rang parmi les rubriques publiées. */
export function categoryNumber(rank: number): string {
  return String(rank + 1).padStart(2, '0');
}

/** Initiales affichées d'un avis (« Jean-Marc T. » → « JT »). */
export function initialsOf(authorName: string): string {
  const words = authorName
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}]/gu, ''))
    .filter((word) => word.length > 0);
  const first = words[0];
  if (first === undefined) return '?';
  const last = words.length > 1 ? words[words.length - 1] : undefined;
  const initials = last === undefined ? first.slice(0, 2) : `${first[0] ?? ''}${last[0] ?? ''}`;
  return initials.toLocaleUpperCase('fr');
}

function localizedName(record: { name: string; translations: unknown }, lang: Lang): string {
  return localizeCatalog(record, record.translations, lang, CATEGORY_REF_FIELDS).name;
}

export function toCategoryRef(
  category: { slug: string; name: string; translations: unknown },
  lang: Lang,
): CategoryRef {
  return { slug: category.slug, name: localizedName(category, lang) };
}

/** Adresse absolue d'une image pour `Seo.ogImageUrl` (`format: uri`) ; une image livrée avec le site n'y figure pas. */
function absoluteImageUrl(image: MediaImage | null): string | null {
  return image !== null && /^https?:\/\//.test(image.url) ? image.url : null;
}

export function toSeo(title: string | null, description: string | null, ogImage: MediaImage | null): Seo {
  return { title, description, ogImageUrl: absoluteImageUrl(ogImage), noindex: false };
}

function toCta(title: string | null, text: string | null, lang: Lang): Cta {
  const fallback = DEFAULTS[lang].cta;
  return { title: title ?? fallback.title, text: text ?? fallback.text };
}

export function toServiceSummary(
  service: ServiceSummaryRecord,
  lang: Lang,
  media: MediaResolver,
): ServiceSummary {
  const localized = localizeCatalog(service, service.translations, lang, SERVICE_SUMMARY_FIELDS);
  return {
    id: service.id,
    slug: service.slug,
    name: localized.name,
    shortName: localized.shortName,
    summary: localized.summary,
    icon: service.icon,
    visual: media.visual(service.illustration, service.coverImage),
    category: toCategoryRef(service.category, lang),
    href: serviceHref(service.category.slug, service.slug, service.kind),
    featuredOnHome: service.featuredOnHome,
    kind: service.kind === 'FORMULA' ? 'formula' : 'service',
  };
}

export function toReview(review: ReviewRecord, lang: Lang): Review {
  const service = review.service;
  return {
    id: review.id,
    authorName: review.authorName,
    initials: initialsOf(review.authorName),
    city: review.city,
    rating: review.rating,
    text: review.text,
    excerpt: review.excerpt,
    service:
      service === null
        ? null
        : {
            slug: service.slug,
            name: localizedName(service, lang),
            categorySlug: service.category.slug,
            categoryName: localizedName(service.category, lang),
          },
    verified: review.verified,
    featured: review.featured,
    date: review.date.toISOString(),
    reply: review.reply,
  };
}

/** Note moyenne (une décimale), nombre d'avis, avis vérifiés et répartition par note ; `null` sans avis. */
export function toReviewSummary(
  reviews: readonly { rating: number; verified: boolean }[],
): ReviewSummary | null {
  if (reviews.length === 0) return null;
  const distribution: ReviewSummary['distribution'] = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
  let sum = 0;
  let verifiedCount = 0;
  for (const review of reviews) {
    const rating = Math.min(5, Math.max(1, Math.round(review.rating)));
    distribution[String(rating) as keyof ReviewSummary['distribution']] += 1;
    sum += rating;
    if (review.verified) verifiedCount += 1;
  }
  return {
    average: Math.round((sum / reviews.length) * 10) / 10,
    total: reviews.length,
    verifiedCount,
    distribution,
  };
}

/** Service cible d'une offre encore visible sur le site (sinon l'offre présélectionne le service de la fiche). */
function visibleTargetSlug(target: OfferRecord['targetService'], now: Date): string | null {
  if (target === null || target.status !== 'PUBLISHED' || target.category.status !== 'PUBLISHED') return null;
  if (target.publishedAt !== null && target.publishedAt > now) return null;
  return target.slug;
}

export function toServiceOffer(
  offer: OfferRecord,
  lang: Lang,
  media: MediaResolver,
  now: Date,
): ServiceOffer {
  const localized = localizeFields(offer, offer.translations, lang, OFFER_FIELDS);
  return {
    id: offer.id,
    title: localized.title,
    titleMobile: localized.titleMobile,
    text: localized.text,
    textMobile: localized.textMobile,
    icon: offer.icon,
    visual: media.visual(offer.illustration, offer.image),
    action: offer.action,
    actionLabel: localized.actionLabel,
    actionLabelMobile: localized.actionLabelMobile,
    serviceSlug: visibleTargetSlug(offer.targetService, now),
  };
}

interface OffersHeading {
  eyebrow: string | null;
  title: string | null;
  titleMobile?: string | null;
  lead: string | null;
  leadMobile: string | null;
}

/** Carrousel « Nos offres » ; `null` sans offre (le contrat exige au moins une carte). */
function toServiceOffers(
  heading: OffersHeading,
  offers: readonly OfferRecord[],
  lang: Lang,
  media: MediaResolver,
  now: Date,
): ServiceOffers | null {
  if (offers.length === 0) return null;
  return {
    eyebrow: heading.eyebrow ?? DEFAULTS[lang].offersEyebrow,
    title: heading.title ?? DEFAULTS[lang].offersTitle,
    ...(heading.titleMobile === undefined ? {} : { titleMobile: heading.titleMobile }),
    lead: heading.lead,
    leadMobile: heading.leadMobile,
    items: offers.slice(0, 12).map((offer) => toServiceOffer(offer, lang, media, now)),
  };
}

/** Service lié encore visible (publié, rubrique publiée). */
function isVisibleRelated(
  service: ServiceDetailRecord['related'][number]['relatedService'],
  now: Date,
): boolean {
  return (
    service.status === 'PUBLISHED' &&
    service.category.status === 'PUBLISHED' &&
    (service.publishedAt === null || service.publishedAt <= now)
  );
}

export interface ServiceDetailContext {
  /** Avis publiés du service, du plus récent au plus ancien (repli des avis mis en avant et synthèse). */
  publishedReviews: readonly ReviewRecord[];
  now: Date;
}

/** Nombre d'avis affichés sur une fiche quand aucun n'est mis en avant. */
const MAX_FICHE_REVIEWS = 6;

export function toServiceDetail(
  service: ServiceDetailRecord,
  lang: Lang,
  media: MediaResolver,
  context: ServiceDetailContext,
): ServiceDetail {
  const localized = localizeCatalog(service, service.translations, lang, SERVICE_DETAIL_FIELDS);
  const featured = service.featuredReviews
    .map((item) => item.review)
    .filter((review) => review.status === 'PUBLIE');
  const reviews = featured.length > 0 ? featured : context.publishedReviews.slice(0, MAX_FICHE_REVIEWS);

  return {
    ...toServiceSummary(service, lang, media),
    tagline: localized.tagline,
    cities: localized.cities,
    audiences: localized.audiences,
    steps: asObjectArray(localized.steps),
    advantages: asObjectArray(localized.advantages),
    faq: asObjectArray(localized.faq),
    quoteBullets: localized.quoteBullets,
    gallery: service.gallery.map((item) => media.visual(service.illustration, item.media, item.alt)),
    showWhatsapp: service.showWhatsapp,
    related: service.related
      .map((item) => item.relatedService)
      .filter((related) => isVisibleRelated(related, context.now))
      .map((related) => toServiceSummary(related, lang, media)),
    offers: toServiceOffers(
      {
        eyebrow: localized.offersEyebrow,
        title: localized.offersTitle,
        lead: localized.offersLead,
        leadMobile: localized.offersLeadMobile,
      },
      service.offers,
      lang,
      media,
      context.now,
    ),
    reviews: reviews.map((review) => toReview(review, lang)),
    reviewsTitle: localized.reviewsTitle,
    relatedTitle: localized.relatedTitle,
    cta: toCta(localized.ctaTitle, localized.ctaText, lang),
    reviewSummary: toReviewSummary(context.publishedReviews),
    seo: toSeo(localized.seoTitle, localized.seoDescription, media.image(service.coverImage)),
    toComplete: service.toComplete,
    updatedAt: service.updatedAt.toISOString(),
  };
}

/** Visuels secondaires d'une rubrique (`visuals`, références déjà résolues par `MediaService.resolveVisuals`). */
export interface CategoryVisuals {
  hero: Visual | null;
  thumbnail: Visual | null;
  testimonial: Visual | null;
  homeCard: Visual | null;
  homeCardMobile: Visual | null;
}

export function toCategoryVisuals(resolved: unknown): CategoryVisuals {
  const visuals = asObject(resolved);
  return {
    hero: asVisual(visuals['hero']),
    thumbnail: asVisual(visuals['thumbnail']),
    testimonial: asVisual(visuals['testimonial']),
    homeCard: asVisual(visuals['homeCard']),
    homeCardMobile: asVisual(visuals['homeCardMobile']),
  };
}

function toHomeCard(value: unknown, visuals: CategoryVisuals): CategoryHomeCard | undefined {
  if (!isPlainObject(value)) return undefined;
  const title = readNullableString(value, 'title');
  const text = readNullableString(value, 'text');
  return {
    ...(title === null ? {} : { title }),
    ...(text === null ? {} : { text }),
    textMobile: readNullableString(value, 'textMobile'),
    chips: readStringArray(value, 'chips'),
    visual: visuals.homeCard,
    ...(visuals.homeCardMobile === null ? {} : { visualMobile: visuals.homeCardMobile }),
  };
}

export interface CategorySummaryContext {
  /** Rang parmi les rubriques publiées (numéro affiché). */
  rank: number;
  /** Visuels secondaires résolus (`visuals` traduit puis résolu). */
  visuals: CategoryVisuals;
  includeServices: boolean;
}

/** Valeurs traduites des champs du résumé (à résoudre avant `toCategorySummary` pour les visuels). */
export function localizeCategorySummary(category: CategorySummaryRecord, lang: Lang): CategorySummaryRecord {
  return localizeCatalog(category, category.translations, lang, CATEGORY_SUMMARY_FIELDS);
}

/** `CategorySummary` d'une rubrique déjà traduite (`localizeCategorySummary`). */
export function toCategorySummary(
  category: CategorySummaryRecord,
  lang: Lang,
  media: MediaResolver,
  context: CategorySummaryContext,
): CategorySummary {
  const homeCard = toHomeCard(category.homeCard, context.visuals);
  return {
    id: category.id,
    slug: category.slug,
    name: category.name,
    tagline: category.tagline,
    description: category.description,
    icon: category.icon,
    tint: TINTS[category.tint],
    ...(category.iconColor === null ? {} : { iconColor: category.iconColor }),
    visual: media.visual(category.illustration, category.image),
    thumbnail: context.visuals.thumbnail,
    sortOrder: category.sortOrder,
    serviceCount: category.services.length,
    href: categoryHref(category.slug),
    number: categoryNumber(context.rank),
    ...(homeCard === undefined ? {} : { homeCard }),
    ...(context.includeServices
      ? { services: category.services.map((service) => toServiceSummary(service, lang, media)) }
      : {}),
  };
}

function toGroups(value: unknown, visibleSlugs: ReadonlySet<string>): CategoryDetail['groups'] {
  return asObjectArray(value).flatMap((group) => {
    const title = readNullableString(group, 'title');
    if (title === null) return [];
    return [
      {
        title,
        serviceSlugs: readStringArray(group, 'serviceSlugs').filter((slug) => visibleSlugs.has(slug)),
      },
    ];
  });
}

function toHighlight(value: unknown): JsonObject | null {
  if (!isPlainObject(value)) return null;
  const kind = value['kind'];
  if (kind !== 'PARCEL_RECEPTION' && kind !== 'AGENDA' && kind !== 'STEPS_BAND') return null;
  return { ...value, title: readString(value, 'title', '') };
}

export interface CategoryDetailContext {
  summary: CategorySummary;
  visuals: CategoryVisuals;
  /** Services publiés de la rubrique (déjà dans le résumé). */
  services: ServiceSummary[];
  otherCategories: CategorySummary[];
  image: MediaImage | null;
  now: Date;
}

export function toCategoryDetail(
  category: CategoryDetailRecord,
  lang: Lang,
  media: MediaResolver,
  context: CategoryDetailContext,
): CategoryDetail {
  const localized = localizeCatalog(category, category.translations, lang, CATEGORY_DETAIL_FIELDS);
  const visibleSlugs = new Set(context.services.map((service) => service.slug));
  const testimonial = category.testimonial?.status === 'PUBLIE' ? toReview(category.testimonial, lang) : null;

  return {
    ...context.summary,
    eyebrow: localized.eyebrow,
    heroTitle: localized.heroTitle,
    heroLead: localized.heroLead,
    heroVisual: context.visuals.hero ?? context.summary.visual,
    audiencesTitle: localized.audiencesTitle,
    audiences: asObjectArray(localized.audiences),
    servicesTitle: localized.servicesTitle,
    servicesLead: localized.servicesLead,
    services: context.services,
    groups: toGroups(localized.groups, visibleSlugs),
    highlight: toHighlight(localized.highlight),
    offerSections: category.offerSections.flatMap((section) => {
      const heading = localizeFields(section, section.translations, lang, OFFER_SECTION_FIELDS);
      const offers = toServiceOffers(heading, section.offers, lang, media, context.now);
      return offers === null ? [] : [offers];
    }),
    processEyebrow: localized.processEyebrow,
    processTitle: localized.processTitle,
    processSteps: asObjectArray(localized.processSteps),
    testimonial,
    ...(context.visuals.testimonial === null ? {} : { testimonialVisual: context.visuals.testimonial }),
    quoteFields: asObjectArray(localized.quoteFields),
    otherCategories: context.otherCategories,
    cta: toCta(localized.ctaTitle, localized.ctaText, lang),
    seo: toSeo(localized.seoTitle, localized.seoDescription, context.image),
  };
}
