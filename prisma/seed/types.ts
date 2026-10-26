// Forme des fichiers de données du seed (`prisma/seed/data/*.json`).
// Les noms de champs suivent les colonnes Prisma ; les champs JSON gardent la forme du contrat.
import type {
  ApplicationStatus,
  AppointmentFormat,
  AppointmentReason,
  AppointmentStatus,
  CampaignSegmentKind,
  CampaignStatus,
  CategoryTint,
  ContactPreference,
  ContactProfile,
  Currency,
  IllustrationScene,
  MagazineEditionStatus,
  MediaMimeType,
  NotificationKind,
  OfferAction,
  PageGroup,
  PartnerCategory,
  PartnershipType,
  Prisma,
  PublishStatus,
  RequestEventKind,
  RequestStatus,
  RequestType,
  ReviewStatus,
  Role,
  SalaryPeriod,
  ServiceKind,
  SubscriberStatus,
  SurveyQuestionKind,
  TrainingCategory,
  ZoneTone,
} from '../../src/generated/prisma/client.js';

/**
 * Date d'une donnée : ISO 8601 (date fixe) ou date relative au lancement du seed, comme dans les mocks du site :
 * `rel:now:<ms>` (décalage par rapport à maintenant), `rel:day:<ms>` (par rapport au début du jour à Douala),
 * `rel:week:<ms>` (par rapport au lundi 0 h de la semaine en cours à Douala).
 */
export type DateSpec = string;

/** Valeur d'une colonne JSON (forme du contrat). */
export type Json = Prisma.InputJsonValue;

/** Traductions `{ en: { champ: valeur } }` (voir `docs/MODELE_DE_DONNEES.md`). */
export type Translations = { en: Record<string, Json | null> } | null;

export interface MediaSeed {
  id: string;
  /** Adresse publique relative au site (`/photos/…`), reprise telle quelle par l'API. */
  storageKey: string;
  fileName: string;
  mimeType: MediaMimeType;
  size: number;
  width: number | null;
  height: number | null;
  alt: string;
  isDemo: boolean;
  createdAt: DateSpec;
}

export interface MediaUsageSeed {
  mediaId: string;
  kind: string;
  entityId: string;
  slot: string;
  label: string;
  href: string | null;
}

export interface SettingSeed {
  key: string;
  value: Json;
  translations: Translations;
}

export interface EmailTemplateSeed {
  key: string;
  subject: string;
  preheader: string | null;
  title: string;
  paragraphs: string[];
  buttonLabel: string | null;
  enabled: boolean;
}

export interface SurveyQuestionSeed {
  id: string;
  order: number;
  kind: SurveyQuestionKind;
  label: string;
  helpText: string | null;
  options: string[];
  required: boolean;
  active: boolean;
}

export interface AvailabilitySeed {
  rules: {
    id: string;
    weekday: number;
    startTime: string;
    endTime: string;
    slotMinutes: number;
    formats: AppointmentFormat[];
  }[];
  exceptions: {
    id: string;
    /** Date seule `AAAA-MM-JJ`. */
    date: string;
    closed: boolean;
    startTime: string | null;
    endTime: string | null;
    label: string | null;
  }[];
}

export interface ZoneQuarterSeed {
  id: string;
  name: string;
  normalizedName: string;
  detail: string | null;
  detailEn: string | null;
  mapLabel: string | null;
  mapLabelEn: string | null;
  isBase: boolean;
  labelOnSmallMap: boolean;
  lat: number | null;
  lng: number | null;
  mapX: number | null;
  mapY: number | null;
  sortOrder: number;
}

export interface ZoneSeed {
  id: string;
  key: string;
  name: string;
  nameEn: string | null;
  tone: ZoneTone;
  description: string;
  descriptionEn: string | null;
  result: string;
  resultEn: string | null;
  delay: string | null;
  feeAmount: number | null;
  feeCurrency: Currency | null;
  feeFrom: boolean;
  area: Json | null;
  active: boolean;
  sortOrder: number;
  quarters: ZoneQuarterSeed[];
}

export interface OfferSeed {
  id: string;
  targetServiceId: string | null;
  title: string;
  titleMobile: string | null;
  text: string;
  textMobile: string | null;
  icon: string | null;
  illustration: IllustrationScene;
  imageId: string | null;
  action: OfferAction;
  actionLabel: string;
  actionLabelMobile: string | null;
  sortOrder: number;
  translations: Translations;
}

export interface OfferSectionSeed {
  id: string;
  eyebrow: string;
  title: string;
  titleMobile: string | null;
  lead: string | null;
  leadMobile: string | null;
  sortOrder: number;
  translations: Translations;
  offers: OfferSeed[];
}

