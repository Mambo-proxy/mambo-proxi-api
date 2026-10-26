/**
 * Enregistrements de démonstration des lectures publiques, construits à partir des données simulées du site
 * (`mambo-proxi-web/src/mocks/data` : catalogue, rubriques, fiche « Chef privé », pages, zones, paramètres) et des
 * exemples du contrat. Chaque enregistrement porte ses relations (graphe en mémoire lu par `prisma-double.ts`).
 *
 * Cas particuliers volontaires : un service en brouillon, un service à publication programmée, une rubrique archivée
 * (et son service publié), une section de page désactivée, une page jamais publiée, une zone inactive avec un tarif
 * indicatif, un avis masqué, une offre d'emploi expirée.
 */
import type { PrismaTables } from '../support/prisma-double.js';

type Row = Record<string, unknown>;

export const FIXTURE_DATE = new Date('2026-10-18T08:00:00.000Z');
const FUTURE = new Date('2099-01-01T00:00:00.000Z');

function media(id: string, file: string, width: number, height: number, alt = ''): Row {
  return {
    id,
    storageKey: `/photos/${file}.png`,
    fileName: `${file}.png`,
    mimeType: 'PNG',
    size: 1000,
    width,
    height,
    alt,
    focalX: null,
    focalY: null,
    blurDataUrl: null,
    variants: [],
    status: 'READY',
  };
}

const MEDIA = {
  chef: media('photo-chef-2', 'chef-2', 1536, 1024, 'Un chef privé présente un plat de poisson braisé.'),
  aicha: media('photo-offre-chef-aicha', 'offre-chef-aicha', 1536, 864),
  expHero: media('photo-exp-hero', 'exp-hero', 1280, 960),
  domicile: media('photo-formule-maison', 'formule-maison', 1280, 960),
  accueil: media('photo-accueil', 'accueil', 1448, 1086),
  temoin: media('photo-offre-tete-a-tete', 'offre-tete-a-tete', 1280, 960),
};

function category(fields: Row): Row {
  return {
    slugEn: null,
    eyebrow: null,
    iconColor: null,
    illustration: 'accueil',
    imageId: null,
    image: null,
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
    testimonial: null,
    quoteFields: [],
    ctaTitle: null,
    ctaText: null,
    seoTitle: null,
    seoDescription: null,
    status: 'PUBLISHED',
    translations: null,
    isDemo: true,
    createdAt: FIXTURE_DATE,
    updatedAt: FIXTURE_DATE,
    services: [],
    offerSections: [],
    ...fields,
  };
}

