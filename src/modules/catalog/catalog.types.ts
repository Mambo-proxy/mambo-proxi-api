import type { JsonObject } from '../../common/json/json-read.js';
import type { Visual } from '../media/visual.mapper.js';

/** Types des réponses du catalogue (schémas du contrat ; les structures éditées restent des objets JSON). */

export interface CategoryRef {
  slug: string;
  name: string;
}

export interface ServiceSummary {
  id: string;
  slug: string;
  name: string;
  shortName: string | null;
  summary: string;
  icon: string;
  visual: Visual;
  category: CategoryRef;
  href: string;
  featuredOnHome: boolean;
  kind: 'service' | 'formula';
}

export interface Review {
  id: string;
  authorName: string;
  initials: string;
  city: string | null;
  rating: number;
  text: string;
  excerpt: string | null;
  service: { slug: string; name: string; categorySlug: string; categoryName: string } | null;
  verified: boolean;
  featured: boolean;
  date: string;
  reply: string | null;
}

export interface ReviewSummary {
  average: number;
  total: number;
  verifiedCount: number;
  distribution: Record<'1' | '2' | '3' | '4' | '5', number>;
}

export interface ServiceOffer {
  id: string;
  title: string;
  titleMobile: string | null;
  text: string;
  textMobile: string | null;
  icon: string | null;
  visual: Visual;
  action: 'QUOTE' | 'BOOKING';
  actionLabel: string;
  actionLabelMobile: string | null;
  serviceSlug: string | null;
}

export interface ServiceOffers {
  eyebrow: string;
  title: string;
  titleMobile?: string | null;
  lead: string | null;
  leadMobile: string | null;
  items: ServiceOffer[];
}

export interface Seo {
  title: string | null;
  description: string | null;
  ogImageUrl: string | null;
  noindex: boolean;
}

export interface Cta {
  title: string;
  text: string;
}

export interface ServiceDetail extends ServiceSummary {
  tagline: string;
  cities: string[];
  audiences: string[];
  steps: JsonObject[];
  advantages: JsonObject[];
  faq: JsonObject[];
  quoteBullets: string[];
  gallery: Visual[];
  showWhatsapp: boolean;
  related: ServiceSummary[];
  offers: ServiceOffers | null;
  reviews: Review[];
  reviewsTitle: string | null;
  relatedTitle: string | null;
  cta: Cta;
  reviewSummary: ReviewSummary | null;
  seo: Seo;
  toComplete: boolean;
  updatedAt: string;
}

export interface CategoryHomeCard {
  title?: string;
  text?: string;
  textMobile?: string | null;
  chips?: string[];
  visual?: Visual | null;
  visualMobile?: Visual | null;
}

export interface CategorySummary {
  id: string;
  slug: string;
  name: string;
  tagline: string;
  description: string;
  icon: string;
  tint: 'orange-50' | 'neutral-100' | 'vert-50' | 'neutral-900';
  iconColor?: string;
  visual: Visual;
  thumbnail: Visual | null;
  sortOrder: number;
  serviceCount: number;
  href: string;
  number: string;
  homeCard?: CategoryHomeCard;
  services?: ServiceSummary[];
}

export interface CategoryDetail extends CategorySummary {
  eyebrow: string | null;
  heroTitle: string;
  heroLead: string;
  heroVisual: Visual;
  audiencesTitle: string | null;
  audiences: JsonObject[];
  servicesTitle: string | null;
  servicesLead: string | null;
  services: ServiceSummary[];
  groups: { title: string; serviceSlugs: string[] }[];
  highlight: JsonObject | null;
  offerSections: ServiceOffers[];
  processEyebrow: string | null;
  processTitle: string | null;
  processSteps: JsonObject[];
  testimonial: Review | null;
  testimonialVisual?: Visual;
  quoteFields: JsonObject[];
  otherCategories: CategorySummary[];
  cta: Cta;
  seo: Seo;
}
