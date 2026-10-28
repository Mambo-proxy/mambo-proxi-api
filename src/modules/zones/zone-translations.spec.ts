import { describe, expect, it } from 'vitest';
import { fieldHash } from '../../common/i18n/text-translation.js';
import {
  nextZoneHashes,
  quarterHashKey,
  reviewedZoneFieldErrors,
  zoneTranslationStatus,
  type ZoneTexts,
} from './zone-translations.js';

const akwa = {
  normalizedName: 'akwa',
  detail: 'Centre-ville',
  detailEn: 'Downtown',
  mapLabel: null,
  mapLabelEn: null,
};
const zone: ZoneTexts = {
  name: 'Zone 1 — Proximité',
  nameEn: 'Zone 1 — Nearby',
  description: 'Autour de Cité SIC.',
  descriptionEn: 'Around Cité SIC.',
  result: 'Intervention rapide.',
  resultEn: null,
  translationHashes: null,
  quarters: [akwa],
};

describe('version anglaise des zones', () => {
  it('statut par champ, quartiers compris ; sans empreinte, une traduction est à jour', () => {
    expect(zoneTranslationStatus(zone)).toEqual({
      state: 'MISSING',
      missingFields: ['result'],
      outdatedFields: [],
    });
    expect(zoneTranslationStatus({ ...zone, resultEn: 'Fast service.' }).state).toBe('UP_TO_DATE');
  });

  it('signale une traduction périmée quand le français change, puis la remet à jour une fois revue', () => {
    const translated = { ...zone, resultEn: 'Fast service.' };
    const hashes = nextZoneHashes({
      before: null,
      after: translated,
      previousQuarters: new Map(),
      reviewed: [],
    });
    expect(hashes['name']).toBe(fieldHash(zone.name));
    // Quartier créé avec sa traduction (aucun état précédent) : empreinte du français actuel.
    expect(hashes[quarterHashKey('akwa', 'detail')]).toBe(fieldHash('Centre-ville'));

    const saved = { ...translated, translationHashes: hashes };
    const changed = {
      ...saved,
      description: 'Autour de la base de Cité SIC.',
      quarters: [{ ...akwa, detail: 'Centre des affaires' }],
    };
    const next = nextZoneHashes({
      before: saved,
      after: changed,
      previousQuarters: new Map([['akwa', akwa]]),
      reviewed: [],
    });
    expect(zoneTranslationStatus({ ...changed, translationHashes: next })).toEqual({
      state: 'OUTDATED',
      missingFields: [],
      outdatedFields: ['description', 'quarters.0.detail'],
    });

    const reviewed = nextZoneHashes({
      before: { ...changed, translationHashes: next },
      after: { ...changed, translationHashes: next },
      previousQuarters: new Map([['akwa', changed.quarters[0]]]),
      reviewed: ['description', 'quarters.0.detail'],
    });
    expect(zoneTranslationStatus({ ...changed, translationHashes: reviewed }).state).toBe('UP_TO_DATE');
  });

  it('modifier le texte anglais le remet à jour ; une traduction antérieure prend l’empreinte du français d’avant', () => {
    const legacy = { ...zone, resultEn: 'Fast service.' };
    const changed = { ...legacy, name: 'Zone 1', nameEn: 'Zone 1' };
    const stamped = nextZoneHashes({
      before: legacy,
      after: changed,
      previousQuarters: new Map(),
      reviewed: [],
    });
    expect(stamped['name']).toBe(fieldHash('Zone 1'));

    const frenchOnly = { ...legacy, description: 'Nouveau texte.' };
    const kept = nextZoneHashes({
      before: legacy,
      after: frenchOnly,
      previousQuarters: new Map(),
      reviewed: [],
    });
    expect(kept['description']).toBe(fieldHash(zone.description));
  });

  it('refuse un champ revu sans traduction', () => {
    expect(reviewedZoneFieldErrors(zone, ['name', 'quarters.0.detail'])).toEqual([]);
    expect(reviewedZoneFieldErrors(zone, ['result', 'quarters.0.mapLabel', 'quarters.4.detail'])).toEqual([
      expect.objectContaining({ path: 'reviewedFields.0', code: 'unknown_field' }),
      expect.objectContaining({ path: 'reviewedFields.1' }),
      expect.objectContaining({ path: 'reviewedFields.2' }),
    ]);
  });
});