const categories = {
  domicile: category({
    id: 'cat_domicile',
    slug: 'services-a-domicile',
    name: 'Services à domicile',
    tagline: 'Plus de temps pour l’essentiel',
    description:
      'Une intervenante se déplace chez vous selon la formule choisie : logement, véhicule, linge.',
    heroTitle: 'Plus de temps ==pour l’essentiel.==',
    heroLead: 'Une intervenante de confiance chez vous.',
    icon: 'ShoppingCart',
    iconColor: 'vert-700',
    tint: 'VERT_50',
    illustration: 'logement',
    imageId: MEDIA.domicile['id'],
    image: MEDIA.domicile,
    sortOrder: 1,
    translations: { en: { name: 'Home services', tagline: 'More time for what matters' } },
  }),
  experience: category({
    id: 'cat_experience',
    slug: 'experience',
    name: 'Expérience',
    tagline: 'Des moments sur mesure',
    description:
      'Se déplacer, se faire plaisir, immortaliser un moment : des prestataires triés sur le volet, réservés pour vous.',
    eyebrow: 'Expérience',
    heroTitle: 'Des moments sur mesure, ==pensés pour vous.==',
    heroLead:
      'Location de voiture, chef privé, massage, photographe, événementiel : nous réservons pour vous des prestataires de confiance, au Cameroun.',
    icon: 'Sparkles',
    iconColor: 'orange-700',
    tint: 'ORANGE_50',
    illustration: 'chef',
    imageId: MEDIA.expHero['id'],
    image: MEDIA.expHero,
    visuals: {
      hero: { illustration: 'chef', imageId: MEDIA.expHero['id'], alt: '' },
      testimonial: { illustration: 'chef', imageId: MEDIA.temoin['id'], alt: '' },
      homeCard: { illustration: 'chef', imageId: MEDIA.chef['id'], alt: '' },
    },
    homeCard: {
      title: 'Des moments sur mesure',
      text: 'Se déplacer, se faire plaisir, immortaliser un moment.',
      textMobile: 'Voiture, chef privé, massage, photographe, événementiel.',
      chips: ['Location de voiture', 'Chef privé', 'Massage bien-être', 'Photographe'],
    },
    audiencesTitle: 'Pour les particuliers, les familles et ceux qui reçoivent.',
    audiences: [
      {
        icon: 'User',
        title: 'Particuliers',
        text: 'Vous voulez vous faire plaisir ou simplifier un séjour, sans chercher pendant des heures.',
      },
      {
        icon: 'Users',
        title: 'Familles en séjour',
        text: 'Vous rentrez au pays en vacances : tout est prêt.',
      },
    ],
    servicesTitle: '5 services pour vivre chaque moment pleinement.',
    groups: [{ title: 'À la carte', serviceSlugs: ['chef-prive', 'service-brouillon'] }],
    processTitle: 'Nous coordonnons tout, du premier message au suivi.',
    processSteps: [
      { title: 'Votre demande', text: 'Formulaire, WhatsApp ou rendez-vous.' },
      { title: 'Devis sur mesure', text: 'Une proposition claire sous 24 h.' },
    ],
    quoteFields: [
      { name: 'eventDate', label: 'Date souhaitée', type: 'date', required: false, width: 'half' },
      { name: 'guests', label: 'Nombre de personnes', type: 'number', required: false, min: 1, max: 500 },
    ],
    ctaTitle: 'Envie d’un moment\nsur mesure ?',
    ctaText: 'Dites-nous ce que vous imaginez : nous vous proposons un devis gratuit sous 24 h.',
    seoTitle: 'Expérience : chef privé, location de voiture, photographe au Cameroun',
    seoDescription: 'Des prestataires de confiance réservés pour vous au Cameroun.',
    sortOrder: 2,
    translations: {
      en: {
        name: 'Experience',
        tagline: 'Tailor-made moments',
        description:
          'Getting around, treating yourself, capturing a moment: hand-picked professionals, booked for you.',
        heroTitle: 'Tailor-made moments, ==designed for you.==',
        audiences: [{ title: 'Individuals' }, { title: 'Families on holiday' }],
        homeCard: { title: 'Tailor-made moments', chips: ['Car rental', 'Private chef'] },
      },
    },
  }),
  immobilier: category({
    id: 'cat_immobilier',
    slug: 'immobilier',
    name: 'Immobilier',
    tagline: 'Se loger en toute sérénité',
    description: 'Acheter, vendre, louer, s’installer ou confier votre bien à une équipe présente sur place.',
    heroTitle: 'Se loger ==en toute sérénité.==',
    heroLead: 'Une équipe présente sur place.',
    icon: 'Building',
    iconColor: 'neutral-800',
    tint: 'NEUTRAL_100',
    illustration: 'logement',
    sortOrder: 3,
  }),
  proximite: category({
    id: 'cat_proximite',
    slug: 'services-de-proximite',
    name: 'Services de proximité',
    tagline: 'Votre quotidien simplifié',
    description: 'Repas, courses, colis, linge : nous nous en chargeons pour vous et pour vos proches.',
    heroTitle: 'Votre quotidien ==simplifié.==',
    heroLead: 'Repas, courses, colis.',
    icon: 'ShoppingCart',
    tint: 'VERT_50',
    illustration: 'livraison',
    sortOrder: 4,
  }),
  culture: category({
    id: 'cat_culture',
    slug: 'culture-evenementiel',
    name: 'Culture & événementiel',
    tagline: 'Vivre le Cameroun',
    description: "Découvertes, sorties, événements et intégration locale : le pays vu de l'intérieur.",
    heroTitle: 'Vivre ==le Cameroun.==',
    heroLead: 'Le pays vu de l’intérieur.',
    icon: 'Compass',
    iconColor: 'orange-400',
    tint: 'NEUTRAL_900',
    illustration: 'marche',
    highlight: {
      kind: 'AGENDA',
      eyebrow: 'Agenda',
      title: 'Les prochains ==événements Mambo==',
      text: null,
      note: null,
      link: { label: "Voir tout l'agenda", href: '/evenements' },
    },
    sortOrder: 5,
  }),
  archived: category({
    id: 'cat_archivee',
    slug: 'ancienne-rubrique',
    name: 'Ancienne rubrique',
    tagline: 'Archivée',
    description: 'Rubrique archivée.',
    heroTitle: 'Archivée',
    heroLead: 'Archivée',
    icon: 'Archive',
    tint: 'NEUTRAL_100',
    status: 'ARCHIVED',
    sortOrder: 6,
  }),
};

