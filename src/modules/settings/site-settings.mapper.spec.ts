import { beforeAll, describe, expect, it } from 'vitest';
import { CONTRACT_WARM_UP_TIMEOUT, expectToMatchSchema, prepareContract } from '../../../test/contract.js';
import { FIXTURES } from '../../../test/fixtures/public-content.js';
import { localize } from '../../common/i18n/translations.js';
import { asObject } from '../../common/json/json-read.js';
import type { Lang } from '../../common/i18n/lang.js';
import {
  formatPhoneNumber,
  toSiteSettings,
  TURNSTILE_TEST_SITE_KEY,
  type SettingValues,
} from './site-settings.mapper.js';

function valuesFor(lang: Lang): SettingValues {
  return Object.fromEntries(
    FIXTURES.settings.map((row) => [row['key'], asObject(localize(row['value'], row['translations'], lang))]),
  ) as SettingValues;
}

const context = {
  ogImageUrl: null,
  turnstileSiteKey: TURNSTILE_TEST_SITE_KEY,
  updatedAt: new Date('2026-10-05T08:00:00.000Z'),
};

describe('formatPhoneNumber', () => {
  it('affiche les numéros camerounais et français par groupes', () => {
    expect(formatPhoneNumber('+237600000000')).toBe('+237 6 00 00 00 00');
    expect(formatPhoneNumber('+33612345678')).toBe('+33 6 12 34 56 78');
    expect(formatPhoneNumber('+4915112345678')).toBe('+4915112345678');
  });
});

describe('toSiteSettings', () => {
  beforeAll(() => prepareContract('SiteSettings'), CONTRACT_WARM_UP_TIMEOUT);

  it('assemble les groupes de paramètres en français', () => {
    const settings = toSiteSettings(valuesFor('fr'), context);

    expect(settings).toMatchObject({
      siteName: 'MAMBO Proxi',
      tagline: 'Vos services, au plus près de vous',
      contact: { phoneCameroon: '+237600000000', phoneCameroonDisplay: '+237 6 00 00 00 00' },
      whatsapp: { enabled: true, numberDisplay: '+237 6 00 00 00 00' },
      agency: { name: 'Agence MAMBO Proxi', phoneDisplay: '+237 6 00 00 00 00', country: 'CM' },
      features: { maintenanceMode: false, newsletterTracking: false },
      analytics: { ga4MeasurementId: null, searchConsoleVerification: null },
      updatedAt: '2026-10-05T08:00:00.000Z',
    });
    expect(settings.contact).not.toHaveProperty('phoneFrance');
    expectToMatchSchema('SiteSettings', settings);
  });

  it('traduit champ par champ et garde le français des champs non traduits', () => {
    const settings = toSiteSettings(valuesFor('en'), context);

    expect(settings.tagline).toBe('Your services, close at hand');
    expect(settings.signature).toBe(
      "Mambo, ce n'est pas qu'un service. C'est une expérience pensée pour vous.",
    );
    expect(settings.agency.name).toBe('MAMBO Proxi agency');
    expect(settings.agency.openingHours).toEqual([{ label: 'Monday – Friday', hours: '8am – 6pm' }]);
    expect(settings.keyFigures[1]).toMatchObject({ label: 'and surroundings', labelMobile: 'et environs' });
    expectToMatchSchema('SiteSettings', settings);
  });

  it('reste conforme au contrat sans aucun paramètre enregistré', () => {
    const settings = toSiteSettings({}, { ...context, updatedAt: null });

    expect(settings.turnstileSiteKey).toBe(TURNSTILE_TEST_SITE_KEY);
    expect(settings).not.toHaveProperty('updatedAt');
    expectToMatchSchema('SiteSettings', settings);
  });
});
