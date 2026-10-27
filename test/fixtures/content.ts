/**
 * Contenus du double de Prisma pour les tests e2e du back-office (services, rubriques, pages, zones, paramètres,
 * e-mails). Contrairement à `public-content.ts`, les enregistrements n'ont que leurs clés étrangères : les relations
 * sont retrouvées par le double (`LINKS`), si bien qu'un contenu modifié par l'API est relu tel quel par les routes
 * publiques. Comptes : ceux de `test/support/auth.ts` (un par rôle).
 */
import { FIXTURES } from './public-content.js';
import { authTables } from '../support/auth.js';
import type { PrismaTables } from '../support/prisma-double.js';

type Row = Record<string, unknown>;

const DAY = 86_400_000;
export const CONTENT_DATE = new Date('2026-10-20T08:00:00.000Z');

function media(id: string, width: number, alt = ''): Row {
  return {
    id,
    storageKey: `/photos/${id}.png`,
    fileName: `${id}.png`,
    mimeType: 'PNG',
    size: 1000,
    width,
    height: Math.round(width * 0.66),
    alt,
    focalX: null,
    focalY: null,
    blurDataUrl: null,
    variants: [],
    status: 'READY',
    isDemo: false,
    createdAt: CONTENT_DATE,
    updatedAt: CONTENT_DATE,
  };
}

function category(fields: Row): Row {
  return {
    slugEn: null,
    eyebrow: null,
    heroLead: '',
    iconColor: null,
    illustration: 'accueil',
    imageId: null,
    visuals: null,
    homeCard: null,
    audiencesTitle: null,
    audiences: [],
    servicesTitle: null,
    servicesLead: null,
    groups: [],
    highlight: null,
    processEyebrow: null,
    processTitle: null,
    processSteps: [],
    testimonialId: null,
    quoteFields: [],
    ctaTitle: null,
    ctaText: null,
    seoTitle: null,
    seoDescription: null,
    status: 'PUBLISHED',
    translations: null,
    isDemo: false,
    createdAt: CONTENT_DATE,
    updatedAt: CONTENT_DATE,
    ...fields,
  };
}

function service(fields: Row): Row {
  return {
    slugEn: null,
    shortName: null,
    kind: 'SERVICE',
    summary: '',
    icon: 'Sparkles',
    illustration: 'accueil',
    coverImageId: null,
    cities: ['Douala'],
    audiences: [],
    steps: [],
    advantages: [],
    faq: [],
    quoteBullets: [],
    offersEyebrow: null,
    offersTitle: null,
    offersLead: null,
    offersLeadMobile: null,
    showInMenu: true,
    featuredOnHome: false,
    showWhatsapp: true,
    reviewsTitle: null,
    relatedTitle: null,
    ctaTitle: null,
    ctaText: null,
    seoTitle: null,
    seoDescription: null,
    toComplete: false,
    status: 'PUBLISHED',
    version: 1,
    publishedAt: CONTENT_DATE,
    translations: null,
    isDemo: false,
    createdAt: CONTENT_DATE,
    updatedAt: CONTENT_DATE,
    ...fields,
  };
}

function review(fields: Row): Row {
  return {
    authorName: 'Aurélie K.',
    city: 'Douala',
    rating: 5,
    text: 'Un dîner parfait, merci !',
    excerpt: null,
    surveyId: null,
    status: 'PUBLIE',
    verified: true,
    featured: false,
    publishConsent: true,
    date: CONTENT_DATE,
    reply: null,
    isDemo: false,
    createdAt: CONTENT_DATE,
    updatedAt: CONTENT_DATE,
    ...fields,
  };
}

function page(fields: Row): Row {
  return {
    group: 'principales',
    seo: { title: null, description: null, ogImageUrl: null, noindex: false },
    translations: null,
    draftSections: null,
    draftSeo: null,
    draftTranslations: null,
    draftUpdatedAt: null,
    allowedSections: [],
    publishedAt: CONTENT_DATE,
    publishedById: null,
    updatedById: null,
    createdAt: CONTENT_DATE,
    updatedAt: CONTENT_DATE,
    ...fields,
  };
}

function quarter(fields: Row): Row {
  return {
    detail: null,
    detailEn: null,
    mapLabel: null,
    mapLabelEn: null,
    isBase: false,
    labelOnSmallMap: false,
    lat: null,
    lng: null,
    mapX: null,
    mapY: null,
    createdAt: CONTENT_DATE,
    updatedAt: CONTENT_DATE,
    ...fields,
  };
}

function zone(fields: Row): Row {
  return {
    nameEn: null,
    description: '',
    descriptionEn: null,
    result: 'Intervention possible. Conditions confirmées sur devis.',
    resultEn: null,
    delay: null,
    feeAmount: null,
    feeCurrency: 'XAF',
    feeFrom: false,
    area: null,
    active: true,
    isDemo: false,
    createdAt: CONTENT_DATE,
    updatedAt: CONTENT_DATE,
    ...fields,
  };
}

const LEGAL_HTML = '<p>Le site est édité par <strong>MAMBO Proxi</strong>.</p>';

