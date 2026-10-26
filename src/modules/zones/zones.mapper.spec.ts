import { beforeAll, describe, expect, it } from 'vitest';
import { CONTRACT_WARM_UP_TIMEOUT, expectToMatchSchema, prepareContract } from '../../../test/contract.js';
import { FIXTURES } from '../../../test/fixtures/public-content.js';
import {
  serviceAreasMap,
  toServiceAreas,
  toZone,
  toZoneArea,
  type PublicZoneRecord,
} from './zones.mapper.js';

const [zone1, special] = FIXTURES.zones as unknown as PublicZoneRecord[];

describe('toZoneArea', () => {
  it('garde un contour GeoJSON valide et écarte les autres', () => {
    expect(toZoneArea(zone1.area)).toEqual(zone1.area);
    expect(toZoneArea({ type: 'Polygon', coordinates: [[[9.64, 4.1]]] })).toBeNull();
    expect(toZoneArea({ type: 'Point', coordinates: [9.7, 4.05] })).toBeNull();
    expect(toZoneArea(null)).toBeNull();
  });
});

describe('zones publiques', () => {
  beforeAll(() => prepareContract('ServiceAreas'), CONTRACT_WARM_UP_TIMEOUT);

  it('traduit les colonnes …En avec repli sur le français', () => {
    const zone = toZone(zone1, 'en');

    expect(zone).toMatchObject({ name: 'Zone 1 — Nearby', description: 'Around our Cité SIC base.' });
    expect(zone.result).toBe(
      'Intervention à domicile et livraison dans les meilleurs délais. Conditions confirmées sur devis.',
    );
    expect(zone.quarters[0]).toEqual({
      name: 'Cité SIC',
      detail: null,
      mapLabel: 'Cité SIC · starting base',
      isBase: true,
      labelOnSmallMap: true,
      coordinates: { lat: 4.0565, lng: 9.732 },
      position: { x: 0.5789, y: 0.5889 },
    });
  });

  it("n'expose ni délai ni tarif indicatif", () => {
    const zone = toZone(zone1, 'fr');

    expect(zone).not.toHaveProperty('fee');
    expect(zone).not.toHaveProperty('delay');
    expect(JSON.stringify(zone)).not.toContain('1500');
  });

  it('calcule le cadrage de la carte à partir des contours et des quartiers placés', () => {
    const zones = [toZone(zone1, 'fr'), toZone(special, 'fr')];

    expect(serviceAreasMap(zones)).toEqual({
      center: { lat: 4.054, lng: 9.716 },
      zoom: 12,
      bounds: [
        { lat: 4.018, lng: 9.662 },
        { lat: 4.09, lng: 9.77 },
      ],
    });
    expect(serviceAreasMap([])).toBeNull();
  });

  it('assemble ServiceAreas conforme au contrat', () => {
    const areas = toServiceAreas([zone1, special], { note: 'Note' }, null, 'fr');

    expect(areas.note).toBe('Note');
    expect(areas.updatedAt).toBe('2026-10-20T08:00:00.000Z');
    expectToMatchSchema('ServiceAreas', areas);
  });
});
