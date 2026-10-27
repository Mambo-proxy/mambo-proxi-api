import { describe, expect, it } from 'vitest';
import { previewUrl } from '../../common/preview/preview-token.js';
import {
  parseIfMatch,
  serviceCompleteness,
  serviceVersion,
  type AdminServiceRecord,
} from './admin-catalog.mapper.js';
import { defaultSeoDescription, defaultSeoTitle } from './admin-services.service.js';

function record(fields: Partial<AdminServiceRecord>): AdminServiceRecord {
  return {
    name: 'Chef privé',
    categoryId: 'cat_exp',
    tagline: 'Un chef chez vous',
    summary: 'Un chef cuisine chez vous.',
    audiences: ['Particuliers'],
    steps: [{ title: 'Demande', text: '' }],
    advantages: [{ title: 'Sur mesure', text: '' }],
    faq: [{ question: 'Combien ?', answer: 'De 2 à 20.' }],
    related: [{ relatedServiceId: 'svc_2' }],
    coverImage: { width: 1600, status: 'READY' },
    ...fields,
  } as AdminServiceRecord;
}

describe('complétude d’un service', () => {
  it('compte les 7 critères (100 % pour une fiche complète)', () => {
    expect(serviceCompleteness(record({})).percent).toBe(100);
  });

  it('exige une photo principale d’au moins 1 600 px et des éléments remplis', () => {
    const result = serviceCompleteness(
      record({
        coverImage: { width: 1200, status: 'READY' } as AdminServiceRecord['coverImage'],
        faq: [{ question: 'Sans réponse', answer: ' ' }],
        audiences: ['  '],
        summary: '',
      }),
    );
    expect(result.criteria.filter((criterion) => !criterion.done).map((criterion) => criterion.key)).toEqual([
      'general',
      'audiences',
      'faq',
      'coverImage',
    ]);
    expect(result.percent).toBe(43);
  });
});

describe('version et If-Match', () => {
  it('lit les formes usuelles de l’en-tête', () => {
    expect(serviceVersion(3)).toBe('v3');
    expect(parseIfMatch('v3')).toBe('v3');
    expect(parseIfMatch('"v3"')).toBe('v3');
    expect(parseIfMatch('W/"v3"')).toBe('v3');
    expect(parseIfMatch('*')).toBeUndefined();
    expect(parseIfMatch(undefined)).toBeUndefined();
  });
});

describe('SEO pré-rempli et adresse d’aperçu', () => {
  it('propose un titre et une description Google dans les limites', () => {
    expect(defaultSeoTitle('Chef privé')).toBe('Chef privé | MAMBO Proxi');
    expect(defaultSeoTitle('x'.repeat(58))).toBe('x'.repeat(58));
    expect(defaultSeoDescription('', 'Accroche')).toBe('Accroche');
    expect(defaultSeoDescription('d'.repeat(200), 'Accroche')).toHaveLength(160);
  });

  it('place le jeton avant l’ancre', () => {
    expect(previewUrl('https://mamboproxi.com', '/services/domicile#formules', 'a.b')).toBe(
      'https://mamboproxi.com/services/domicile?preview=a.b#formules',
    );
  });
});