function service(fields: Row & { category: Row }): Row {
  return {
    slugEn: null,
    shortName: null,
    kind: 'SERVICE',
    tagline: typeof fields['summary'] === 'string' ? fields['summary'] : '',
    summary: '',
    icon: 'Sparkles',
    illustration: 'accueil',
    coverImageId: null,
    coverImage: null,
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
    publishedAt: FIXTURE_DATE,
    translations: null,
    isDemo: true,
    createdAt: FIXTURE_DATE,
    updatedAt: FIXTURE_DATE,
    categoryId: fields.category['id'],
    gallery: [],
    offers: [],
    related: [],
    featuredReviews: [],
    ...fields,
  };
}

const services = {
  maisonEssentiel: service({
    id: 'svc_maison_essentiel',
    slug: 'maison-essentiel',
    kind: 'FORMULA',
    name: 'Maison Essentiel',
    summary: 'Entretien du logement · 2 h.',
    icon: 'Utensils',
    illustration: 'logement',
    coverImageId: MEDIA.domicile['id'],
    coverImage: MEDIA.domicile,
    sortOrder: 1,
    category: categories.domicile,
    translations: { en: { name: 'Home Essential', summary: 'Home cleaning · 2 hours.' } },
  }),
  entretien: service({
    id: 'svc_entretien_du_logement',
    slug: 'entretien-du-logement',
    name: 'Entretien du logement',
    summary: 'Ménage, cuisine et salle de bain, sols et surfaces, ponctuellement ou chaque semaine.',
    illustration: 'logement',
    sortOrder: 5,
    category: categories.domicile,
  }),
  locationVoiture: service({
    id: 'svc_location_voiture',
    slug: 'location-voiture',
    name: 'Location de voiture',
    summary: 'Véhicules récents, avec ou sans chauffeur, pour vos trajets et vos séjours.',
    icon: 'Car',
    illustration: 'voiture',
    featuredOnHome: true,
    sortOrder: 1,
    category: categories.experience,
    translations: { en: { name: 'Car rental' } },
  }),
  photographe: service({
    id: 'svc_photographe',
    slug: 'photographe',
    name: 'Photographe',
    summary: 'Portraits, événements, reportages : vos moments immortalisés.',
    icon: 'Camera',
    illustration: 'photo',
    sortOrder: 2,
    category: categories.experience,
  }),
  chefPrive: service({
    id: 'svc_chef_prive',
    slug: 'chef-prive',
    slugEn: 'private-chef',
    name: 'Chef privé',
    summary: 'Un chef à domicile pour vos dîners, réceptions et grandes occasions.',
    tagline:
      'Un chef à domicile pour vos dîners, réceptions et grandes occasions. Vous profitez de vos invités, nous nous occupons du reste.',
    icon: 'ChefHat',
    illustration: 'chef',
    coverImageId: MEDIA.chef['id'],
    coverImage: MEDIA.chef,
    cities: ['Douala', 'Yaoundé', 'Kribi'],
    audiences: ['Aux particuliers qui reçoivent famille ou amis', 'Aux familles en séjour à Douala'],
    steps: [
      {
        title: 'Échange sur votre projet',
        text: 'Date, lieu, nombre d’invités, envies et contraintes alimentaires.',
      },
      { title: 'Proposition de menu et devis', text: 'Le chef imagine un menu sur mesure.' },
    ],
    advantages: [
      { icon: 'Sparkles', title: 'Un menu unique', text: 'Pensé pour vos goûts et votre occasion.' },
    ],
    faq: [
      {
        question: 'Combien coûte un chef privé ?',
        answer: 'Chaque prestation est unique : le tarif vous est communiqué sur devis, gratuitement.',
      },
    ],
    quoteBullets: ['Gratuit et sans engagement', 'Menu et prestation sur mesure'],
    offersEyebrow: 'Nos chefs',
    offersTitle: 'Choisissez votre chef et votre formule.',
    offersLead: 'Faites défiler les chefs et les formules, puis demandez un devis.',
    offersLeadMobile: 'Faites défiler, puis demandez un devis.',
    featuredOnHome: true,
    reviewsTitle: 'Ils ont reçu un chef à domicile',
    relatedTitle: 'Pour compléter votre événement',
    ctaTitle: 'Prêt à recevoir\nvos invités ?',
    ctaText: 'Votre devis chef privé, gratuit et sans engagement, sous 24 h.',
    seoTitle: 'Chef privé à domicile à Douala, Yaoundé, Kribi',
    seoDescription: 'Un chef à domicile pour vos dîners et réceptions au Cameroun.',
    sortOrder: 3,
    updatedAt: new Date('2026-10-19T08:00:00.000Z'),
    category: categories.experience,
    translations: {
      en: {
        name: 'Private chef',
        summary: 'A chef at your home for dinners, receptions and special occasions.',
        tagline: 'A chef at your home: you enjoy your guests, we take care of the rest.',
        steps: [{ title: 'Talking about your project' }, { title: 'Menu proposal and quote' }],
        faq: [{ question: 'How much does a private chef cost?' }],
        offersEyebrow: 'Our chefs',
        reviewsTitle: 'They welcomed a chef at home',
        ctaTitle: 'Ready to welcome\nyour guests?',
      },
    },
  }),
  massage: service({
    id: 'svc_massage_bien_etre',
    slug: 'massage-bien-etre',
    name: 'Massage bien-être',
    summary: 'Des praticiens qualifiés, chez vous ou sur votre lieu de séjour.',
    icon: 'Flower2',
    illustration: 'massage',
    showInMenu: false,
    sortOrder: 4,
    category: categories.experience,
  }),
  draft: service({
    id: 'svc_brouillon',
    slug: 'service-brouillon',
    name: 'Service en brouillon',
    summary: 'Pas encore publié.',
    status: 'DRAFT',
    publishedAt: null,
    sortOrder: 6,
    category: categories.experience,
  }),
  scheduled: service({
    id: 'svc_programme',
    slug: 'service-programme',
    name: 'Service programmé',
    summary: 'Publication programmée.',
    publishedAt: FUTURE,
    sortOrder: 7,
    category: categories.experience,
  }),
  rechercheLogement: service({
    id: 'svc_recherche_logement',
    slug: 'recherche-logement',
    name: 'Recherche de logement',
    summary: 'Nous trouvons pour vous le logement qui vous correspond.',
    icon: 'Search',
    illustration: 'logement',
    sortOrder: 1,
    category: categories.immobilier,
  }),
  repas: service({
    id: 'svc_portage_livraison_repas',
    slug: 'portage-livraison-repas',
    name: 'Portage et livraison de repas',
    summary: 'Des repas préparés et livrés chez vous ou chez vos proches.',
    icon: 'Utensils',
    illustration: 'livraison',
    sortOrder: 1,
    category: categories.proximite,
  }),
  decouverte: service({
    id: 'svc_decouverte_cameroun',
    slug: 'decouverte-cameroun',
    name: 'Découverte du Cameroun',
    summary: 'Circuits et visites pour découvrir le pays.',
    icon: 'Compass',
    illustration: 'culture',
    sortOrder: 1,
    category: categories.culture,
  }),
  archivedCategoryService: service({
    id: 'svc_rubrique_archivee',
    slug: 'service-rubrique-archivee',
    name: 'Service d’une rubrique archivée',
    summary: 'Invisible.',
    sortOrder: 1,
    category: categories.archived,
  }),
};

