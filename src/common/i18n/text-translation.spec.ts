import { describe, expect, it } from 'vitest';
import {
  applyTexts,
  fieldHash,
  isTextPath,
  nextReferenceHash,
  pickTexts,
  textEntries,
  textHash,
  unitsStatus,
  type TextRules,
} from './text-translation.js';

const agency = {
  name: 'Agence MAMBO Proxi',
  addressLines: ['Rue 1', 'Akwa'],
  city: 'Douala',
  phone: '+237600000000',
  latitude: 4.05,
  openingHours: [
    { label: 'Lundi', hours: '8 h – 18 h' },
    { label: 'Samedi', hours: '9 h – 13 h' },
  ],
};
const whitelist: TextRules = {
  paths: [
    'agency.name',
    'agency.addressLines.*',
    'agency.openingHours.*.label',
    'agency.openingHours.*.hours',
  ],
};

describe('socle des traductions anglaises', () => {
  it('reconnaît les chemins de la liste blanche (`*` = n’importe quel rang)', () => {
    expect(isTextPath('agency.addressLines.1', whitelist)).toBe(true);
    expect(isTextPath('agency.openingHours.0.label', whitelist)).toBe(true);
    expect(isTextPath('agency.phone', whitelist)).toBe(false);
    expect(isTextPath('agency.addressLines', whitelist)).toBe(false);
    expect(isTextPath('n’importe.quoi', {})).toBe(true);
  });

  it('ne prend de l’anglais que les textes de la liste blanche, alignés par rang', () => {
    const english = {
      name: 'MAMBO Proxi agency',
      addressLines: ['Street 1', '', 'En trop'],
      city: 'Ville anglaise',
      phone: '+33100000000',
      latitude: 0,
      openingHours: [{ label: 'Monday', hours: 8 }],
    };

    expect(applyTexts({ agency }, { agency: english }, whitelist)).toEqual({
      agency: {
        ...agency,
        name: 'MAMBO Proxi agency',
        addressLines: ['Street 1', 'Akwa'],
        openingHours: [
          { label: 'Monday', hours: '8 h – 18 h' },
          { label: 'Samedi', hours: '9 h – 13 h' },
        ],
      },
    });
  });

  it('garde le français des clés techniques (sans liste blanche)', () => {
    const rules: TextRules = { nonTextKeys: new Set(['href']) };
    expect(
      applyTexts({ label: 'Devis', href: '/devis' }, { label: 'Quote', href: '/en/quote' }, rules),
    ).toEqual({ label: 'Quote', href: '/devis' });
    expect(applyTexts('/devis', '/en/quote', rules, 'href')).toBe('/devis');
  });

  it('extrait les textes et calcule une empreinte stable', () => {
    expect(textEntries({ agency }, whitelist).map(([path]) => path)).toEqual([
      'agency.addressLines.0',
      'agency.addressLines.1',
      'agency.name',
      'agency.openingHours.0.hours',
      'agency.openingHours.0.label',
      'agency.openingHours.1.hours',
      'agency.openingHours.1.label',
    ]);
    const hash = textHash({ agency }, whitelist);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    // Valeurs non textuelles et ordre des clés sans effet ; un texte changé change l'empreinte.
    expect(textHash({ agency: { ...agency, phone: '+237699999999', latitude: 3 } }, whitelist)).toBe(hash);
    expect(textHash({ agency: Object.fromEntries(Object.entries(agency).reverse()) }, whitelist)).toBe(hash);
    expect(textHash({ agency: { ...agency, name: 'Agence' } }, whitelist)).not.toBe(hash);
    expect(textHash({ agency: { city: 'Douala' } }, whitelist)).toBeNull();
    expect(fieldHash('Bonjour')).toBe(fieldHash('Bonjour'));
    expect(fieldHash('')).toBeNull();
  });

  it('réduit une version anglaise aux textes traduits, de la forme du français', () => {
    expect(
      pickTexts(
        { agency },
        {
          agency: {
            phone: '+33100000000',
            addressLines: ['', 'Akwa district'],
            openingHours: [null, { label: 'Saturday', hours: '' }],
          },
        },
        whitelist,
      ),
    ).toEqual({
      agency: { addressLines: [null, 'Akwa district'], openingHours: [null, { label: 'Saturday' }] },
    });
    expect(pickTexts({ agency }, { agency: { city: 'Douala' } }, whitelist)).toBeNull();
  });

  it('calcule le statut par unité', () => {
    const units = [
      { id: 'a', hash: 'h1', translated: true, reference: 'h1' },
      { id: 'b', hash: 'h2', translated: true, reference: null },
      { id: 'c', hash: null, translated: false, reference: null },
    ];
    expect(unitsStatus(units)).toEqual({ state: 'UP_TO_DATE', missing: [], outdated: [] });
    expect(unitsStatus([...units, { id: 'd', hash: 'h3', translated: true, reference: 'ancienne' }])).toEqual(
      {
        state: 'OUTDATED',
        missing: [],
        outdated: ['d'],
      },
    );
    expect(unitsStatus([...units, { id: 'e', hash: 'h4', translated: false, reference: null }]).state).toBe(
      'MISSING',
    );
    expect(unitsStatus(units, false)).toEqual({ state: 'MISSING', missing: ['a', 'b'], outdated: [] });
  });

  it('choisit l’empreinte à mémoriser (nouveau, inchangé, revu, antérieur au suivi)', () => {
    const base = { current: 'actuel', stored: 'gardée', fallback: 'précédent' };
    expect(nextReferenceHash({ ...base, unchanged: false, reviewed: false })).toBe('actuel');
    expect(nextReferenceHash({ ...base, unchanged: true, reviewed: false })).toBe('gardée');
    expect(nextReferenceHash({ ...base, unchanged: true, reviewed: true })).toBe('actuel');
    expect(nextReferenceHash({ ...base, stored: undefined, unchanged: true, reviewed: false })).toBe(
      'précédent',
    );
    expect(
      nextReferenceHash({
        current: 'actuel',
        stored: undefined,
        fallback: null,
        unchanged: true,
        reviewed: false,
      }),
    ).toBe('actuel');
  });
});