/** Tables du double : comptes de test, catalogue, pages, zones, paramètres et deux modèles d'e-mails. */
export function contentTables(passwordHash: string, now: Date): PrismaTables {
  const base = authTables(passwordHash);
  const publicSettings = FIXTURES.settings.filter((row) => row['key'] !== 'securite');
  return {
    ...base,
    setting: [
      ...base.setting,
      ...publicSettings,
      {
        key: 'emails',
        value: {
          teamRecipients: ['equipe.douala@mamboproxi.com'],
          senderName: 'MAMBO Proxi',
          replyTo: 'contact@mamboproxi.com',
          surveyDelayHours: 24,
          surveyReminderDays: 3,
          appointmentReminderHour: 9,
        },
        translations: null,
        updatedAt: CONTENT_DATE,
      },
    ],
    media: [media('m_hd', 1600, 'Un chef présente un plat.'), media('m_small', 800)],
    category: [
      category({
        id: 'cat_exp',
        slug: 'experience',
        name: 'Expérience',
        tagline: 'Des moments sur mesure',
        description: 'Chef privé, massage, visites.',
        heroTitle: 'Des moments ==sur mesure.==',
        icon: 'Sparkles',
        tint: 'ORANGE_50',
        sortOrder: 1,
      }),
      category({
        id: 'cat_dom',
        slug: 'services-a-domicile',
        name: 'Services à domicile',
        tagline: 'Plus de temps pour l’essentiel',
        description: 'Une intervenante chez vous.',
        heroTitle: 'Plus de temps',
        icon: 'House',
        tint: 'VERT_50',
        sortOrder: 2,
      }),
      category({
        id: 'cat_vide',
        slug: 'rubrique-vide',
        name: 'Rubrique vide',
        tagline: 'À venir',
        description: 'Rubrique sans service.',
        heroTitle: 'À venir',
        icon: 'Box',
        tint: 'NEUTRAL_100',
        status: 'DRAFT',
        sortOrder: 3,
      }),
    ],
    service: [
      service({
        id: 'svc_chef',
        slug: 'chef-prive',
        name: 'Chef privé',
        categoryId: 'cat_exp',
        tagline: 'Un chef chez vous',
        summary: 'Un chef cuisine chez vous pour vos invités.',
        coverImageId: 'm_hd',
        audiences: ['Particuliers'],
        steps: [{ title: 'Votre demande', text: 'Décrivez votre repas.' }],
        advantages: [{ icon: null, title: 'Sur mesure', text: 'Menu adapté.' }],
        faq: [{ question: 'Combien de convives ?', answer: 'De 2 à 20.' }],
        sortOrder: 1,
        version: 4,
      }),
      service({
        id: 'svc_massage',
        slug: 'massage-a-domicile',
        name: 'Massage à domicile',
        categoryId: 'cat_exp',
        tagline: 'Détente chez vous',
        sortOrder: 2,
      }),
      service({
        id: 'svc_visites',
        slug: 'visites-guidees-douala',
        name: 'Visites guidées de Douala',
        categoryId: 'cat_exp',
        tagline: 'Découvrir la ville',
        status: 'DRAFT',
        publishedAt: null,
        isDemo: true,
        sortOrder: 3,
      }),
      service({
        id: 'svc_menage',
        slug: 'entretien-du-logement',
        name: 'Entretien du logement',
        categoryId: 'cat_dom',
        tagline: 'Un logement propre',
        sortOrder: 1,
      }),
    ],
    serviceRelation: [{ serviceId: 'svc_chef', relatedServiceId: 'svc_massage', sortOrder: 1 }],
    serviceGalleryImage: [{ serviceId: 'svc_chef', mediaId: 'm_small', sortOrder: 1, alt: null }],
    serviceFeaturedReview: [{ serviceId: 'svc_chef', reviewId: 'rev_pub', sortOrder: 1 }],
    serviceOffer: [
      {
        id: 'off_chef_1',
        serviceId: 'svc_chef',
        sectionId: null,
        targetServiceId: null,
        title: 'Dîner à deux',
        titleMobile: null,
        text: 'Un menu en trois services.',
        textMobile: null,
        icon: null,
        illustration: 'chef',
        imageId: null,
        action: 'QUOTE',
        actionLabel: 'Demander un devis',
        actionLabelMobile: null,
        sortOrder: 1,
        translations: { en: { title: 'Dinner for two' } },
        isDemo: false,
        createdAt: CONTENT_DATE,
        updatedAt: CONTENT_DATE,
      },
    ],
    categoryOfferSection: [],
    review: [
      review({ id: 'rev_pub', serviceId: 'svc_chef' }),
      review({ id: 'rev_hidden', serviceId: 'svc_chef', status: 'MASQUE' }),
    ],
    contact: [
      { id: 'ctc_1', email: 'aurelie@example.com', fullName: 'Aurélie K.', cityKey: 'bonapriso, douala' },
      { id: 'ctc_2', email: 'herve@example.com', fullName: 'Hervé M.', cityKey: 'makepe, douala' },
    ],
    request: [
      ...(base.request ?? []),
      {
        id: 'req_c1',
        serviceId: 'svc_chef',
        contactId: 'ctc_1',
        createdAt: new Date(now.getTime() - 2 * DAY),
      },
      {
        id: 'req_c2',
        serviceId: 'svc_chef',
        contactId: 'ctc_1',
        createdAt: new Date(now.getTime() - 40 * DAY),
      },
      { id: 'req_c3', serviceId: 'svc_menage', contactId: 'ctc_2', createdAt: new Date(now.getTime() - DAY) },
    ],
    page: [
      page({
        key: 'accueil',
        title: 'Accueil',
        path: '/',
        allowedSections: ['hero', 'marquee', 'textMedia', 'faq', 'richText', 'ctaBand'],
        sections: [
          {
            id: 'hero',
            type: 'hero',
            enabled: true,
            variant: 'home',
            title: 'Vos services, ==au plus près de vous.==',
            visual: { illustration: 'accueil', imageId: 'm_hd', alt: '' },
            // Copie d'un média sous la forme du contrat (ancien seed) : relue dans la médiathèque.
            visualSecondary: {
              illustration: 'chef',
              image: { id: 'm_small', url: '/photos/m_small.png', width: 800, height: 528, variants: [] },
              alt: '',
            },
          },
          {
            id: 'univers',
            type: 'dynamic',
            enabled: true,
            source: 'categories-bento',
            title: 'Nos univers',
          },
        ],
      }),
      page({
        key: 'mentions-legales',
        title: 'Mentions légales',
        path: '/mentions-legales',
        group: 'legales',
        allowedSections: ['hero', 'richText'],
        sections: [
          { id: 'hero', type: 'hero', enabled: true, variant: 'legal', title: 'Mentions légales' },
          {
            id: 'texte',
            type: 'richText',
            enabled: true,
            articles: [{ title: 'Éditeur', html: LEGAL_HTML }],
          },
        ],
        draftSections: [
          {
            id: 'hero',
            type: 'hero',
            enabled: true,
            variant: 'legal',
            title: 'Mentions légales (brouillon)',
          },
        ],
        draftUpdatedAt: new Date(now.getTime() - DAY),
        updatedById: 'usr_mireille',
      }),
      page({
        key: 'cgu',
        title: 'Conditions générales d’utilisation',
        path: '/cgu',
        group: 'legales',
        sections: [],
        publishedAt: null,
      }),
    ],
    zone: [
      zone({
        id: 'zon_1',
        key: 'zone-1',
        name: 'Zone 1 — Proximité',
        tone: 'zone1',
        sortOrder: 0,
        delay: '30–45 min',
        feeAmount: 1500,
      }),
      zone({ id: 'zon_2', key: 'zone-2', name: 'Zone 2 — Ville', tone: 'zone2', sortOrder: 1 }),
      zone({
        id: 'zon_vide',
        key: 'zone-vide',
        name: 'Zone vide',
        tone: 'zone3',
        active: false,
        sortOrder: 2,
      }),
    ],
    zoneQuarter: [
      quarter({
        id: 'zq_bonapriso',
        zoneId: 'zon_1',
        name: 'Bonapriso',
        normalizedName: 'bonapriso',
        sortOrder: 0,
        detailEn: 'south',
        detail: 'sud',
        lat: 4.03,
        lng: 9.69,
      }),
      quarter({ id: 'zq_akwa', zoneId: 'zon_1', name: 'Akwa', normalizedName: 'akwa', sortOrder: 1 }),
      quarter({ id: 'zq_makepe', zoneId: 'zon_2', name: 'Makèpè', normalizedName: 'makepe', sortOrder: 0 }),
    ],
    emailTemplate: [
      {
        key: 'quote-ack',
        subject: 'Nous avons bien reçu votre demande {référence}',
        preheader: null,
        title: 'Bonjour {prénom}, nous avons bien reçu votre demande.',
        paragraphs: ['Un conseiller vous répond sous 24 h.'],
        buttonLabel: 'Écrire à mon conseiller sur WhatsApp',
        enabled: true,
        translations: null,
        updatedById: null,
        updatedAt: CONTENT_DATE,
      },
    ],
  };
}

/** Tables rechargées entre deux tests (les comptes et les sessions ouvertes sont conservés). */
export const CONTENT_TABLES = [
  'setting',
  'media',
  'category',
  'categoryOfferSection',
  'service',
  'serviceRelation',
  'serviceGalleryImage',
  'serviceFeaturedReview',
  'serviceOffer',
  'review',
  'contact',
  'contactInterest',
  'request',
  'page',
  'zone',
  'zoneQuarter',
  'redirect',
  'emailTemplate',
  'revalidationRequest',
  'backupRun',
  'auditLog',
] as const satisfies readonly (keyof PrismaTables)[];

export function resetContent(tables: PrismaTables, fresh: PrismaTables): void {
  const target = tables as unknown as Record<string, Row[]>;
  for (const name of CONTENT_TABLES) target[name] = structuredClone(fresh[name] ?? []);
}
