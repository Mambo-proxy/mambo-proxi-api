import { describe, expect, it } from 'vitest';
import {
  CATEGORY_TEXT_FIELDS,
  catalogTranslationView,
  localizeCatalog,
  nextCatalogTranslations,
  reviewedCatalogFieldErrors,
  SERVICE_TEXT_FIELDS,
} from './catalog-translations.js';

const service = {
  name: 'Chef privé',
  tagline: 'Un chef chez vous',
  summary: 'Un chef cuisine chez vous.',
  cities: ['Douala', 'Kribi'],
  audiences: ['Particuliers', 'Familles'],
  steps: [
    { title: 'Votre demande', text: 'Décrivez votre repas.' },
    { title: 'Le menu', text: 'Le chef vous propose un menu.' },
  ],
  advantages: [{ icon: 'ChefHat', title: 'Sur mesure', text: 'Menu adapté.' }],
  faq: [] as { question: string; answer: string }[],
  ctaTitle: 'Envie d’un chef ?',
  seoTitle: 'Chef privé | MAMBO Proxi',
  seoDescription: null as string | null,
};

/** Traduction du seed (avant le suivi) : textes non modifiables compris (`cities`, `ctaTitle`), sans empreinte. */
const legacy = {
  en: {
    name: 'Private chef',
    tagline: 'A chef at home',
    summary: 'A chef cooks at your place.',
    cities: ['Douala', 'Kribi'],
    audiences: ['Individuals', 'Families'],
    steps: [
      { title: 'Your request', text: 'Describe your meal.' },
      { title: 'The menu', text: 'The chef suggests a menu.' },
    ],
    advantages: [{ icon: 'Star', title: 'Tailor-made', text: 'Adapted menu.' }],
    ctaTitle: 'Fancy a chef?',
    seoTitle: 'Private chef | MAMBO Proxi',
  },
};