// Rubriques → services (graphe des relations).
for (const item of Object.values(services)) {
  const owner = item['category'] as Row;
  (owner['services'] as Row[]).push(item);
}

function review(fields: Row): Row {
  return {
    city: 'Douala',
    rating: 5,
    excerpt: null,
    serviceId: services.chefPrive['id'],
    service: services.chefPrive,
    surveyId: null,
    status: 'PUBLIE',
    verified: true,
    featured: false,
    publishConsent: true,
    reply: null,
    isDemo: true,
    createdAt: FIXTURE_DATE,
    updatedAt: FIXTURE_DATE,
    ...fields,
  };
}

const reviews = [
  review({
    id: 'rev_jean_marc_chef',
    authorName: 'Jean-Marc T.',
    city: 'Yaoundé',
    text: "Le chef a régalé nos invités pour l'anniversaire de ma mère. Service impeccable, du début à la fin.",
    featured: true,
    date: new Date('2026-09-12T10:00:00.000Z'),
  }),
  review({
    id: 'rev_laure_chef',
    authorName: 'Laure B.',
    rating: 4,
    text: 'Dîner de fiançailles parfait : menu revisité, table magnifique, et une cuisine rendue impeccable.',
    verified: false,
    date: new Date('2026-08-24T10:00:00.000Z'),
  }),
  review({
    id: 'rev_masque',
    authorName: 'Avis M.',
    rating: 1,
    text: 'Avis masqué par la modération.',
    status: 'MASQUE',
    date: new Date('2026-10-01T10:00:00.000Z'),
  }),
];

