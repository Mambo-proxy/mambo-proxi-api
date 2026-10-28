import { isDeepStrictEqual } from 'node:util';
import { Inject, Injectable } from '@nestjs/common';
import { APP_VERSION } from '../../common/app-version.js';
import { recordAudit, type AuditActor } from '../../common/audit/audit-log.js';
import { asObject, readNullableString, type JsonObject } from '../../common/json/json-read.js';
import { notFoundException } from '../../common/problem/problem.js';
import { CACHE_TAGS, requestRevalidation } from '../../common/revalidation/revalidation.js';
import { validationException } from '../../common/validation/validation-exception.js';
import { AppConfigService } from '../../config/app-config.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { forbiddenException } from '../auth/auth.errors.js';
import type { AuthContext } from '../auth/auth.types.js';
import { BACKUP_RETENTION_DAYS } from '../maintenance/database-backup.js';
import { unknownMediaErrors } from '../media/media-refs.js';
import { MediaService } from '../media/media.service.js';
import {
  ADMIN_SETTINGS_GROUPS,
  isSettingsGroup,
  type SettingsGroup,
  type SettingsGroupValue,
} from './admin-settings.schemas.js';
import {
  nextSettingTranslations,
  reviewedFieldErrors,
  settingTranslationView,
  type SettingTranslationsInput,
} from './setting-translations.js';

export const SETTINGS_GROUP_NOT_FOUND = 'Ce groupe de paramètres n’existe pas.';

// Durée de conservation des sauvegardes quotidiennes (`pg_dump`, docs/07) : celle de la tâche de sauvegarde.
export { BACKUP_RETENTION_DAYS };

/** Traductions sans les empreintes (`en.sourceHashes`) : comparaison pour le journal d'activité. */
function withoutHashes(translations: unknown): unknown {
  const en = asObject(asObject(translations)['en']);
  if (!('sourceHashes' in en)) return translations;
  const { sourceHashes: _hashes, ...texts } = en;
  return { ...asObject(translations), en: texts };
}

/** Libellés des groupes (journal d'activité). */
const GROUP_LABELS: Record<SettingsGroup, string> = {
  coordonnees: 'Coordonnées',
  whatsapp: 'WhatsApp',
  reseaux: 'Réseaux sociaux',
  emails: 'E-mails automatiques',
  seo: 'Référencement',
  analytics: 'Mesure d’audience',
  chiffres: 'Chiffres clés',
  rgpd: 'Données personnelles',
  securite: 'Sécurité',
};

/** Champs du contrat de chaque groupe (les autres clés enregistrées, internes, ne sont pas renvoyées). */
const GROUP_FIELDS: Record<SettingsGroup, readonly string[]> = {
  coordonnees: ['phoneFrance', 'phoneCameroon', 'email', 'hoursLabel', 'agency'],
  whatsapp: ['enabled', 'number', 'message'],
  reseaux: ['social'],
  emails: [
    'teamRecipients',
    'senderName',
    'replyTo',
    'surveyDelayHours',
    'surveyReminderDays',
    'appointmentReminderHour',
  ],
  seo: ['defaultTitle', 'defaultDescription', 'ogImageId', 'searchConsoleVerification'],
  analytics: ['ga4MeasurementId', 'ga4PropertyId', 'newsletterTracking'],
  chiffres: ['keyFigures'],
  rgpd: ['inactiveContactsRetentionMonths', 'rejectedApplicationsRetentionMonths'],
  securite: ['maintenanceMode', 'trustedDeviceDays'],
};

/** Valeurs par défaut d'un groupe jamais enregistré (celles du contrat, sinon des valeurs neutres). */
const GROUP_DEFAULTS: Record<SettingsGroup, JsonObject> = {
  coordonnees: {
    phoneFrance: null,
    phoneCameroon: '+237600000000',
    email: 'contact@mamboproxi.com',
    hoursLabel: '',
    agency: { name: 'Agence MAMBO Proxi', addressLines: [], city: 'Douala', country: 'CM', openingHours: [] },
  },
  whatsapp: { enabled: false, number: '+237600000000', message: '' },
  reseaux: { social: [] },
  emails: {
    teamRecipients: ['contact@mamboproxi.com'],
    senderName: 'MAMBO Proxi',
    replyTo: null,
    surveyDelayHours: 24,
    surveyReminderDays: 3,
    appointmentReminderHour: 9,
  },
  seo: {
    defaultTitle: 'MAMBO Proxi',
    defaultDescription: '',
    ogImageId: null,
    searchConsoleVerification: null,
  },
  analytics: { ga4MeasurementId: null, ga4PropertyId: null, newsletterTracking: false },
  chiffres: { keyFigures: [] },
  rgpd: { inactiveContactsRetentionMonths: 36, rejectedApplicationsRetentionMonths: 24 },
  securite: { maintenanceMode: false, trustedDeviceDays: 30 },
};

