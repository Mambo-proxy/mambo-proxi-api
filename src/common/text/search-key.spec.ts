import { describe, expect, it } from 'vitest';
import { doualaDate, doualaDay } from '../time/agency-day.js';
import { optionalSearchKey, searchKey } from './search-key.js';

describe('searchKey', () => {
  it('retire accents et casse, réduit les espaces et ignore les valeurs vides', () => {
    expect(searchKey('Makèpè,  Douala')).toBe('makepe, douala');
    expect(searchKey('Deïdo')).toBe('deido');
    expect(searchKey('Hervé', null, undefined, '  ', 'TCHOUMI')).toBe('herve tchoumi');
    expect(searchKey('MP-2026-0142', 'Chef privé')).toBe('mp-2026-0142 chef prive');
  });

  it('renvoie `null` pour une valeur facultative vide', () => {
    expect(optionalSearchKey('  ')).toBeNull();
    expect(optionalSearchKey(null)).toBeNull();
    expect(optionalSearchKey('Bépanda')).toBe('bepanda');
  });
});

describe('doualaDay', () => {
  it('borne la journée de Douala (UTC+1)', () => {
    expect(doualaDay(new Date('2026-10-27T09:30:00.000Z'))).toEqual({
      start: new Date('2026-10-26T23:00:00.000Z'),
      end: new Date('2026-10-27T23:00:00.000Z'),
    });
    // 23 h 30 UTC : déjà le lendemain à Douala.
    expect(doualaDay(new Date('2026-10-27T23:30:00.000Z')).start).toEqual(
      new Date('2026-10-27T23:00:00.000Z'),
    );
  });

  it('donne la date de Douala', () => {
    expect(doualaDate(new Date('2026-12-31T23:30:00.000Z'))).toBe('2027-01-01');
    expect(doualaDate(new Date('2026-10-27T09:30:00.000Z'))).toBe('2026-10-27');
  });
});
