import type { Lang } from '../../common/i18n/lang.js';
import { isPlainObject, pickLocalized } from '../../common/i18n/translations.js';
import { readNullableString, type JsonObject } from '../../common/json/json-read.js';
import type { Prisma, ZoneTone } from '../../generated/prisma/client.js';

/**
 * Zones publiques : seules les zones actives sont lues. Le schéma public `Zone` ne comporte ni délai ni tarif
 * indicatif (`ZoneFee` n'existe que dans le back-office) : ces colonnes ne sont jamais lues ici.
 */
export const publicZoneSelect = {
  key: true,
  name: true,
  nameEn: true,
  tone: true,
  description: true,
  descriptionEn: true,
  result: true,
  resultEn: true,
  area: true,
  updatedAt: true,
  quarters: {
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select: {
      name: true,
      detail: true,
      detailEn: true,
      mapLabel: true,
      mapLabelEn: true,
      isBase: true,
      labelOnSmallMap: true,
      lat: true,
      lng: true,
      mapX: true,
      mapY: true,
    },
  },
} satisfies Prisma.ZoneSelect;

export type PublicZoneRecord = Prisma.ZoneGetPayload<{ select: typeof publicZoneSelect }>;

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface ZoneQuarter {
  name: string;
  detail: string | null;
  mapLabel: string | null;
  isBase: boolean;
  labelOnSmallMap: boolean;
  coordinates: GeoPoint | null;
  position: { x: number; y: number } | null;
}

export type ZoneArea =
  { type: 'Polygon'; coordinates: number[][][] } | { type: 'MultiPolygon'; coordinates: number[][][][] };

export interface Zone {
  key: string;
  name: string;
  tone: ZoneTone;
  description: string;
  result: string;
  quarters: ZoneQuarter[];
  area: ZoneArea | null;
}

export interface ServiceAreasMap {
  center: GeoPoint;
  zoom: number;
  bounds: [GeoPoint, GeoPoint];
}

/** Schéma `ServiceAreas` du contrat. */
export interface ServiceAreas {
  zones: Zone[];
  map: ServiceAreasMap | null;
  note: string | null;
  updatedAt?: string;
}

/** Zoom initial de la carte (ville entière), comme le cadrage calculé par le site. */
const MAP_ZOOM = 12;

function isPosition(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every((coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate))
  );
}

function isLinearRing(value: unknown): value is number[][] {
  return Array.isArray(value) && value.length >= 4 && value.length <= 500 && value.every(isPosition);
}

function isPolygon(value: unknown): value is number[][][] {
  return Array.isArray(value) && value.length >= 1 && value.length <= 10 && value.every(isLinearRing);
}

/** Contour GeoJSON `Polygon` ou `MultiPolygon` valide ; `null` sinon (seuls les quartiers sont placés). */
export function toZoneArea(value: unknown): ZoneArea | null {
  if (!isPlainObject(value)) return null;
  const coordinates = value['coordinates'];
  if (value['type'] === 'Polygon' && isPolygon(coordinates)) return { type: 'Polygon', coordinates };
  if (
    value['type'] === 'MultiPolygon' &&
    Array.isArray(coordinates) &&
    coordinates.length >= 1 &&
    coordinates.length <= 20 &&
    coordinates.every(isPolygon)
  ) {
    return { type: 'MultiPolygon', coordinates };
  }
  return null;
}

function inRange(value: number | null, min: number, max: number): value is number {
  return value !== null && Number.isFinite(value) && value >= min && value <= max;
}

function toQuarter(quarter: PublicZoneRecord['quarters'][number], lang: Lang): ZoneQuarter {
  return {
    name: quarter.name,
    detail: pickLocalized(quarter.detail, quarter.detailEn, lang),
    mapLabel: pickLocalized(quarter.mapLabel, quarter.mapLabelEn, lang),
    isBase: quarter.isBase,
    labelOnSmallMap: quarter.labelOnSmallMap,
    coordinates:
      inRange(quarter.lat, -90, 90) && inRange(quarter.lng, -180, 180)
        ? { lat: quarter.lat, lng: quarter.lng }
        : null,
    position:
      inRange(quarter.mapX, 0, 1) && inRange(quarter.mapY, 0, 1)
        ? { x: quarter.mapX, y: quarter.mapY }
        : null,
  };
}

export function toZone(zone: PublicZoneRecord, lang: Lang): Zone {
  return {
    key: zone.key,
    name: pickLocalized(zone.name, zone.nameEn, lang),
    tone: zone.tone,
    description: pickLocalized(zone.description, zone.descriptionEn, lang),
    result: pickLocalized(zone.result, zone.resultEn, lang),
    quarters: zone.quarters.map((quarter) => toQuarter(quarter, lang)),
    area: toZoneArea(zone.area),
  };
}

/** 6 décimales au plus (≈ 0,1 m), comme le contrat. */
function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/** Points géolocalisés : sommets des contours (GeoJSON `[longitude, latitude]`) et quartiers placés. */
function zonePoints(zone: Zone): GeoPoint[] {
  const polygons =
    zone.area === null ? [] : zone.area.type === 'Polygon' ? [zone.area.coordinates] : zone.area.coordinates;
  const vertices = polygons.flat(2).map(([lng, lat]) => ({ lat: Number(lat), lng: Number(lng) }));
  const quarters = zone.quarters.flatMap((quarter) =>
    quarter.coordinates === null ? [] : [quarter.coordinates],
  );
  return [...vertices, ...quarters].filter(
    (point) => Number.isFinite(point.lat) && Number.isFinite(point.lng),
  );
}

/**
 * Cadrage initial de la carte : emprise `[sud-ouest, nord-est]` des contours et des quartiers placés, centre de
 * cette emprise, zoom 12 ; `null` si aucune zone n'est géolocalisée.
 */
export function serviceAreasMap(zones: readonly Zone[]): ServiceAreasMap | null {
  const points = zones.flatMap(zonePoints);
  if (points.length === 0) return null;
  const lats = points.map((point) => point.lat);
  const lngs = points.map((point) => point.lng);
  const southWest = { lat: Math.min(...lats), lng: Math.min(...lngs) };
  const northEast = { lat: Math.max(...lats), lng: Math.max(...lngs) };
  return {
    center: {
      lat: round((southWest.lat + northEast.lat) / 2),
      lng: round((southWest.lng + northEast.lng) / 2),
    },
    zoom: MAP_ZOOM,
    bounds: [
      { lat: round(southWest.lat), lng: round(southWest.lng) },
      { lat: round(northEast.lat), lng: round(northEast.lng) },
    ],
  };
}

/** `ServiceAreas` : zones actives (déjà triées), note du paramètre `zones` (traduit), date de mise à jour. */
export function toServiceAreas(
  records: readonly PublicZoneRecord[],
  setting: JsonObject,
  settingUpdatedAt: Date | null,
  lang: Lang,
): ServiceAreas {
  const zones = records.map((zone) => toZone(zone, lang));
  const dates = [
    ...records.map((zone) => zone.updatedAt),
    ...(settingUpdatedAt === null ? [] : [settingUpdatedAt]),
  ];
  const updatedAt = dates.length === 0 ? null : new Date(Math.max(...dates.map((date) => date.getTime())));
  return {
    zones,
    map: serviceAreasMap(zones),
    note: readNullableString(setting, 'note'),
    ...(updatedAt === null ? {} : { updatedAt: updatedAt.toISOString() }),
  };
}
