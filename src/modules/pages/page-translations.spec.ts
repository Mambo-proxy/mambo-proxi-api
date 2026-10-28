import { describe, expect, it } from 'vitest';
import {
  applyEnglishTexts,
  englishSectionErrors,
  nextSourceHash,
  readEnglish,
  reviewedSectionErrors,
  sectionTextHash,
  stampLegacyHashes,
  translateSections,
  translationStatus,
} from './page-translations.js';

const hero = {
  id: 'hero',
  type: 'hero',
  enabled: true,
  variant: 'home',
  title: 'Bienvenue',
  lead: 'Des services à domicile.',
  primaryCta: { label: 'Demander un devis', href: '/devis' },
  visual: { illustration: 'accueil', imageId: 'photo-fr', alt: 'Une famille.' },
};
const marquee = { id: 'bandeau', type: 'marquee', enabled: true, items: ['Chef privé', 'Massage'] };
const dynamic = { id: 'univers', type: 'dynamic', enabled: true, source: 'categories-bento' };

describe('version anglaise des pages', () => {
  it('ne prend de l’anglais que les textes, structure et champs techniques du français', () => {
    const english = {
      id: 'hero',
      type: 'hero',
      enabled: false,
      variant: 'page',
      title: 'Welcome',
      lead: '',
      primaryCta: { label: 'Request a quote', href: '/en/quote' },
      visual: { illustration: 'chef', imageId: 'photo-en', alt: 'A family.' },
      sticker: 'Ajouté',
    };

    expect(applyEnglishTexts(hero, english)).toEqual({
      ...hero,
      title: 'Welcome',
      primaryCta: { label: 'Request a quote', href: '/devis' },
      visual: { illustration: 'accueil', imageId: 'photo-fr', alt: 'A family.' },
    });
    // Listes : nombre et ordre du français, élément par élément.
    expect(applyEnglishTexts(marquee, { items: ['Private chef', 'Massage', 'En trop'] })).toEqual({
      ...marquee,
      items: ['Private chef', 'Massage'],
    });
  });

  it('fusionne section par section en lecture, avec repli sur le français', () => {
    const sections = translateSections(
      [hero, dynamic, marquee],
      [
        { id: 'hero', title: 'Welcome' },
        { id: 'bandeau', type: 'quote', items: ['Autre type'] },
        { id: 'orpheline', type: 'quote', text: 'Ignored' },
      ],
    );

    expect(sections.map((section) => section['id'])).toEqual(['hero', 'univers', 'bandeau']);
    expect(sections[0]).toMatchObject({ title: 'Welcome', lead: 'Des services à domicile.' });
    expect(sections[2]).toEqual(marquee);
  });

  it('calcule une empreinte stable des seuls textes', () => {
    const hash = sectionTextHash(hero);

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(sectionTextHash({ ...hero, visual: { ...hero.visual, imageId: 'autre' }, enabled: false })).toBe(
      hash,
    );
    expect(sectionTextHash(Object.fromEntries(Object.entries(hero).reverse()))).toBe(hash);
    expect(sectionTextHash({ ...hero, lead: 'Nouveau chapô.' })).not.toBe(hash);
    expect(sectionTextHash(dynamic)).toBeNull();
  });

  it('signale les sections manquantes et périmées', () => {
    const english = readEnglish({
      en: {
        sections: [{ ...hero, title: 'Welcome' }],
        sourceHashes: { hero: sectionTextHash(hero) },
      },
    });

    expect(translationStatus([hero, dynamic], english, [])).toEqual({
      state: 'UP_TO_DATE',
      missingSectionIds: [],
      outdatedSectionIds: [],
    });
    expect(translationStatus([{ ...hero, title: 'Bonjour' }, dynamic], english, [])).toEqual({
      state: 'OUTDATED',
      missingSectionIds: [],
      outdatedSectionIds: ['hero'],
    });
    expect(translationStatus([hero, marquee], english, [])).toMatchObject({
      state: 'MISSING',
      missingSectionIds: ['bandeau'],
    });
    expect(translationStatus([hero], null, [])).toMatchObject({
      state: 'MISSING',
      missingSectionIds: ['hero'],
    });
  });

  it('compare une traduction sans empreinte au français publié, puis l’horodate à la publication', () => {
    const legacy = { en: { sections: [{ ...hero, title: 'Welcome' }] } };
    const english = readEnglish(legacy);

    expect(translationStatus([hero], english, [hero]).state).toBe('UP_TO_DATE');
    expect(translationStatus([{ ...hero, title: 'Bonjour' }], english, [hero]).outdatedSectionIds).toEqual([
      'hero',
    ]);

    const stamped = stampLegacyHashes(legacy, [hero]);
    expect(readEnglish(stamped)?.sourceHashes).toEqual({ hero: sectionTextHash(hero) });
    expect(stampLegacyHashes(stamped, [{ ...hero, title: 'Bonjour' }])).toBeUndefined();
  });

  it('valide les identifiants anglais (existence, type, ordre, doublons)', () => {
    const french = [hero, dynamic, marquee];
    const path = 'translations.en.sections';

    expect(englishSectionErrors(french, [{ id: 'hero' }, { id: 'bandeau', type: 'marquee' }], path)).toEqual(
      [],
    );
    expect(
      englishSectionErrors(
        french,
        [
          { id: 'bandeau' },
          { id: 'hero' },
          { id: 'inconnue' },
          { id: 'bandeau' },
          { id: 'univers', type: 'hero' },
        ],
        path,
      ).map((error) => [error.path, error.code]),
    ).toEqual([
      ['translations.en.sections.1.id', 'section_order'],
      ['translations.en.sections.2.id', 'unknown_section'],
      ['translations.en.sections.3.id', 'duplicate'],
      ['translations.en.sections.4.id', 'section_order'],
    ]);
    expect(englishSectionErrors(french, [{ id: 'univers', type: 'hero' }], path)).toEqual([
      expect.objectContaining({ path: 'translations.en.sections.0.type', code: 'type_mismatch' }),
    ]);
  });

  it('remet à jour une section périmée marquée revue sans changer ses textes anglais', () => {
    const translated = { ...hero, title: 'Welcome' };
    const stored = sectionTextHash(hero) ?? undefined;
    const french = { ...hero, visual: { ...hero.visual, alt: 'Une famille réunie.' } };
    const options = { source: french, section: translated, before: translated, stored, published: undefined };

    // Textes anglais inchangés : l'empreinte gardée laisse la section périmée…
    const kept = nextSourceHash({ ...options, reviewed: false });
    expect(kept).toBe(stored);
    expect(
      translationStatus(
        [french],
        readEnglish({ en: { sections: [translated], sourceHashes: { hero: kept } } }),
        [],
      ).outdatedSectionIds,
    ).toEqual(['hero']);
    // … marquée revue, elle prend l'empreinte du français actuel et redevient à jour.
    const reviewed = nextSourceHash({ ...options, reviewed: true });
    expect(reviewed).toBe(sectionTextHash(french));
    expect(
      translationStatus(
        [french],
        readEnglish({ en: { sections: [translated], sourceHashes: { hero: reviewed } } }),
        [],
      ),
    ).toEqual({ state: 'UP_TO_DATE', missingSectionIds: [], outdatedSectionIds: [] });
  });

  it('refuse une section revue absente de la version anglaise envoyée', () => {
    const path = 'translations.en.reviewedSectionIds';

    expect(reviewedSectionErrors([{ id: 'hero' }], ['hero'], path)).toEqual([]);
    expect(reviewedSectionErrors([{ id: 'hero' }], ['hero', 'bandeau'], path)).toEqual([
      expect.objectContaining({ path: 'translations.en.reviewedSectionIds.1', code: 'unknown_section' }),
    ]);
  });
});
