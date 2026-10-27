import { Inject, Injectable, Logger } from '@nestjs/common';
import { asObject, readNullableNumber } from '../../common/json/json-read.js';
import { AppConfigService } from '../../config/app-config.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AdminContactsService } from '../contacts/admin-contacts.service.js';
import { folderOf } from '../media/media-storage.js';
import { AdminRequestsService, ANONYMOUS_CONTACT_EMAIL } from '../requests/admin-requests.service.js';
import { OPEN_REQUEST_STATUSES } from '../requests/request.mapper.js';
import { SETTING_KEYS } from '../settings/settings.constants.js';
import { LocalDiskStorageDriver } from '../storage/local-disk.driver.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Durées de conservation (docs/05 §RGPD, docs/07, contrat). Celles des contacts inactifs et des candidatures
 * refusées sont des paramètres du back-office (groupe `rgpd`) ; les autres sont fixées ici.
 */
export const RETENTION = {
  /** Contacts sans activité depuis… (paramètre `rgpd.inactiveContactsRetentionMonths`). */
  inactiveContactsMonths: 36,
  /** Candidatures refusées (paramètre `rgpd.rejectedApplicationsRetentionMonths`). */
  rejectedApplicationsMonths: 24,
  /** Inscriptions à la newsletter jamais confirmées (le lien vaut 7 jours). */
  unconfirmedSubscribersDays: 30,
  /** Journal d'activité du back-office. */
  auditLogMonths: 12,
  /** Notifications lues / toutes les notifications. */
  readNotificationsDays: 90,
  notificationsMonths: 12,
  /** Demandes de revalidation traitées, historique des sauvegardes. */
  revalidationDays: 30,
  backupRunsDays: 90,
  /** Mesure d'audience (contrat : « événements bruts conservés 13 mois »). */
  analyticsMonths: 13,
  /** Sessions, appareils de confiance, codes et liens expirés : conservés ce délai après leur fin. */
  expiredSecurityDays: 1,
  revokedSecurityDays: 30,
  /** Un fichier sans enregistrement n'est supprimé qu'après ce délai (envoi en cours d'enregistrement). */
  orphanFileGraceHours: 24,
} as const;

/** Nombre de contacts et de candidatures traités par passage (le reste au passage suivant). */
const BATCH = 200;

export type CleanupReport = Record<string, number>;

const monthsAgo = (now: Date, months: number): Date => {
  const date = new Date(now);
  date.setUTCMonth(date.getUTCMonth() - months);
  return date;
};
const daysAgo = (now: Date, days: number): Date => new Date(now.getTime() - days * DAY_MS);

/**
 * Nettoyage RGPD quotidien (tâche planifiée du worker, 3 h 30 à Douala) : effacement des contacts inactifs,
 * suppression des candidatures refusées, des inscriptions à la newsletter jamais confirmées, des jetons, sessions et
 * codes expirés, des journaux anciens, des agrégats d'audience de plus de 13 mois et des fichiers orphelins du
 * stockage. Chaque étape est indépendante : un échec est journalisé et n'empêche pas les suivantes. Un résumé (des
 * nombres seulement) est inscrit au journal d'activité.
 */