/** Groupes lus par le site public (`GET /v1/site/settings`) : leur enregistrement revalide l'étiquette `settings`. */
const PUBLIC_GROUPS: ReadonlySet<SettingsGroup> = new Set([
  'coordonnees',
  'whatsapp',
  'reseaux',
  'seo',
  'analytics',
  'chiffres',
  'securite',
]);

/** Libellés d'affichage enregistrés à côté d'un numéro : retirés quand le numéro change (recalculés à la lecture). */
const DISPLAY_FIELDS: Partial<Record<SettingsGroup, [field: string, display: string][]>> = {
  coordonnees: [
    ['phoneFrance', 'phoneFranceDisplay'],
    ['phoneCameroon', 'phoneCameroonDisplay'],
  ],
  whatsapp: [['number', 'numberDisplay']],
};

/** Schéma `SystemStatus` du contrat. */
export interface SystemStatus {
  https: boolean;
  lastBackupAt: string | null;
  lastBackupSize: number | null;
  backupRetentionDays: number;
  version: string;
  emailProvider: string | null;
}

function pick(value: JsonObject, fields: readonly string[]): JsonObject {
  return Object.fromEntries(fields.filter((field) => field in value).map((field) => [field, value[field]]));
}

/**
 * Paramètres du back-office (`/v1/admin/settings/{group}`, `/v1/admin/system-status`) : une ligne `settings` par
 * groupe. L'enregistrement remplace les champs du contrat et garde les clés internes (libellés d'affichage) ; la
 * version anglaise (`translations`, groupes qui ont des textes) est remplacée si elle est envoyée, sinon gardée, et
 * ses empreintes sont mises à jour. Il s'applique partout sur le site dès la lecture suivante.
 */
