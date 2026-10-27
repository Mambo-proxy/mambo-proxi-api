/**
 * Clés de la table `settings` (une ligne par groupe, `value` de la forme du groupe, `translations` `{ en: {…} }`).
 *
 * Groupes du contrat (`SettingsGroup`, formes `Settings*`, sans la propriété `group`) et groupes internes :
 * - `site` : `{ siteName, tagline, signature, turnstileSiteKey }` ;
 * - `coordonnees` : `{ phoneFrance, phoneFranceDisplay?, phoneCameroon, phoneCameroonDisplay?, email, hoursLabel, agency }` ;
 * - `whatsapp` : `{ enabled, number, numberDisplay?, message }` ;
 * - `reseaux` : `{ social: [{ network, url }] }` ;
 * - `seo` : `{ defaultTitle, defaultDescription, ogImageId, searchConsoleVerification }` ;
 * - `analytics` : `{ ga4MeasurementId, ga4PropertyId, newsletterTracking }` ;
 * - `chiffres` : `{ keyFigures: KeyFigure[] }` ;
 * - `rgpd` : `{ inactiveContactsRetentionMonths, rejectedApplicationsRetentionMonths }` ;
 * - `securite` : `{ maintenanceMode, trustedDeviceDays }` ;
 * - `navigation` : `{ main, signUp, footer, legal, megaMenuPromo }` (formes du schéma `Navigation`) ;
 * - `zones` : `{ showFees, note }` ;
 * - `emails` : `{ teamRecipients, senderName, replyTo, surveyDelayHours, surveyReminderDays, appointmentReminderHour }`
 *   (`SettingsEmails`, destinataires des alertes « nouvelle demande »).
 */
export const SETTING_KEYS = {
  site: 'site',
  coordonnees: 'coordonnees',
  whatsapp: 'whatsapp',
  reseaux: 'reseaux',
  seo: 'seo',
  analytics: 'analytics',
  chiffres: 'chiffres',
  rgpd: 'rgpd',
  securite: 'securite',
  navigation: 'navigation',
  zones: 'zones',
  emails: 'emails',
} as const;

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];

/** Groupes lus par `GET /v1/site/settings`. */
export const SITE_SETTINGS_KEYS: readonly SettingKey[] = [
  SETTING_KEYS.site,
  SETTING_KEYS.coordonnees,
  SETTING_KEYS.whatsapp,
  SETTING_KEYS.reseaux,
  SETTING_KEYS.seo,
  SETTING_KEYS.analytics,
  SETTING_KEYS.chiffres,
  SETTING_KEYS.securite,
];