@Injectable()
export class GdprCleanupService {
  private readonly logger = new Logger(GdprCleanupService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AppConfigService) private readonly config: AppConfigService,
    @Inject(AdminContactsService) private readonly contacts: AdminContactsService,
    @Inject(AdminRequestsService) private readonly requests: AdminRequestsService,
  ) {}

  async run(now: Date): Promise<CleanupReport> {
    const report: CleanupReport = {};
    const steps: [string, () => Promise<number>][] = [
      ['inactiveContacts', () => this.eraseInactiveContacts(now)],
      ['rejectedApplications', () => this.purgeRejectedApplications(now)],
      ['unconfirmedSubscribers', () => this.deleteUnconfirmedSubscribers(now)],
      ['securityTokens', () => this.deleteExpiredSecurityTokens(now)],
      ['logs', () => this.deleteOldLogs(now)],
      ['analytics', () => this.deleteOldAnalytics(now)],
      ['orphanFiles', () => this.deleteOrphanFiles(now)],
    ];
    for (const [name, step] of steps) {
      try {
        report[name] = await step();
      } catch (error) {
        report[name] = -1;
        this.logger.error(
          `Nettoyage RGPD : étape « ${name} » en échec (${error instanceof Error ? error.message : String(error)}).`,
        );
      }
    }
    await this.prisma.auditLog.create({
      data: {
        actorId: null,
        action: 'gdpr.cleanup',
        entity: 'System',
        entityId: null,
        label: 'Nettoyage automatique des données (durées de conservation)',
        after: report,
      },
      select: { id: true },
    });
    this.logger.log(`Nettoyage RGPD terminé : ${JSON.stringify(report)}`);
    return report;
  }

  private async retention(): Promise<{ contactsMonths: number; applicationsMonths: number }> {
    const setting = await this.prisma.setting.findUnique({
      where: { key: SETTING_KEYS.rgpd },
      select: { value: true },
    });
    const value = asObject(setting?.value);
    return {
      contactsMonths:
        readNullableNumber(value, 'inactiveContactsRetentionMonths') ?? RETENTION.inactiveContactsMonths,
      applicationsMonths:
        readNullableNumber(value, 'rejectedApplicationsRetentionMonths') ??
        RETENTION.rejectedApplicationsMonths,
    };
  }

  /**
   * Contacts sans activité depuis la durée paramétrée : effacés comme par le droit à l'effacement (demandes
   * anonymisées, fichiers supprimés). Restent les contacts abonnés (newsletter confirmée), ceux qui ont une demande
   * ouverte ou un rendez-vous à venir.
   */
  private async eraseInactiveContacts(now: Date): Promise<number> {
    const { contactsMonths } = await this.retention();
    const rows = await this.prisma.contact.findMany({
      where: {
        anonymizedAt: null,
        email: { not: ANONYMOUS_CONTACT_EMAIL },
        lastActivityAt: { lt: monthsAgo(now, contactsMonths) },
        requests: { none: { anonymizedAt: null, status: { in: [...OPEN_REQUEST_STATUSES] } } },
        appointments: {
          none: {
            startsAt: { gte: now },
            status: { in: ['A_CONFIRMER', 'CONFIRME', 'AUTRE_CRENEAU_PROPOSE'] },
          },
        },
        OR: [{ subscriber: { is: null } }, { subscriber: { is: { status: { not: 'CONFIRME' } } } }],
      },
      select: { id: true },
      orderBy: { lastActivityAt: 'asc' },
      take: BATCH,
    });
    let erased = 0;
    for (const row of rows) if (await this.contacts.eraseInactive(row.id, now)) erased += 1;
    return erased;
  }

  /** Candidatures refusées depuis la durée paramétrée (dernière modification) : supprimées avec leur CV. */
  private async purgeRejectedApplications(now: Date): Promise<number> {
    const { applicationsMonths } = await this.retention();
    const rows = await this.prisma.jobApplication.findMany({
      where: { status: 'REFUSE', updatedAt: { lt: monthsAgo(now, applicationsMonths) } },
      select: { id: true },
      orderBy: { updatedAt: 'asc' },
      take: BATCH,
    });
    let purged = 0;
    for (const row of rows) if (await this.requests.purgeRejectedApplication(row.id, now)) purged += 1;
    return purged;
  }

  /** Inscriptions jamais confirmées (double opt-in) au-delà de 30 jours : supprimées. */
  private async deleteUnconfirmedSubscribers(now: Date): Promise<number> {
    const { count } = await this.prisma.subscriber.deleteMany({
      where: {
        status: 'EN_ATTENTE',
        confirmedAt: null,
        consentAt: { lt: daysAgo(now, RETENTION.unconfirmedSubscribersDays) },
      },
    });
    return count;
  }

  /** Sessions, appareils de confiance, codes de connexion, liens de réinitialisation et invitations périmés. */
  private async deleteExpiredSecurityTokens(now: Date): Promise<number> {
    const expired = daysAgo(now, RETENTION.expiredSecurityDays);
    const revoked = daysAgo(now, RETENTION.revokedSecurityDays);
    const results = await this.prisma.$transaction([
      this.prisma.session.deleteMany({ where: { expiresAt: { lt: expired } } }),
      this.prisma.trustedDevice.deleteMany({
        where: { OR: [{ expiresAt: { lt: expired } }, { revokedAt: { lt: revoked } }] },
      }),
      this.prisma.otpChallenge.deleteMany({ where: { expiresAt: { lt: expired } } }),
      this.prisma.passwordReset.deleteMany({
        where: { OR: [{ expiresAt: { lt: expired } }, { usedAt: { lt: expired } }] },
      }),
      this.prisma.invitation.deleteMany({
        where: {
          OR: [
            { acceptedAt: { lt: revoked } },
            { revokedAt: { lt: revoked } },
            { expiresAt: { lt: daysAgo(now, 90) } },
          ],
        },
      }),
    ]);
    return results.reduce((sum, result) => sum + result.count, 0);
  }

  /** Journal d'activité, notifications, demandes de revalidation traitées et historique des sauvegardes anciens. */
  private async deleteOldLogs(now: Date): Promise<number> {
    const results = await this.prisma.$transaction([
      this.prisma.auditLog.deleteMany({
        where: { createdAt: { lt: monthsAgo(now, RETENTION.auditLogMonths) } },
      }),
      this.prisma.notification.deleteMany({
        where: {
          OR: [
            { readAt: { lt: daysAgo(now, RETENTION.readNotificationsDays) } },
            { createdAt: { lt: monthsAgo(now, RETENTION.notificationsMonths) } },
          ],
        },
      }),
      this.prisma.revalidationRequest.deleteMany({
        where: {
          status: { in: ['SUCCEEDED', 'FAILED'] },
          createdAt: { lt: daysAgo(now, RETENTION.revalidationDays) },
        },
      }),
      this.prisma.backupRun.deleteMany({
        where: { status: { not: 'RUNNING' }, startedAt: { lt: daysAgo(now, RETENTION.backupRunsDays) } },
      }),
    ]);
    return results.reduce((sum, result) => sum + result.count, 0);
  }

  /** Agrégats de la mesure d'audience de plus de 13 mois (dont les condensats des visiteurs). */
  private async deleteOldAnalytics(now: Date): Promise<number> {
    const cutoff = monthsAgo(now, RETENTION.analyticsMonths);
    const day = new Date(`${cutoff.toISOString().slice(0, 10)}T00:00:00.000Z`);
    const results = await this.prisma.$transaction([
      this.prisma.analyticsPageViewDaily.deleteMany({ where: { day: { lt: day } } }),
      this.prisma.analyticsActionDaily.deleteMany({ where: { day: { lt: day } } }),
      this.prisma.analyticsVisitorDaily.deleteMany({ where: { day: { lt: day } } }),
    ]);
    return results.reduce((sum, result) => sum + result.count, 0);
  }

  /**
   * Fichiers sans enregistrement (envoi abandonné, suppression interrompue) de plus de 24 h : pièces jointes du
   * stockage privé absentes de `attachments`, dossiers de la médiathèque absents de `media` (originaux et variantes).
   * Les anciens dossiers d'un média remplacé sont déjà supprimés par la file `media` ; ce passage rattrape les
   * suppressions manquées. Pilote disque seulement (aucun pilote S3 pour l'instant).
   */
  private async deleteOrphanFiles(now: Date): Promise<number> {
    if (this.config.get('STORAGE_DRIVER') !== 'local') return 0;
    const cutoff = now.getTime() - RETENTION.orphanFileGraceHours * 60 * 60 * 1000;
    let deleted = 0;

    const privateDriver = new LocalDiskStorageDriver(this.config.get('STORAGE_DIR'));
    const attachments = await this.prisma.attachment.findMany({ select: { storageKey: true } });
    const knownFiles = new Set(attachments.map((row) => row.storageKey));
    for await (const file of privateDriver.list()) {
      if (file.modifiedAt.getTime() >= cutoff || knownFiles.has(file.key)) continue;
      await privateDriver.delete(file.key);
      deleted += 1;
    }

    const mediaDriver = new LocalDiskStorageDriver(this.config.get('MEDIA_STORAGE_DIR'));
    const media = await this.prisma.media.findMany({ select: { storageKey: true, variants: true } });
    const knownFolders = new Set<string>();
    for (const row of media) {
      const folder = folderOf(row.storageKey);
      if (folder) knownFolders.add(folder);
      for (const variant of Array.isArray(row.variants) ? row.variants : []) {
        const key = asObject(variant)['storageKey'];
        const variantFolder = typeof key === 'string' ? folderOf(key) : null;
        if (variantFolder) knownFolders.add(variantFolder);
      }
    }
    for await (const file of mediaDriver.list()) {
      const folder = file.key.split('/')[0] ?? '';
      if (file.modifiedAt.getTime() >= cutoff || knownFolders.has(folder)) continue;
      await mediaDriver.delete(file.key);
      deleted += 1;
    }
    return deleted;
  }
}
