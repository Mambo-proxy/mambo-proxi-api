import { describe, expect, it } from 'vitest';
import { langQuerySchema } from './lang.js';
import { localize, localizeFields, mergeTranslation, pickLocalized, translationFor } from './translations.js';

describe('langQuerySchema', () => {
  it('vaut « fr » par défaut et accepte « en »', () => {
    expect(langQuerySchema.parse({})).toEqual({ lang: 'fr' });
    expect(langQuerySchema.parse({ lang: 'en' })).toEqual({ lang: 'en' });
  });

  it('refuse une autre langue', () => {
    expect(langQuerySchema.safeParse({ lang: 'de' }).success).toBe(false);
  });
});

describe('mergeTranslation', () => {
  it('remplace les textes traduits et garde le français des champs absents, nuls ou vides', () => {
    const french = { name: 'Chef privé', tagline: 'Un chef à domicile', summary: 'Résumé', icon: 'ChefHat' };

    expect(mergeTranslation(french, { name: 'Private chef', tagline: null, summary: '' })).toEqual({
      name: 'Private chef',
      tagline: 'Un chef à domicile',
      summary: 'Résumé',
      icon: 'ChefHat',
    });
  });

  it('fusionne les objets imbriqués champ par champ', () => {
    const french = {
      agency: { name: 'Agence', city: 'Douala', openingHours: [{ label: 'Samedi', hours: '9 h' }] },
    };
    const english = { agency: { name: 'Agency', openingHours: [{ label: 'Saturday' }] } };

    expect(mergeTranslation(french, english)).toEqual({
      agency: { name: 'Agency', city: 'Douala', openingHours: [{ label: 'Saturday', hours: '9 h' }] },
    });
  });

  it("apparie les éléments identifiés par leur id et garde l'ordre français", () => {
    const sections = [
      { id: 'hero', type: 'hero', title: 'Bienvenue', enabled: true },
      { id: 'cta', type: 'ctaBand', title: 'Contact', enabled: false },
    ];
    const english = [
      { id: 'cta', title: 'Get in touch' },
      { id: 'hero', title: 'Welcome' },
      { id: 'inconnue', title: 'Ignored' },
    ];

    expect(mergeTranslation(sections, english)).toEqual([
      { id: 'hero', type: 'hero', title: 'Welcome', enabled: true },
      { id: 'cta', type: 'ctaBand', title: 'Get in touch', enabled: false },
    ]);
  });

  it('remplace une liste de textes et complète les éléments de même rang', () => {
    expect(mergeTranslation(['Douala', 'Yaoundé'], ['Douala', 'Yaounde', 'Kribi'])).toEqual([
      'Douala',
      'Yaounde',
      'Kribi',
    ]);
    expect(
      mergeTranslation(
        [{ icon: 'Clock', title: 'Du temps', text: 'Vous profitez.' }],
        [{ title: 'Time for you', text: 'You enjoy.' }],
      ),
    ).toEqual([{ icon: 'Clock', title: 'Time for you', text: 'You enjoy.' }]);
  });

  it('garde le français quand la traduction est une liste vide ou de forme différente', () => {
    expect(mergeTranslation(['a'], [])).toEqual(['a']);
    expect(mergeTranslation('Texte', { en: 'Text' })).toBe('Texte');
    expect(mergeTranslation({ title: 'Titre' }, 'Title')).toEqual({ title: 'Titre' });
  });
});

describe('translationFor / localize / localizeFields', () => {
  const translations = { en: { name: 'Experience', status: 'DRAFT' } };

  it("ne lit la traduction qu'en anglais", () => {
    expect(translationFor(translations, 'fr')).toBeUndefined();
    expect(translationFor(translations, 'en')).toEqual({ name: 'Experience', status: 'DRAFT' });
    expect(translationFor(null, 'en')).toBeUndefined();
    expect(translationFor({ en: 'texte' }, 'en')).toBeUndefined();
  });

  it('fusionne toute la valeur avec localize', () => {
    expect(localize({ note: 'Note' }, { en: { note: 'Note EN' } }, 'en')).toEqual({ note: 'Note EN' });
    expect(localize({ note: 'Note' }, { en: { note: 'Note EN' } }, 'fr')).toEqual({ note: 'Note' });
  });

  it('ne recouvre que les champs traduisibles avec localizeFields', () => {
    const record = { name: 'Expérience', status: 'PUBLISHED' };

    expect(localizeFields(record, translations, 'en', ['name'])).toEqual({
      name: 'Experience',
      status: 'PUBLISHED',
    });
    expect(localizeFields(record, translations, 'fr', ['name'])).toBe(record);
  });
});

describe('pickLocalized', () => {
  it('prend la colonne anglaise si elle est renseignée', () => {
    expect(pickLocalized('Zone 1 — Proximité', 'Zone 1 — Nearby', 'en')).toBe('Zone 1 — Nearby');
    expect(pickLocalized('Zone 1 — Proximité', null, 'en')).toBe('Zone 1 — Proximité');
    expect(pickLocalized('Zone 1 — Proximité', '', 'en')).toBe('Zone 1 — Proximité');
    expect(pickLocalized('Zone 1 — Proximité', 'Zone 1 — Nearby', 'fr')).toBe('Zone 1 — Proximité');
  });
});