categories.experience['testimonialId'] = 'rev_jean_marc_chef';
categories.experience['testimonial'] = reviews[0];

function offer(fields: Row): Row {
  return {
    serviceId: null,
    sectionId: null,
    targetServiceId: null,
    targetService: null,
    titleMobile: null,
    textMobile: null,
    icon: null,
    illustration: 'chef',
    imageId: null,
    image: null,
    action: 'QUOTE',
    actionLabel: 'Demander un devis',
    actionLabelMobile: 'Devis',
    translations: null,
    isDemo: true,
    createdAt: FIXTURE_DATE,
    updatedAt: FIXTURE_DATE,
    ...fields,
  };
}

services.chefPrive['offers'] = [
  offer({
    id: 'off_chef_paul',
    serviceId: 'svc_chef_prive',
    title: 'Chef Paul — cuisine camerounaise',
    titleMobile: 'Chef Paul — camerounaise',
    text: 'Ndolé, poisson braisé, plantains · buffets et dîners',
    textMobile: 'Ndolé, poisson braisé, plantains',
    imageId: MEDIA.chef['id'],
    image: MEDIA.chef,
    sortOrder: 1,
    translations: { en: { title: 'Chef Paul — Cameroonian cuisine', actionLabel: 'Request a quote' } },
  }),
  offer({
    id: 'off_chef_aicha',
    serviceId: 'svc_chef_prive',
    title: 'Chef Aïcha — cuisine fusion',
    text: 'Menus gastronomiques · 2 à 12 convives',
    imageId: MEDIA.aicha['id'],
    image: MEDIA.aicha,
    sortOrder: 2,
  }),
];
services.chefPrive['gallery'] = [
  { serviceId: 'svc_chef_prive', mediaId: MEDIA.chef['id'], sortOrder: 1, alt: null, media: MEDIA.chef },
  {
    serviceId: 'svc_chef_prive',
    mediaId: MEDIA.aicha['id'],
    sortOrder: 2,
    alt: 'Un dîner servi',
    media: MEDIA.aicha,
  },
];
services.chefPrive['related'] = [
  {
    serviceId: 'svc_chef_prive',
    relatedServiceId: 'svc_location_voiture',
    sortOrder: 1,
    relatedService: services.locationVoiture,
  },
  {
    serviceId: 'svc_chef_prive',
    relatedServiceId: 'svc_brouillon',
    sortOrder: 2,
    relatedService: services.draft,
  },
  {
    serviceId: 'svc_chef_prive',
    relatedServiceId: 'svc_photographe',
    sortOrder: 3,
    relatedService: services.photographe,
  },
];

categories.experience['offerSections'] = [
  {
    id: 'sec_vehicules',
    categoryId: 'cat_experience',
    eyebrow: 'Nos véhicules',
    title: 'Choisissez ==votre véhicule.==',
    titleMobile: null,
    lead: null,
    leadMobile: null,
    sortOrder: 1,
    translations: { en: { eyebrow: 'Our vehicles' } },
    offers: [
      offer({
        id: 'off_berline',
        sectionId: 'sec_vehicules',
        title: 'Berline avec chauffeur',
        text: 'Pour vos trajets en ville.',
        illustration: 'voiture',
        action: 'BOOKING',
        actionLabel: 'Réserver',
        actionLabelMobile: null,
        targetServiceId: 'svc_location_voiture',
        targetService: services.locationVoiture,
        sortOrder: 1,
      }),
    ],
  },
  {
    id: 'sec_vide',
    categoryId: 'cat_experience',
    eyebrow: 'Vide',
    title: 'Section sans offre',
    titleMobile: null,
    lead: null,
    leadMobile: null,
    sortOrder: 2,
    translations: null,
    offers: [],
  },
];

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
    publishedAt: FIXTURE_DATE,
    publishedById: null,
    updatedById: null,
    createdAt: FIXTURE_DATE,
    updatedAt: FIXTURE_DATE,
    ...fields,
  };
}