describe('version anglaise des services et des rubriques', () => {
  it('lecture publique : textes seuls sur la structure française, élément ajouté en français repris', () => {
    const french = {
      ...service,
      steps: [...service.steps, { title: 'Le jour J', text: 'Le chef cuisine.' }],
      advantages: [{ icon: 'ChefHat', title: 'Sur mesure', text: 'Menu adapté.' }],
    };
    const english = localizeCatalog(french, legacy, 'en', [
      'name',
      'steps',
      'advantages',
      'cities',
      'seoDescription',
    ]);

    expect(english.name).toBe('Private chef');
    // Trois étapes (celles du français), la troisième non traduite reste en français.
    expect(english.steps).toEqual([
      { title: 'Your request', text: 'Describe your meal.' },
      { title: 'The menu', text: 'The chef suggests a menu.' },
      { title: 'Le jour J', text: 'Le chef cuisine.' },
    ]);
    // L'icône est celle du français.
    expect(english.advantages).toEqual([{ icon: 'ChefHat', title: 'Tailor-made', text: 'Adapted menu.' }]);
    expect(english.seoDescription).toBeNull();
    expect(localizeCatalog(french, legacy, 'fr', ['name'])).toBe(french);
  });

  it('lecture publique : champs techniques des blocs de rubrique gardés du français', () => {
    const category = {
      quoteFields: [
        { name: 'guests', label: 'Nombre de personnes', type: 'number', required: false, min: 1, max: 500 },
      ],
      highlight: {
        kind: 'AGENDA',
        title: 'Prochaines sorties',
        link: { label: 'Voir l’agenda', href: '/evenements', external: false },
      },
      visuals: { hero: { illustration: 'chef', imageId: 'photo-fr', alt: 'Un chef' } },
    };
    const english = localizeCatalog(
      category,
      {
        en: {
          quoteFields: [{ name: 'people', label: 'Number of people', type: 'text', min: 5 }],
          highlight: {
            kind: 'STEPS_BAND',
            title: 'Upcoming outings',
            link: { label: 'See the calendar', href: '/en' },
          },
          visuals: { hero: { illustration: 'culture', imageId: 'photo-en', alt: 'A chef' } },
        },
      },
      'en',
      ['quoteFields', 'highlight', 'visuals'],
    );

    expect(english.quoteFields).toEqual([
      { name: 'guests', label: 'Number of people', type: 'number', required: false, min: 1, max: 500 },
    ]);
    expect(english.highlight).toEqual({
      kind: 'AGENDA',
      title: 'Upcoming outings',
      link: { label: 'See the calendar', href: '/evenements', external: false },
    });
    expect(english.visuals).toEqual({ hero: { illustration: 'chef', imageId: 'photo-fr', alt: 'A chef' } });
  });

  it('back-office : textes modifiables seulement, statut par champ, traduction sans empreinte à jour', () => {
    const view = catalogTranslationView(SERVICE_TEXT_FIELDS, service, legacy);

    expect(view.translations.en).toEqual({
      name: 'Private chef',
      tagline: 'A chef at home',
      summary: 'A chef cooks at your place.',
      audiences: ['Individuals', 'Families'],
      steps: [
        { title: 'Your request', text: 'Describe your meal.' },
        { title: 'The menu', text: 'The chef suggests a menu.' },
      ],
      advantages: [{ title: 'Tailor-made', text: 'Adapted menu.' }],
      seoTitle: 'Private chef | MAMBO Proxi',
    });
    expect(view.translationStatus.en).toEqual({ state: 'UP_TO_DATE', missingFields: [], outdatedFields: [] });

    // Une étape ajoutée en français : le champ `steps` est à traduire.
    const added = { ...service, steps: [...service.steps, { title: 'Le jour J', text: '' }] };
    expect(catalogTranslationView(SERVICE_TEXT_FIELDS, added, legacy).translationStatus.en).toEqual({
      state: 'MISSING',
      missingFields: ['steps'],
      outdatedFields: [],
    });
    expect(catalogTranslationView(SERVICE_TEXT_FIELDS, service, null).translations.en).toBeNull();
  });

  it('enregistrement : textes modifiables seuls, autres textes anglais conservés, empreintes par champ', () => {
    const stored = nextCatalogTranslations({
      fields: SERVICE_TEXT_FIELDS,
      previousFrench: service,
      french: service,
      stored: legacy,
      input: {
        en: {
          name: 'Private chef at home',
          steps: [{ title: 'Your request', text: 'Describe your meal.' }, null, { title: 'Extra' }],
          advantages: [{ icon: 'Star', title: 'Tailor-made' }],
          cities: ['Ignoré'],
        },
      },
    }) as { en: Record<string, unknown> & { sourceHashes: Record<string, string> } };

    expect(stored.en).toMatchObject({
      name: 'Private chef at home',
      steps: [{ title: 'Your request', text: 'Describe your meal.' }],
      advantages: [{ title: 'Tailor-made' }],
      // Champs non modifiables dans le back-office : traduction d'import conservée.
      cities: ['Douala', 'Kribi'],
      ctaTitle: 'Fancy a chef?',
    });
    expect(stored.en).not.toHaveProperty('tagline');
    expect(Object.keys(stored.en.sourceHashes).sort()).toEqual(['advantages', 'name', 'steps']);

    // Le français change ensuite sans retouche de l'anglais : `name` est à revoir.
    const renamed = { ...service, name: 'Chef privé à domicile' };
    const next = nextCatalogTranslations({
      fields: SERVICE_TEXT_FIELDS,
      previousFrench: service,
      french: renamed,
      stored,
      input: undefined,
    });
    expect(catalogTranslationView(SERVICE_TEXT_FIELDS, renamed, next).translationStatus.en).toMatchObject({
      state: 'MISSING',
      outdatedFields: ['name'],
    });

    // Marqué revu : de nouveau à jour.
    const reviewed = nextCatalogTranslations({
      fields: SERVICE_TEXT_FIELDS,
      previousFrench: renamed,
      french: renamed,
      stored: next,
      input: { en: (next as { en: Record<string, unknown> }).en, reviewedFields: ['name'] },
    });
    expect(
      catalogTranslationView(SERVICE_TEXT_FIELDS, renamed, reviewed).translationStatus.en.outdatedFields,
    ).toEqual([]);
  });

  it('enregistrement : traduction antérieure au suivi devenue périmée, suppression par `en: null`', () => {
    const changed = { ...service, tagline: 'Un chef cuisine chez vous' };
    const next = nextCatalogTranslations({
      fields: SERVICE_TEXT_FIELDS,
      previousFrench: service,
      french: changed,
      stored: legacy,
      input: undefined,
    });
    expect(
      catalogTranslationView(SERVICE_TEXT_FIELDS, changed, next).translationStatus.en.outdatedFields,
    ).toEqual(['tagline']);

    const removed = nextCatalogTranslations({
      fields: SERVICE_TEXT_FIELDS,
      previousFrench: service,
      french: service,
      stored: legacy,
      input: { en: null },
    });
    expect(removed).toEqual({ en: { cities: ['Douala', 'Kribi'], ctaTitle: 'Fancy a chef?' } });
    expect(
      nextCatalogTranslations({
        fields: SERVICE_TEXT_FIELDS,
        previousFrench: null,
        french: service,
        stored: null,
        input: { en: null },
      }),
    ).toBeNull();
  });

  it('rubrique : carte d’accueil (puces alignées par rang) et champs revus inconnus refusés', () => {
    const category = {
      name: 'Expérience',
      tagline: 'Des moments sur mesure',
      description: 'Chef privé, massage.',
      heroTitle: 'Des moments ==sur mesure.==',
      homeCard: {
        title: 'Des moments',
        text: 'Se faire plaisir.',
        chips: ['Chef privé', 'Massage', 'Photo'],
      },
      seoTitle: null,
    };
    const stored = nextCatalogTranslations({
      fields: CATEGORY_TEXT_FIELDS,
      previousFrench: null,
      french: category,
      stored: null,
      input: {
        en: { heroTitle: 'Tailor-made ==moments.==', homeCard: { chips: ['Private chef', null, 'Photo'] } },
      },
    });
    const view = catalogTranslationView(CATEGORY_TEXT_FIELDS, category, stored);

    expect(view.translations.en).toEqual({
      heroTitle: 'Tailor-made ==moments.==',
      homeCard: { chips: ['Private chef', null, 'Photo'] },
    });
    expect(view.translationStatus.en.missingFields).toEqual(['name', 'tagline', 'description', 'homeCard']);
    expect(
      reviewedCatalogFieldErrors(CATEGORY_TEXT_FIELDS, category, {
        en: { heroTitle: 'Tailor-made' },
        reviewedFields: ['heroTitle', 'name', 'slug'],
      }),
    ).toEqual([
      expect.objectContaining({ path: 'translations.reviewedFields.1', code: 'unknown_field' }),
      expect.objectContaining({ path: 'translations.reviewedFields.2', code: 'unknown_field' }),
    ]);
  });
});
