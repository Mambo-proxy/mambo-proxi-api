import { describe, expect, it } from 'vitest';
import { fieldHash } from '../../common/i18n/text-translation.js';
import {
  localizeSetting,
  nextSettingTranslations,
  reviewedFieldErrors,
  settingTranslationView,
} from './setting-translations.js';

const coordonnees = {
  phoneCameroon: '+237600000000',
  email: 'contact@mamboproxi.com',
  hoursLabel: 'Lun – Sam · 8h – 20h',
  agency: {
    name: 'Agence MAMBO Proxi',
    addressLines: ['Cité SIC'],
    city: 'Douala',
    country: 'CM',
    phone: '+237699001122',
    latitude: 4.06,
    longitude: 9.73,
    mapsUrl: 'https://maps.example/nouveau',
    openingHours: [{ label: 'Lundi', hours: '8 h – 18 h' }],
    parcelReceptionNote: 'Réception des colis aux heures d’ouverture.',
  },
};

/** Ancienne version anglaise du seed : agence recopiée en entier (numéro, GPS, lien d'avant). */
const legacyEnglish = {
  en: {
    hoursLabel: 'Mon – Sat · 8am – 8pm',
    agency: {
      name: 'MAMBO Proxi agency',
      addressLines: ['Agency address'],
      city: 'Douala',
      country: 'CM',
      phone: '+237600000000',
      latitude: 4.0511,
      longitude: 9.7679,
      mapsUrl: 'https://maps.example/ancien',
      openingHours: [{ label: 'Monday', hours: '8am – 6pm' }],
      parcelReceptionNote: 'Parcels are received during opening hours.',
    },
  },
};

describe('version anglaise des paramètres', () => {
  it('lecture publique : seuls les textes viennent de l’anglais (numéro, GPS et lien du français)', () => {
    const english = localizeSetting('coordonnees', coordonnees, legacyEnglish, 'en') as typeof coordonnees;

    expect(english.hoursLabel).toBe('Mon – Sat · 8am – 8pm');
    expect(english.agency).toEqual({
      ...coordonnees.agency,
      name: 'MAMBO Proxi agency',
      addressLines: ['Agency address'],
      openingHours: [{ label: 'Monday', hours: '8am – 6pm' }],
      parcelReceptionNote: 'Parcels are received during opening hours.',
    });
    expect(localizeSetting('coordonnees', coordonnees, legacyEnglish, 'fr')).toBe(coordonnees);
  });

  it('chiffres clés : valeurs et clés du français, libellés anglais', () => {
    const french = {
      keyFigures: [{ key: 'projects', value: 180, suffix: '+', label: 'projets accompagnés' }],
    };
    const translations = { en: { keyFigures: [{ key: 'other', value: 150, label: 'projects supported' }] } };
    expect(localizeSetting('chiffres', french, translations, 'en')).toEqual({
      keyFigures: [{ key: 'projects', value: 180, suffix: '+', label: 'projects supported' }],
    });
  });

  it('groupes sans liste blanche : recouvrement habituel', () => {
    expect(
      localizeSetting('site', { tagline: 'Au plus près' }, { en: { tagline: 'Close at hand' } }, 'en'),
    ).toEqual({ tagline: 'Close at hand' });
  });

  it('back-office : textes anglais réduits à la liste blanche et statut par champ', () => {
    const view = settingTranslationView('coordonnees', coordonnees, legacyEnglish);

    expect(view?.translations.en).toEqual({
      hoursLabel: 'Mon – Sat · 8am – 8pm',
      agency: {
        name: 'MAMBO Proxi agency',
        addressLines: ['Agency address'],
        openingHours: [{ label: 'Monday', hours: '8am – 6pm' }],
        parcelReceptionNote: 'Parcels are received during opening hours.',
      },
    });
    // Sans empreinte (seed) : à jour.
    expect(view?.translationStatus.en).toEqual({
      state: 'UP_TO_DATE',
      missingFields: [],
      outdatedFields: [],
    });
    const twoLines = {
      ...coordonnees,
      agency: { ...coordonnees.agency, addressLines: ['Cité SIC', 'Akwa'] },
    };
    expect(settingTranslationView('coordonnees', twoLines, legacyEnglish)?.translationStatus.en).toEqual({
      state: 'MISSING',
      missingFields: ['agency.addressLines.1'],
      outdatedFields: [],
    });
    expect(settingTranslationView('emails', {}, null)).toBeNull();
    expect(settingTranslationView('whatsapp', { message: 'Bonjour' }, null)?.translations.en).toBeNull();
  });

  it('enregistrement : empreintes par chemin, champ périmé quand le français change, puis revu', () => {
    const french = { message: 'Bonjour' };
    const saved = nextSettingTranslations({
      key: 'whatsapp',
      previousFrench: french,
      french,
      stored: null,
      input: { en: { message: 'Hello', number: '+33100000000' } },
    });
    expect(saved).toEqual({ en: { message: 'Hello', sourceHashes: { message: fieldHash('Bonjour') } } });

    // Français modifié, anglais inchangé (non renvoyé) : l'empreinte gardée signale le champ à revoir.
    const changed = { message: 'Bonjour à tous' };
    const kept = nextSettingTranslations({
      key: 'whatsapp',
      previousFrench: french,
      french: changed,
      stored: saved,
      input: undefined,
    });
    expect(settingTranslationView('whatsapp', changed, kept)?.translationStatus.en).toEqual({
      state: 'OUTDATED',
      missingFields: [],
      outdatedFields: ['message'],
    });

    // Marqué revu : empreinte du français actuel, à jour.
    const reviewed = nextSettingTranslations({
      key: 'whatsapp',
      previousFrench: changed,
      french: changed,
      stored: kept,
      input: { en: { message: 'Hello' }, reviewedFields: ['message'] },
    });
    expect(settingTranslationView('whatsapp', changed, reviewed)?.translationStatus.en.state).toBe(
      'UP_TO_DATE',
    );
    expect(
      nextSettingTranslations({
        key: 'whatsapp',
        previousFrench: changed,
        french: changed,
        stored: kept,
        input: { en: null },
      }),
    ).toBeNull();
    expect(
      nextSettingTranslations({
        key: 'emails',
        previousFrench: {},
        french: {},
        stored: null,
        input: undefined,
      }),
    ).toBeUndefined();
  });

  it('traduction antérieure au suivi : empreinte du français précédent à l’enregistrement suivant', () => {
    const changed = { ...coordonnees, hoursLabel: 'Lun – Ven · 8h – 18h' };
    const stamped = nextSettingTranslations({
      key: 'coordonnees',
      previousFrench: coordonnees,
      french: changed,
      stored: legacyEnglish,
      input: undefined,
    });
    expect(
      settingTranslationView('coordonnees', changed, stamped)?.translationStatus.en.outdatedFields,
    ).toEqual(['hoursLabel']);
    // Les valeurs non textuelles de l'ancienne traduction ne sont pas gardées.
    expect((stamped?.['en'] as Record<string, Record<string, unknown>>)['agency']).not.toHaveProperty(
      'phone',
    );
  });

  it('refuse un champ revu sans traduction', () => {
    expect(
      reviewedFieldErrors('whatsapp', { message: 'Bonjour' }, { en: null, reviewedFields: ['message'] }),
    ).toEqual([expect.objectContaining({ path: 'translations.reviewedFields.0', code: 'unknown_field' })]);
    expect(
      reviewedFieldErrors(
        'whatsapp',
        { message: 'Bonjour' },
        { en: { message: 'Hello' }, reviewedFields: ['message'] },
      ),
    ).toEqual([]);
  });
});