const pages = [
  page({
    key: 'accueil',
    title: 'Accueil',
    path: '/',
    sections: [
      {
        id: 'hero',
        type: 'hero',
        enabled: true,
        variant: 'home',
        tone: 'muted',
        title: "Mambo, ce n'est pas qu'un service. ==C'est une expérience pensée pour vous.==",
        lead: 'Nos intervenants de confiance se déplacent chez vous, à Douala et environs.',
        primaryCta: { label: 'Demander un devis gratuit', href: '/devis' },
        visual: {
          illustration: 'accueil',
          imageId: MEDIA.accueil['id'],
          alt: 'Une famille sourit dans son salon.',
        },
      },
      { id: 'ancienne-section', type: 'quote', enabled: false, text: 'Section désactivée.' },
      { id: 'univers', type: 'dynamic', enabled: true, title: 'Nos univers', source: 'categories-bento' },
      {
        id: 'bandeau-services',
        type: 'marquee',
        enabled: true,
        items: ['Location de voiture', 'Chef privé', 'Massage bien-être'],
      },
    ],
    translations: {
      en: {
        title: 'Home',
        sections: [
          {
            id: 'hero',
            title: "Mambo isn't just a service. ==It's an experience designed for you.==",
            primaryCta: { label: 'Request a free quote' },
          },
          { id: 'bandeau-services', items: ['Car rental', 'Private chef', 'Wellness massage'] },
        ],
      },
    },
  }),
  page({
    key: 'mission',
    title: 'Notre mission',
    path: '/mission',
    sections: [
      {
        id: 'hero',
        type: 'hero',
        enabled: true,
        variant: 'page',
        eyebrow: 'Mission',
        title: 'Rendre le quotidien ==plus simple.==',
        visual: { illustration: 'equipe', image: null, alt: '' },
      },
    ],
    seo: {
      title: 'Notre mission',
      description: 'La mission de MAMBO Proxi.',
      ogImageUrl: null,
      noindex: false,
    },
  }),
  page({ key: 'magazine', title: 'Magazine', path: '/magazine', sections: [], publishedAt: null }),
  page({
    key: 'mentions-legales',
    title: 'Mentions légales',
    path: '/mentions-legales',
    group: 'legales',
    sections: [],
  }),
  page({ key: '404', title: 'Page introuvable', path: '/404', group: 'systeme', sections: [] }),
];

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
    createdAt: FIXTURE_DATE,
    updatedAt: FIXTURE_DATE,
    ...fields,
  };
}

