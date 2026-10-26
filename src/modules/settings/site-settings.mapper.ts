import {
  asObject,
  asObjectArray,
  readBoolean,
  readNullableNumber,
  readNullableString,
  readString,
  readStringArray,
  type JsonObject,
} from '../../common/json/json-read.js';
import { SETTING_KEYS, type SettingKey } from './settings.constants.js';

/** Valeurs des groupes de paramètres, déjà traduites dans la langue demandée. */
export type SettingValues = Partial<Record<SettingKey, JsonObject>>;

/** Schéma `SiteSettings` du contrat. */
export interface SiteSettings {
  siteName: string;
  tagline?: string;
  signature?: string;
  contact: {
    phoneFrance?: string;
    phoneFranceDisplay?: string;
    phoneCameroon: string;
    phoneCameroonDisplay: string;
    email: string;
    hoursLabel: string;
  };
  whatsapp: { enabled: boolean; number: string; numberDisplay: string; message: string };
  social: { network: string; url: string }[];
  agency: {
    name: string;
    addressLines: string[];
    city: string;
    country: string;
    phone: string | null;
    phoneDisplay: string | null;
    latitude: number | null;
    longitude: number | null;
    mapsUrl: string | null;
    openingHours: { label: string; hours: string }[];
    parcelReceptionNote: string | null;
  };
  keyFigures: JsonObject[];
  turnstileSiteKey: string;
  analytics: { ga4MeasurementId: string | null; searchConsoleVerification: string | null };
  seo: { defaultTitle: string; defaultDescription: string; ogImageUrl: string | null };
  features: { maintenanceMode: boolean; newsletterTracking: boolean };
  updatedAt?: string;
}

const E164 = /^\+[1-9]\d{6,14}$/;
const GA4_ID = /^G-[A-Z0-9]+$/;
const COUNTRY_CODE = /^[A-Z]{2}$/;
const SOCIAL_NETWORKS: ReadonlySet<string> = new Set([
  'instagram',
  'facebook',
  'linkedin',
  'tiktok',
  'youtube',
  'x',
]);

/**
 * Repli des champs obligatoires du contrat tant qu'un groupe n'est pas renseigné : coordonnées provisoires des
 * maquettes (exemple `SiteSettings` du contrat), à remplacer dans le back-office.
 */
const FALLBACK = {
  siteName: 'MAMBO Proxi',
  phone: '+237600000000',
  email: 'contact@mamboproxi.com',
  hoursLabel: 'Lun – Sam · 8h – 20h',
  whatsappMessage: 'Bonjour Mambo Proxi, je souhaite des informations sur…',
  agencyName: 'Agence MAMBO Proxi',
  city: 'Douala',
  country: 'CM',
  defaultTitle: 'MAMBO Proxi',
  defaultDescription: 'Services du quotidien à domicile à Douala.',
} as const;

/** Clé publique d'essai de Cloudflare Turnstile (valide toujours), utilisée hors production tant qu'aucune n'est saisie. */
export const TURNSTILE_TEST_SITE_KEY = '1x00000000000000000000AA';

/** Numéro E.164 tel qu'affiché (`+237600000000` → `+237 6 00 00 00 00`). */
export function formatPhoneNumber(phone: string): string {
  const match = /^\+(237|33)(\d)(\d{8})$/.exec(phone);
  if (!match) return phone;
  const [, countryCode, first, rest] = match as unknown as [string, string, string, string];
  return `+${countryCode} ${first} ${rest.replace(/(\d{2})(?=\d)/g, '$1 ')}`;
}

function readPhone(source: JsonObject, key: string): string | null {
  const value = readNullableString(source, key);
  return value !== null && E164.test(value) ? value : null;
}

function isAbsoluteUrl(value: unknown): value is string {
  return typeof value === 'string' && /^https?:\/\/[^\s]+$/.test(value);
}

function toAgency(source: JsonObject): SiteSettings['agency'] {
  const phone = readPhone(source, 'phone');
  const latitude = readNullableNumber(source, 'latitude');
  const longitude = readNullableNumber(source, 'longitude');
  const country = readString(source, 'country', FALLBACK.country);
  const mapsUrl = source['mapsUrl'];
  return {
    name: readString(source, 'name', FALLBACK.agencyName),
    addressLines: readStringArray(source, 'addressLines'),
    city: readString(source, 'city', FALLBACK.city),
    country: COUNTRY_CODE.test(country) ? country : FALLBACK.country,
    phone,
    phoneDisplay:
      phone === null ? null : (readNullableString(source, 'phoneDisplay') ?? formatPhoneNumber(phone)),
    latitude: latitude !== null && latitude >= -90 && latitude <= 90 ? latitude : null,
    longitude: longitude !== null && longitude >= -180 && longitude <= 180 ? longitude : null,
    mapsUrl: isAbsoluteUrl(mapsUrl) ? mapsUrl : null,
    openingHours: asObjectArray(source['openingHours']).flatMap((item) => {
      const label = readNullableString(item, 'label');
      const hours = readNullableString(item, 'hours');
      return label !== null && hours !== null ? [{ label, hours }] : [];
    }),
    parcelReceptionNote: readNullableString(source, 'parcelReceptionNote'),
  };
}