@Injectable()
export class AdminSettingsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MediaService) private readonly media: MediaService,
    @Inject(AppConfigService) private readonly config: AppConfigService,
  ) {}

  private async stored(group: SettingsGroup): Promise<{ value: JsonObject; translations: unknown } | null> {
    const row = await this.prisma.setting.findUnique({
      where: { key: group },
      select: { value: true, translations: true },
    });
    return row === null ? null : { value: asObject(row.value), translations: row.translations };
  }

  /** Champs du contrat (valeurs par défaut d'un groupe jamais enregistré). */
  private fields(group: SettingsGroup, stored: JsonObject | null): JsonObject {
    return pick({ ...GROUP_DEFAULTS[group], ...(stored ?? {}) }, GROUP_FIELDS[group]);
  }

  /**
   * Réponse du back-office : champs du contrat, puis, pour un groupe qui a des textes, sa version anglaise
   * (`translations.en`) et son statut (`translationStatus.en`).
   */
  private async toValue(
    group: SettingsGroup,
    stored: JsonObject | null,
    translations: unknown,
  ): Promise<JsonObject> {
    const fields = this.fields(group, stored);
    const value: JsonObject = { group, ...fields, ...settingTranslationView(group, fields, translations) };
    if (group === 'seo') {
      const ogImageId = readNullableString(value, 'ogImageId');
      value['ogImage'] =
        ogImageId === null
          ? null
          : this.media.image((await this.media.findByIds([ogImageId])).get(ogImageId));
    }
    return value;
  }

  /** `GET /v1/admin/settings/{group}` */
  async get(group: string): Promise<JsonObject> {
    if (!isSettingsGroup(group)) throw notFoundException(SETTINGS_GROUP_NOT_FOUND);
    const stored = await this.stored(group);
    return this.toValue(group, stored?.value ?? null, stored?.translations ?? null);
  }

  /**
   * `PUT /v1/admin/settings/{group}` : groupe complet. `analytics` et `securite` demandent `settings:admin`
   * (administrateurs), les autres `settings:write` (403 sinon) ; `group` du corps différent de l'adresse → 422.
   */
  async save(
    group: string,
    input: SettingsGroupValue,
    auth: AuthContext,
    actor: AuditActor,
  ): Promise<JsonObject> {
    if (!isSettingsGroup(group)) throw notFoundException(SETTINGS_GROUP_NOT_FOUND);
    const required = ADMIN_SETTINGS_GROUPS.has(group) ? 'settings:admin' : 'settings:write';
    if (!auth.permissions.includes(required)) {
      throw forbiddenException(
        required === 'settings:admin'
          ? 'Ces paramètres sont réservés aux administrateurs.'
          : 'Votre rôle ne permet pas de modifier les paramètres.',
      );
    }
    if (input.group !== group) {
      throw validationException([
        { path: 'group', code: 'group_mismatch', message: 'Le groupe envoyé ne correspond pas à l’adresse.' },
      ]);
    }
    if (input.group === 'seo') {
      const errors = await unknownMediaErrors(this.media, [{ path: 'ogImageId', id: input.ogImageId }]);
      if (errors.length > 0) throw validationException(errors);
    }

    const stored = await this.stored(group);
    const current = stored?.value ?? {};
    const {
      group: _group,
      translations: translationsInput,
      translationStatus: _status,
      ...fields
    } = input as SettingsGroupValue & {
      translations?: SettingTranslationsInput;
      translationStatus?: unknown;
    };
    if ('ogImage' in fields) delete (fields as JsonObject)['ogImage'];
    const next: JsonObject = { ...current, ...fields };
    for (const [field, display] of DISPLAY_FIELDS[group] ?? []) {
      if (current[field] !== next[field]) delete next[display];
    }
    if (group === 'coordonnees') {
      // Numéro de l'agence changé mais ancien libellé renvoyé tel quel : libellé recalculé à la lecture.
      const before = asObject(current['agency']);
      const after = { ...asObject(next['agency']) };
      if (before['phone'] !== after['phone'] && after['phoneDisplay'] === before['phoneDisplay']) {
        delete after['phoneDisplay'];
        next['agency'] = after;
      }
    }
    const changed = GROUP_FIELDS[group].filter(
      (field) => JSON.stringify(current[field] ?? null) !== JSON.stringify(next[field] ?? null),
    );
    // Version anglaise : textes de la liste blanche seulement, empreintes par chemin (`setting-translations`).
    const nextFields = this.fields(group, next);
    if (translationsInput !== undefined) {
      const errors = reviewedFieldErrors(group, nextFields, translationsInput);
      if (errors.length > 0) throw validationException(errors);
    }
    const translations = nextSettingTranslations({
      key: group,
      previousFrench: this.fields(group, stored?.value ?? null),
      french: nextFields,
      stored: stored?.translations ?? null,
      input: translationsInput,
    });
    // Colonne écrite seulement si elle change (`null` : plus aucune traduction).
    const translationData =
      translations === undefined || (translations === null && (stored?.translations ?? null) === null)
        ? {}
        : { translations: translations === null ? Prisma.DbNull : (translations as Prisma.InputJsonObject) };
    // Journal : seuls les textes anglais comptent, pas les empreintes posées à chaque enregistrement.
    if (
      translations !== undefined &&
      !isDeepStrictEqual(withoutHashes(translations), withoutHashes(stored?.translations ?? null))
    ) {
      changed.push('translations');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.setting.upsert({
        where: { key: group },
        create: {
          key: group,
          value: next as Prisma.InputJsonObject,
          ...translationData,
          updatedById: actor.userId,
        },
        update: { value: next as Prisma.InputJsonObject, ...translationData, updatedById: actor.userId },
        select: { key: true },
      });
      if (PUBLIC_GROUPS.has(group)) await requestRevalidation(tx, [CACHE_TAGS.settings]);
      await recordAudit(tx, actor, {
        action: 'settings.update',
        entity: 'Setting',
        entityId: group,
        label: `A modifié les paramètres « ${GROUP_LABELS[group]} »`,
        // Noms des champs modifiés seulement (adresses et numéros restent hors du journal).
        after: { fields: changed },
      });
    });
    // Seul groupe modifiable qui référence une image (`ogImageId`).
    if (group === 'seo') await this.media.refreshUsages({ kind: 'setting', entityId: group });
    return this.toValue(
      group,
      next,
      translations === undefined ? (stored?.translations ?? null) : translations,
    );
  }

  /** `GET /v1/admin/system-status` : HTTPS du site, dernière sauvegarde réussie, version, fournisseur d'e-mails. */
  async systemStatus(): Promise<SystemStatus> {
    const backup = await this.prisma.backupRun.findFirst({
      where: { status: 'SUCCEEDED' },
      orderBy: [{ finishedAt: 'desc' }, { startedAt: 'desc' }],
      select: { startedAt: true, finishedAt: true, sizeBytes: true },
    });
    const smtpHost = this.config.get('SMTP_HOST');
    return {
      https:
        this.config.get('WEB_URL').startsWith('https://') &&
        this.config.get('API_URL').startsWith('https://'),
      lastBackupAt: (backup?.finishedAt ?? backup?.startedAt ?? null)?.toISOString() ?? null,
      lastBackupSize:
        backup?.sizeBytes === null || backup?.sizeBytes === undefined ? null : Number(backup.sizeBytes),
      backupRetentionDays: BACKUP_RETENTION_DAYS,
      version: APP_VERSION,
      emailProvider: smtpHost === '' ? null : smtpHost,
    };
  }
}