const zones = [
  {
    id: 'zone_1',
    key: 'zone-1',
    name: 'Zone 1 — Proximité',
    nameEn: 'Zone 1 — Nearby',
    tone: 'zone1',
    description: 'Autour de la base de Cité SIC.',
    descriptionEn: 'Around our Cité SIC base.',
    result:
      'Intervention à domicile et livraison dans les meilleurs délais. Conditions confirmées sur devis.',
    resultEn: null,
    delay: '30–45 min',
    feeAmount: 1500,
    feeCurrency: 'XAF',
    feeFrom: false,
    area: {
      type: 'Polygon',
      coordinates: [
        [
          [9.715, 4.07],
          [9.755, 4.09],
          [9.77, 4.05],
          [9.765, 4.018],
          [9.735, 4.025],
          [9.715, 4.07],
        ],
      ],
    },
    active: true,
    sortOrder: 1,
    isDemo: true,
    createdAt: FIXTURE_DATE,
    updatedAt: FIXTURE_DATE,
    quarters: [
      quarter({
        id: 'q_cite_sic',
        name: 'Cité SIC',
        normalizedName: 'cite sic',
        mapLabel: 'Cité SIC · base de départ',
        mapLabelEn: 'Cité SIC · starting base',
        isBase: true,
        labelOnSmallMap: true,
        lat: 4.0565,
        lng: 9.732,
        mapX: 0.5789,
        mapY: 0.5889,
        sortOrder: 1,
      }),
      quarter({
        id: 'q_ndokoti',
        name: 'Ndokoti',
        normalizedName: 'ndokoti',
        lat: 4.042,
        lng: 9.748,
        sortOrder: 2,
      }),
    ],
  },
  {
    id: 'zone_speciale',
    key: 'zone-speciale',
    name: 'Zone spéciale',
    nameEn: 'Special zone',
    tone: 'special',
    description: 'Intervention possible, sur devis.',
    descriptionEn: null,
    result: 'Intervention possible selon votre demande. Conditions et délais confirmés sur devis.',
    resultEn: 'Possible on request. Terms and timing confirmed in the quote.',
    delay: null,
    feeAmount: null,
    feeCurrency: null,
    feeFrom: false,
    area: { type: 'Polygon', coordinates: [[[9.64, 4.1]]] },
    active: true,
    sortOrder: 2,
    isDemo: true,
    createdAt: FIXTURE_DATE,
    updatedAt: new Date('2026-10-20T08:00:00.000Z'),
    quarters: [
      quarter({
        id: 'q_bonaberi',
        name: 'Bonabéri',
        normalizedName: 'bonaberi',
        detail: 'rive ouest du Wouri',
        detailEn: 'west bank of the Wouri',
        lat: 4.073,
        lng: 9.662,
        sortOrder: 1,
      }),
      quarter({ id: 'q_autres', name: 'Autres quartiers hors zone', normalizedName: 'autres', sortOrder: 2 }),
    ],
  },
  {
    id: 'zone_inactive',
    key: 'zone-inactive',
    name: 'Zone en préparation',
    nameEn: null,
    tone: 'zone3',
    description: '',
    descriptionEn: null,
    result: '',
    resultEn: null,
    delay: null,
    feeAmount: 3500,
    feeCurrency: 'XAF',
    feeFrom: true,
    area: null,
    active: false,
    sortOrder: 3,
    isDemo: true,
    createdAt: FIXTURE_DATE,
    updatedAt: FIXTURE_DATE,
    quarters: [quarter({ id: 'q_lendi', name: 'Lendi', normalizedName: 'lendi', sortOrder: 1 })],
  },
];

function setting(key: string, value: Row, translations: Row | null = null): Row {
  return { key, value, translations, updatedById: null, updatedAt: FIXTURE_DATE };
}