export interface CategorySeed {
  id: string;
  slug: string;
  name: string;
  tagline: string;
  description: string;
  eyebrow: string | null;
  heroTitle: string;
  heroLead: string;
  icon: string;
  iconColor: string | null;
  tint: CategoryTint;
  illustration: IllustrationScene;
  imageId: string | null;
  visuals: Json;
  homeCard: Json | null;
  audiencesTitle: string | null;
  audiences: Json;
  servicesTitle: string | null;
  servicesLead: string | null;
  groups: Json;
  highlight: Json | null;
  processEyebrow: string | null;
  processTitle: string | null;
  processSteps: Json;
  /** Avis de démonstration : relié par le domaine « avis » (voir `seedReviews`). */
  testimonialId: string | null;
  quoteFields: Json;
  ctaTitle: string | null;
  ctaText: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  status: PublishStatus;
  sortOrder: number;
  translations: Translations;
  offerSections: OfferSectionSeed[];
}

export interface ServiceSeed {
  id: string;
  slug: string;
  name: string;
  shortName: string | null;
  categoryId: string;
  kind: ServiceKind;
  tagline: string;
  summary: string;
  icon: string;
  illustration: IllustrationScene;
  coverImageId: string | null;
  cities: string[];
  audiences: string[];
  steps: Json;
  advantages: Json;
  faq: Json;
  quoteBullets: string[];
  offersEyebrow: string | null;
  offersTitle: string | null;
  offersLead: string | null;
  offersLeadMobile: string | null;
  showInMenu: boolean;
  featuredOnHome: boolean;
  showWhatsapp: boolean;
  reviewsTitle: string | null;
  relatedTitle: string | null;
  ctaTitle: string | null;
  ctaText: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  toComplete: boolean;
  status: PublishStatus;
  sortOrder: number;
  publishedAt: DateSpec | null;
  isDemo: boolean;
  translations: Translations;
  gallery: { mediaId: string; sortOrder: number; alt: string | null }[];
  relatedIds: string[];
  offers: OfferSeed[];
}

export interface CatalogueSeed {
  categories: CategorySeed[];
  services: ServiceSeed[];
}

export interface PageSeed {
  key: string;
  title: string;
  path: string;
  group: PageGroup;
  sections: Json;
  seo: Json | null;
  translations: Translations;
  allowedSections: string[];
  publishedAt: DateSpec | null;
}

export interface UsersSeed {
  /** Identifiant de l'administratrice dans les mocks (remplacé par le compte `SEED_ADMIN_*`). */
  mockAdminId: string;
  adminLastLoginAt: DateSpec | null;
  demoUsers: {
    id: string;
    email: string;
    name: string;
    role: Role;
    lastLoginAt: DateSpec | null;
    lastActiveAt: DateSpec | null;
    createdAt: DateSpec;
  }[];
}

export interface PartnerSeed {
  id: string;
  name: string;
  category: PartnerCategory;
  logoImageId: string | null;
  url: string | null;
  visible: boolean;
  sortOrder: number;
}

export interface TrainingSeed {
  id: string;
  slug: string;
  title: string;
  category: TrainingCategory;
  audienceLabel: string;
  icon: string;
  duration: string;
  format: string;
  location: string | null;
  description: string | null;
  status: PublishStatus;
  sortOrder: number;
  translations: Translations;
}

export interface JobSeed {
  id: string;
  slug: string;
  title: string;
  city: string;
  country: string;
  contractType: string;
  startDate: string | null;
  workingTime: string | null;
  locationLabel: string | null;
  sectors: string[];
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: Currency | null;
  salaryPeriod: SalaryPeriod | null;
  schedule: string | null;
  summary: string;
  description: string | null;
  missions: string[];
  profile: string[];
  benefits: string[];
  status: PublishStatus;
  publishedAt: DateSpec | null;
  expiresAt: DateSpec | null;
  createdAt: DateSpec;
  translations: Translations;
}

export interface EventSeed {
  id: string;
  slug: string;
  title: string;
  startsAt: DateSpec;
  endsAt: DateSpec | null;
  city: string;
  place: string | null;
  tag: string;
  illustration: IllustrationScene;
  imageId: string | null;
  description: string | null;
  capacity: number | null;
  limited: boolean;
  status: PublishStatus;
  publishedAt: DateSpec | null;
}

export interface ContentSeed {
  partners: PartnerSeed[];
  trainings: TrainingSeed[];
  jobs: JobSeed[];
  events: EventSeed[];
}

export interface MagazineSeed {
  editions: {
    id: string;
    number: number | null;
    title: string;
    titleEn: string | null;
    subtitle: string | null;
    subtitleEn: string | null;
    themes: string | null;
    publishAt: DateSpec | null;
    publishedAt: DateSpec | null;
    status: MagazineEditionStatus;
    coverId: string | null;
    editorial: string | null;
    editorialEn: string | null;
    signature: string | null;
    signatureEn: string | null;
    newsletterScheduledAt: DateSpec | null;
    newsletterSentAt: DateSpec | null;
  }[];
  articles: {
    id: string;
    editionId: string | null;
    sortOrder: number;
    title: string;
    titleEn: string | null;
    theme: string;
    themeEn: string | null;
    excerpt: string | null;
    excerptEn: string | null;
    body: string | null;
    bodyEn: string | null;
    imageId: string | null;
    updatedAt: DateSpec;
  }[];
}

