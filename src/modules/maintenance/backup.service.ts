import { Inject, Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { BACKUP_RETENTION_DAYS, BackupError, backupDatabase, rotateBackups } from './database-backup.js';

const formatSize = (bytes: number): string =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} Mo`
    : `${String(Math.max(1, Math.round(bytes / 1024)))} Ko`;

/**
 * Sauvegarde quotidienne de la base (tâche planifiée du worker, 2 h à Douala) : `pg_dump` dans `BACKUP_DIR`, rotation
 * 30 jours, suivi dans `backup_runs` (dernière sauvegarde réussie affichée par `GET /v1/admin/system-status`) et
 * dans le journal d'activité. `pg_dump` absent ou en échec : la sauvegarde est marquée `FAILED` avec un message clair.
 */
@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AppConfigService) private readonly config: AppConfigService,
  ) {}

  async run(now: Date): Promise<{ status: 'SUCCEEDED' | 'FAILED'; fileName?: string; error?: string }> {
    const directory = this.config.get('BACKUP_DIR');
    const run = await this.prisma.backupRun.create({
      data: { status: 'RUNNING', startedAt: now },
      select: { id: true },
    });
    try {
      const result = await backupDatabase({
        databaseUrl: this.config.get('DATABASE_URL'),
        directory,
        pgDumpPath: this.config.get('PG_DUMP_PATH'),
        now,
      });
      const removed = await rotateBackups(directory, new Date(), BACKUP_RETENTION_DAYS);
      await this.prisma.$transaction([
        this.prisma.backupRun.update({
          where: { id: run.id },
          data: {
            status: 'SUCCEEDED',
            storageKey: result.fileName,
            sizeBytes: BigInt(result.sizeBytes),
            finishedAt: new Date(),
          },
          select: { id: true },
        }),
        this.prisma.auditLog.create({
          data: {
            actorId: null,
            action: 'backup.done',
            entity: 'System',
            entityId: run.id,
            label: `Sauvegarde automatique de la base (${formatSize(result.sizeBytes)})`,
            after: { file: result.fileName, sizeBytes: result.sizeBytes, rotated: removed.length },
          },
          select: { id: true },
        }),
      ]);
      this.logger.log(
        `Sauvegarde de la base terminée (${formatSize(result.sizeBytes)}, ${String(removed.length)} ancienne(s) supprimée(s)).`,
      );
      return { status: 'SUCCEEDED', fileName: result.fileName };
    } catch (error) {
      const message =
        error instanceof BackupError
          ? error.message
          : `Sauvegarde impossible (${error instanceof Error ? error.message : String(error)}).`;
      await this.prisma.$transaction([
        this.prisma.backupRun.update({
          where: { id: run.id },
          data: { status: 'FAILED', error: message.slice(0, 1_000), finishedAt: new Date() },
          select: { id: true },
        }),
        this.prisma.auditLog.create({
          data: {
            actorId: null,
            action: 'backup.failed',
            entity: 'System',
            entityId: run.id,
            label: 'Échec de la sauvegarde automatique de la base',
            after: { error: message.slice(0, 300) },
          },
          select: { id: true },
        }),
      ]);
      this.logger.error(message);
      return { status: 'FAILED', error: message };
    }
  }
}