const settings = [
  setting(
    'site',
    {
      siteName: 'MAMBO Proxi',
      tagline: 'Vos services, au plus près de vous',
      signature: "Mambo, ce n'est pas qu'un service. C'est une expérience pensée pour vous.",
    },
    { en: { tagline: 'Your services, close at hand' } },
  ),
  setting(
    'coordonnees',
    {
      phoneFrance: null,
      phoneCameroon: '+237600000000',
      email: 'contact@mamboproxi.com',
      hoursLabel: 'Lun – Sam · 8h – 20h',
      agency: {
        name: 'Agence MAMBO Proxi',
        addressLines: ['Adresse de l’agence'],
        city: 'Douala',
        country: 'CM',
        phone: '+237600000000',
        latitude: 4.0511,
        longitude: 9.7679,
        mapsUrl: 'https://www.google.com/maps/search/?api=1&query=4.0511,9.7679',
        openingHours: [
          { label: 'Lundi – vendredi', hours: '8 h – 18 h' },
          { label: 'Samedi', hours: '9 h – 13 h' },
        ],
        parcelReceptionNote: "Réception des colis et courriers aux heures d'ouverture.",
      },
    },
    {
      en: {
        hoursLabel: 'Mon – Sat · 8am – 8pm',
        agency: {
          name: 'MAMBO Proxi agency',
          openingHours: [{ label: 'Monday – Friday', hours: '8am – 6pm' }],
        },
      },
    },
  ),
  setting(
    'whatsapp',
    {
      enabled: true,
      number: '+237600000000',
      message: 'Bonjour Mambo Proxi, je souhaite des informations sur…',
    },
    { en: { message: 'Hello Mambo Proxi, I would like some information about…' } },
  ),
  setting('reseaux', {
    social: [
      { network: 'instagram', url: 'https://www.instagram.com/mamboproxi' },
      { network: 'facebook', url: 'https://www.facebook.com/mamboproxi' },
    ],
  }),
  setting('seo', {
    defaultTitle: 'MAMBO Proxi — Services du quotidien à domicile à Douala',
    defaultDescription: 'Des intervenants de confiance à domicile, à Douala et environs.',
    ogImageId: null,
    searchConsoleVerification: null,
  }),
  setting('analytics', { ga4MeasurementId: null, newsletterTracking: false }),
  setting(
    'chiffres',
    {
      keyFigures: [
        { key: 'projects', value: 150, suffix: '+', label: 'projets accompagnés' },
        {
          key: 'area',
          valueText: 'Douala',
          label: 'et environs, au départ de Cité SIC',
          labelMobile: 'et environs',
        },
      ],
    },
    {
      en: { keyFigures: [{ label: 'projects supported' }, { label: 'and surroundings', labelMobile: null }] },
    },
  ),
  setting('securite', { maintenanceMode: false, trustedDeviceDays: 30 }),
  setting(
    'navigation',
    {
      main: [
        { key: 'accueil', label: 'Accueil', href: '/', kind: 'link' },
        { key: 'services', label: 'Nos services', href: '/services', kind: 'mega' },
        {
          key: 'mission',
          label: 'Mission',
          href: '/mission',
          kind: 'dropdown',
          children: [{ label: 'Notre mission', href: '/mission#notre-mission' }],
        },
        {
          key: 'zones',
          label: 'Zones d’intervention',
          href: '/zones-d-intervention',
          kind: 'link',
          placement: 'mobile',
        },
      ],
      megaMenuPromo: {
        title: 'Un besoin précis ?',
        text: 'Devis gratuit, réponse sous 24 h.',
        cta: { label: 'Devis gratuit', href: '/devis' },
        visual: { illustration: 'accueil', imageId: MEDIA.accueil['id'], alt: '' },
      },
      signUp: [{ label: 'Je suis un particulier', href: '/inscription', icon: 'User' }],
      footer: {
        about: 'Votre agence de services du quotidien à domicile, à Douala.',
        copyright: '© 2026 Mambo Proxi · Douala — Cameroun',
        newsletter: {
          eyebrow: 'La lettre Mambo',
          title: 'Restez au plus près de nos nouveautés',
          text: 'Nouveaux services, magazine et conseils. Désinscription en un clic.',
        },
        columns: [{ title: 'Nos services', links: [{ label: 'Expérience', href: '/services/experience' }] }],
      },
      legal: [{ label: 'Mentions légales', href: '/mentions-legales' }],
    },
    {
      en: {
        main: [{ label: 'Home' }, { label: 'Our services' }, { children: [{ label: 'Our mission' }] }, {}],
        megaMenuPromo: { title: 'Have a specific need?' },
        footer: { newsletter: { eyebrow: 'The Mambo letter' } },
      },
    },
  ),
  setting(
    'zones',
    {
      showFees: false,
      note: 'Votre quartier n’apparaît pas ? Contactez-nous : nous étudions chaque demande.',
    },
    { en: { note: 'Can’t find your neighbourhood? Contact us: we look at every request.' } },
  ),
];

const jobOffers = [
  {
    id: 'job_chef_domicile',
    slug: 'chef-cuisinier-a-domicile',
    status: 'PUBLISHED',
    publishedAt: FIXTURE_DATE,
    expiresAt: null,
    updatedAt: FIXTURE_DATE,
  },
  {
    id: 'job_expire',
    slug: 'offre-expiree',
    status: 'PUBLISHED',
    publishedAt: FIXTURE_DATE,
    expiresAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: FIXTURE_DATE,
  },
];

const redirects = [
  {
    id: 'red_chef',
    fromPath: '/services/experience/chef-a-domicile',
    toPath: '/services/experience/chef-prive',
    permanent: true,
    entity: 'Service',
    entityId: 'svc_chef_prive',
    createdAt: FIXTURE_DATE,
  },
];

/** Nouvelles tables (copie superficielle) pour un test. */
export function publicContentTables(): PrismaTables {
  return {
    setting: [...settings],
    media: Object.values(MEDIA),
    category: Object.values(categories),
    service: Object.values(services),
    review: [...reviews],
    page: [...pages],
    zone: [...zones],
    redirect: [...redirects],
    jobOffer: [...jobOffers],
  };
}

export const FIXTURES = { categories, services, reviews, pages, zones, settings, media: MEDIA };
