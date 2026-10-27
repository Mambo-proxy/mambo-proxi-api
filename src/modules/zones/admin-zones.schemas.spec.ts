import { describe, expect, it } from 'vitest';
import { zonePatchSchema } from './admin-zones.schemas.js';

const square = (points: number[][]) => ({ type: 'Polygon', coordinates: [points] });

describe('contour et quartiers d’une zone', () => {
  it('accepte un polygone fermé dans l’emprise du Cameroun', () => {
    const result = zonePatchSchema.safeParse({
      area: square([
        [9.7, 4.0],
        [9.8, 4.0],
        [9.8, 4.1],
        [9.7, 4.0],
      ]),
      quarters: [{ name: 'Akwa', coordinates: { lat: 4.05, lng: 9.7 } }],
    });
    expect(result.success).toBe(true);
  });

  it('refuse un anneau ouvert, un point hors du Cameroun et un quartier en double', () => {
    const result = zonePatchSchema.safeParse({
      area: square([
        [2.35, 48.85],
        [9.8, 4.0],
        [9.8, 4.1],
        [9.75, 4.05],
      ]),
      quarters: [{ name: 'Makèpè' }, { name: 'makepe' }],
    });
    expect(result.success).toBe(false);
    const messages = result.error?.issues.map((issue) => [issue.path.join('.'), issue.message]);
    expect(messages).toEqual(
      expect.arrayContaining([
        ['area.coordinates.0', 'Chaque anneau doit être fermé (dernier point = premier point).'],
        ['area.coordinates.0.0', 'Le point 1 du contour est hors du Cameroun.'],
        ['quarters.1.name', 'Chaque quartier ne peut figurer qu’une fois.'],
      ]),
    );
  });

  it('limite le contour à 5 000 positions', () => {
    const ring = Array.from({ length: 499 }, (_, index) => [9.7 + index / 10_000, 4.0]);
    ring.push([9.7, 4.0]);
    const result = zonePatchSchema.safeParse({
      area: { type: 'MultiPolygon', coordinates: Array.from({ length: 11 }, () => [ring]) },
    });
    expect(result.error?.issues.map((issue) => issue.message)).toContain(
      'Le contour dépasse 5 000 points : simplifiez-le avant de l’importer.',
    );
  });
});
