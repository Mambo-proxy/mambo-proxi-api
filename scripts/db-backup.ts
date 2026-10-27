/**
 * Sauvegarde manuelle de la base (`pnpm db:backup`) : même sauvegarde que la tâche planifiée du worker (`pg_dump` au
 * format personnalisé dans `BACKUP_DIR`, rotation 30 jours), sans passer par Redis ni l'inscrire dans `backup_runs`.
 * Restauration : `pg_restore --clean --if-exists --no-owner -d <base> <fichier>.dump`.
 *
 *   pnpm db:backup
 *   BACKUP_DIR=/srv/mambo-proxi/backups PG_DUMP_PATH=/usr/lib/postgresql/18/bin/pg_dump pnpm db:backup
 */
import 'dotenv/config';
import { parseEnv } from '../src/config/env.schema.js';
import { BackupError, backupDatabase, rotateBackups } from '../src/modules/maintenance/database-backup.js';

const env = parseEnv(process.env);
const now = new Date();
try {
  const result = await backupDatabase({
    databaseUrl: env.DATABASE_URL,
    directory: env.BACKUP_DIR,
    pgDumpPath: env.PG_DUMP_PATH,
    now,
  });
  const removed = await rotateBackups(env.BACKUP_DIR, now);
  console.log(`Sauvegarde écrite : ${result.path} (${String(result.sizeBytes)} octets).`);
  if (removed.length > 0) console.log(`Anciennes sauvegardes supprimées : ${removed.join(', ')}.`);
} catch (error) {
  console.error(error instanceof BackupError ? error.message : error);
  process.exitCode = 1;
}