export interface ReviewSeed {
  id: string;
  authorName: string;
  city: string | null;
  rating: number;
  text: string;
  excerpt: string | null;
  serviceId: string | null;
  status: ReviewStatus;
  verified: boolean;
  featured: boolean;
  publishConsent: boolean;
  answersSnapshot: Json | null;
  serviceDate: DateSpec | null;
  date: DateSpec;
  reply: string | null;
  publishedAt: DateSpec | null;
  createdAt: DateSpec;
  surveyId?: string;
}

export interface SurveySeed {
  id: string;
  requestId: string;
  status: 'ANSWERED';
  sentAt: DateSpec;
  completedAt: DateSpec;
  answers: Json;
  rating: number;
  npsScore: number | null;
  publishConsent: boolean;
  displayName: string;
  city: string | null;
}

export interface ReviewsSeed {
  reviews: ReviewSeed[];
  featuredReviews: { serviceId: string; reviewId: string; sortOrder: number }[];
  surveys: SurveySeed[];
}

export interface ContactSeed {
  id: string;
  email: string;
  fullName: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  country: string | null;
  city: string | null;
  district: string | null;
  profile: ContactProfile;
  organization: string | null;
  activity: string | null;
  preferredChannel: ContactPreference | null;
  source: string | null;
  createdAt: DateSpec;
  lastActivityAt: DateSpec;
  /** Identifiants des rubriques qui intéressent le contact. */
  interests: string[];
  newsletter: SubscriberStatus | null;
}

export interface RequestSeed {
  id: string;
  /** Numéro de la référence `MP-AAAA-NNNN` (l'année est celle du lancement du seed). */
  referenceNumber: number;
  type: RequestType;
  status: RequestStatus;
  contactId: string;
  categoryId: string | null;
  serviceId: string | null;
  jobOfferId: string | null;
  trainingId: string | null;
  otherTraining: string | null;
  eventId: string | null;
  seats: number | null;
  participants: number | null;
  period: string | null;
  organization: string | null;
  partnershipType: PartnershipType | null;
  contactPreference: ContactPreference | null;
  subject: string | null;
  payload: Json;
  message: string | null;
  consentAt: DateSpec;
  /** Identifiant d'utilisateur des mocks (`usr_…`). */
  assignedToId: string | null;
  assignedAt: DateSpec | null;
  dueAt: DateSpec | null;
  completedAt: DateSpec | null;
  closedAt: DateSpec | null;
  createdAt: DateSpec;
  updatedAt: DateSpec;
  history: {
    id: string;
    kind: RequestEventKind;
    /** `{ from, to }` (statut) ou `{ assignedToId }` (identifiant d'utilisateur des mocks). */
    data: Record<string, string | null> | null;
    actorId: string | null;
    createdAt: DateSpec;
  }[];
  application: {
    id: string;
    status: ApplicationStatus;
    readAt: DateSpec | null;
    attachment: { id: string; storageKey: string; fileName: string; mimeType: string; size: number };
  } | null;
}

export interface AppointmentSeed {
  id: string;
  referenceNumber: number;
  requestId: string | null;
  contactId: string;
  reason: AppointmentReason;
  format: AppointmentFormat;
  startsAt: DateSpec;
  endsAt: DateSpec;
  status: AppointmentStatus;
  proposedStartsAt: DateSpec | null;
  location: string | null;
  videoLink: string | null;
  message: string | null;
  notes: string | null;
  assignedToId: string | null;
  confirmedAt: DateSpec | null;
  cancelledAt: DateSpec | null;
  completedAt: DateSpec | null;
  reminderSentAt: DateSpec | null;
  createdAt: DateSpec;
}

export interface NewsletterSeed {
  campaigns: {
    id: string;
    subject: string;
    preheader: string | null;
    html: string;
    segmentKind: CampaignSegmentKind;
    segmentTags: string[];
    status: CampaignStatus;
    scheduledAt: DateSpec | null;
    sentAt: DateSpec | null;
    recipients: number;
    opens: number | null;
    clicks: number | null;
    unsubscribes: number;
    createdAt: DateSpec;
  }[];
}

export interface ActivitySeed {
  notifications: {
    id: string;
    userId: string;
    kind: NotificationKind;
    title: string;
    link: string | null;
    entityType: string | null;
    entityId: string | null;
    readAt: DateSpec | null;
    createdAt: DateSpec;
  }[];
  auditLogs: {
    id: string;
    actorId: string | null;
    action: string;
    entity: string;
    entityId: string | null;
    label: string;
    before: Json | null;
    after: Json | null;
    ip: string | null;
    createdAt: DateSpec;
  }[];
}
