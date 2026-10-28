import { z } from 'zod';
import { searchKey } from '../../common/text/search-key.js';
import { nullableText } from '../../common/validation/content.schemas.js';
import { REVIEWED_FIELD_PATTERN } from './zone-translations.js';

/**
 * Corps des opérations « Admin — Zones » du contrat (`ZoneFields`, `ZoneQuarter`, `ZoneArea`, `ZoneFee`).
 * Coordonnées en WGS84, contrôlées dans l'emprise du Cameroun ; contour GeoJSON RFC 7946 (anneaux fermés de 4 à
 * 500 positions, 5 000 positions au plus par zone). Les messages reprennent ceux du back-office.
 */

/** Emprise du Cameroun (contrat : latitude 1,6 à 13,1 ; longitude 8,4 à 16,2). */
export const CAMEROON_BOUNDS = { minLat: 1.6, maxLat: 13.1, minLng: 8.4, maxLng: 16.2 } as const;
export const MAX_AREA_POSITIONS = 5000;

const OUTSIDE = 'Ce point est hors du Cameroun : vérifiez la latitude et la longitude.';

export function inCameroon(lat: number, lng: number): boolean {
  return (
    lat >= CAMEROON_BOUNDS.minLat &&
    lat <= CAMEROON_BOUNDS.maxLat &&
    lng >= CAMEROON_BOUNDS.minLng &&
    lng <= CAMEROON_BOUNDS.maxLng
  );
}

const degrees = z.number({ error: 'Saisissez une latitude et une longitude en degrés décimaux.' }).finite();

const geoPointSchema = z
  .object({ lat: degrees.min(-90).max(90), lng: degrees.min(-180).max(180) })
  .refine((point) => inCameroon(point.lat, point.lng), { error: OUTSIDE });

const quarterSchema = z.object({
  name: z
    .string({ error: 'Nommez chaque quartier.' })
    .trim()
    .min(1, { error: 'Nommez chaque quartier.' })
    .max(80),
  detail: nullableText(120).optional(),
  mapLabel: nullableText(80).optional(),
  isBase: z.boolean().optional(),
  labelOnSmallMap: z.boolean().optional(),
  coordinates: geoPointSchema.nullable().optional(),
  position: z
    .object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })
    .nullable()
    .optional(),
});
export type QuarterInput = z.output<typeof quarterSchema>;

const position = z
  .array(z.number().finite(), { error: 'Chaque point doit être [longitude, latitude].' })
  .length(2, { error: 'Chaque point doit être [longitude, latitude].' });

const ring = z
  .array(position)
  .min(4, { error: 'Chaque anneau doit compter de 4 à 500 points.' })
  .max(500, { error: 'Chaque anneau doit compter de 4 à 500 points.' });

const polygon = z.array(ring).min(1, { error: 'Chaque polygone doit avoir au moins un anneau.' }).max(10);

const areaSchema = z
  .discriminatedUnion(
    'type',
    [
      z.object({ type: z.literal('Polygon'), coordinates: polygon }),
      z.object({ type: z.literal('MultiPolygon'), coordinates: z.array(polygon).min(1).max(20) }),
    ],
    { error: 'Le contour doit être un polygone GeoJSON (Polygon ou MultiPolygon).' },
  )
  .superRefine((area, context) => {
    const polygons = area.type === 'Polygon' ? [area.coordinates] : area.coordinates;
    let count = 0;
    polygons.forEach((rings, polygonIndex) => {
      rings.forEach((points, ringIndex) => {
        const base =
          area.type === 'Polygon' ? ['coordinates', ringIndex] : ['coordinates', polygonIndex, ringIndex];
        count += points.length;
        const first = points[0];
        const last = points.at(-1);
        if (first === undefined || last === undefined || first[0] !== last[0] || first[1] !== last[1]) {
          context.addIssue({
            code: 'custom',
            path: base,
            message: 'Chaque anneau doit être fermé (dernier point = premier point).',
          });
        }
        points.forEach(([lng = Number.NaN, lat = Number.NaN], pointIndex) => {
          if (!inCameroon(lat, lng))
            context.addIssue({
              code: 'custom',
              path: [...base, pointIndex],
              message: `Le point ${String(pointIndex + 1)} du contour est hors du Cameroun.`,
            });
        });
      });
    });
    if (count > MAX_AREA_POSITIONS)
      context.addIssue({
        code: 'custom',
        path: ['coordinates'],
        message: 'Le contour dépasse 5 000 points : simplifiez-le avant de l’importer.',
      });
  });
export type AreaInput = z.output<typeof areaSchema>;

const zoneFieldsSchema = z.object({
  name: z
    .string({ error: 'Saisissez le nom de la zone.' })
    .trim()
    .min(1, { error: 'Saisissez le nom de la zone.' })
    .max(60),
  nameEn: nullableText(60),
  tone: z.enum(['zone1', 'zone2', 'zone3', 'special'], { error: 'Choisissez la couleur de la zone.' }),
  description: z.string().trim().max(160),
  descriptionEn: nullableText(160),
  result: z.string().trim().max(240),
  resultEn: nullableText(240),
  delay: nullableText(30),
  fee: z
    .object({
      amount: z
        .number({ error: 'Saisissez un montant en FCFA.' })
        .int({ error: 'Saisissez un montant en FCFA.' })
        .min(0, {
          error: 'Saisissez un montant en FCFA.',
        }),
      currency: z.literal('XAF').optional(),
      from: z.boolean(),
    })
    .nullable(),
  active: z.boolean(),
  quarters: z
    .array(quarterSchema)
    .max(80)
    .superRefine((quarters, context) => {
      const seen = new Set<string>();
      quarters.forEach((quarter, index) => {
        const key = searchKey(quarter.name);
        if (seen.has(key))
          context.addIssue({
            code: 'custom',
            path: [index, 'name'],
            message: 'Chaque quartier ne peut figurer qu’une fois.',
          });
        seen.add(key);
      });
    }),
  area: areaSchema.nullable(),
  /** Traductions relues, justes malgré un changement du français (`zone-translations`). */
  reviewedFields: z.array(z.string().regex(REVIEWED_FIELD_PATTERN, { error: 'Champ inconnu.' })).max(200),
});

export const zoneInputSchema = zoneFieldsSchema.partial().extend({
  name: zoneFieldsSchema.shape.name,
  tone: zoneFieldsSchema.shape.tone,
});
export type ZoneInput = z.output<typeof zoneInputSchema>;

export const zonePatchSchema = zoneFieldsSchema
  .partial()
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), {
    error: 'Aucune modification envoyée.',
  });
export type ZonePatch = z.output<typeof zonePatchSchema>;