function toKeyFigures(source: JsonObject): JsonObject[] {
  return asObjectArray(source['keyFigures']).filter(
    (figure) => typeof figure['key'] === 'string' && typeof figure['label'] === 'string',
  );
}

export interface SiteSettingsContext {
  /** Adresse absolue de l'image de partage (`seo.ogImageId`), si elle existe. */
  ogImageUrl: string | null;
  turnstileSiteKey: string;
  updatedAt: Date | null;
}

/** `SiteSettings` à partir des groupes de paramètres (déjà traduits). */
export function toSiteSettings(values: SettingValues, context: SiteSettingsContext): SiteSettings {
  const site = asObject(values[SETTING_KEYS.site]);
  const coordinates = asObject(values[SETTING_KEYS.coordonnees]);
  const whatsapp = asObject(values[SETTING_KEYS.whatsapp]);
  const networks = asObject(values[SETTING_KEYS.reseaux]);
  const seo = asObject(values[SETTING_KEYS.seo]);
  const analytics = asObject(values[SETTING_KEYS.analytics]);
  const figures = asObject(values[SETTING_KEYS.chiffres]);
  const security = asObject(values[SETTING_KEYS.securite]);

  const phoneCameroon = readPhone(coordinates, 'phoneCameroon') ?? FALLBACK.phone;
  const phoneFrance = readPhone(coordinates, 'phoneFrance');
  const whatsappNumber = readPhone(whatsapp, 'number') ?? phoneCameroon;
  const ga4MeasurementId = readNullableString(analytics, 'ga4MeasurementId');
  const tagline = readNullableString(site, 'tagline');
  const signature = readNullableString(site, 'signature');
  const ogImageUrl = isAbsoluteUrl(seo['ogImageUrl']) ? seo['ogImageUrl'] : context.ogImageUrl;

  return {
    siteName: readString(site, 'siteName', FALLBACK.siteName),
    ...(tagline === null ? {} : { tagline }),
    ...(signature === null ? {} : { signature }),
    contact: {
      ...(phoneFrance === null
        ? {}
        : {
            phoneFrance,
            phoneFranceDisplay:
              readNullableString(coordinates, 'phoneFranceDisplay') ?? formatPhoneNumber(phoneFrance),
          }),
      phoneCameroon,
      phoneCameroonDisplay:
        readNullableString(coordinates, 'phoneCameroonDisplay') ?? formatPhoneNumber(phoneCameroon),
      email: readString(coordinates, 'email', FALLBACK.email),
      hoursLabel: readString(coordinates, 'hoursLabel', FALLBACK.hoursLabel),
    },
    whatsapp: {
      enabled: readBoolean(whatsapp, 'enabled', true),
      number: whatsappNumber,
      numberDisplay: readNullableString(whatsapp, 'numberDisplay') ?? formatPhoneNumber(whatsappNumber),
      message: readString(whatsapp, 'message', FALLBACK.whatsappMessage),
    },
    social: asObjectArray(networks['social']).flatMap((item) => {
      const network = item['network'];
      const url = item['url'];
      return typeof network === 'string' && SOCIAL_NETWORKS.has(network) && isAbsoluteUrl(url)
        ? [{ network, url }]
        : [];
    }),
    agency: toAgency(asObject(coordinates['agency'])),
    keyFigures: toKeyFigures(figures),
    turnstileSiteKey: readString(site, 'turnstileSiteKey', context.turnstileSiteKey),
    analytics: {
      ga4MeasurementId: ga4MeasurementId !== null && GA4_ID.test(ga4MeasurementId) ? ga4MeasurementId : null,
      searchConsoleVerification:
        readNullableString(seo, 'searchConsoleVerification') ??
        readNullableString(analytics, 'searchConsoleVerification'),
    },
    seo: {
      defaultTitle: readString(seo, 'defaultTitle', FALLBACK.defaultTitle),
      defaultDescription: readString(seo, 'defaultDescription', FALLBACK.defaultDescription),
      ogImageUrl,
    },
    features: {
      maintenanceMode: readBoolean(security, 'maintenanceMode', false),
      newsletterTracking: readBoolean(analytics, 'newsletterTracking', false),
    },
    ...(context.updatedAt === null ? {} : { updatedAt: context.updatedAt.toISOString() }),
  };
}
