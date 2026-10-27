import { spawn } from 'node:child_process';
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

/** Durée de conservation des sauvegardes (docs/07 : rotation 30 jours). */
export const BACKUP_RETENTION_DAYS = 30;

/** Nom des fichiers de sauvegarde : `mambo-proxi-AAAAMMJJ-HHMMSS.dump` (heure UTC). */
const BACKUP_FILE = /^mambo-proxi-\d{8}-\d{6}\.dump$/;

/** Durée maximale d'une sauvegarde avant abandon. */
const BACKUP_TIMEOUT_MS = 30 * 60 * 1000;

export interface BackupOptions {
  databaseUrl: string;
  directory: string;
  /** Commande ou chemin de `pg_dump`. */
  pgDumpPath: string;
  now: Date;
}

export interface BackupResult {
  fileName: string;
  path: string;
  sizeBytes: number;
}

/** Échec d'une sauvegarde, avec un message prêt à afficher (aucun secret ni adresse de connexion). */
export class BackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupError';
  }
}

export function backupFileName(now: Date): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  return `mambo-proxi-${stamp}.dump`;
}

/**
 * Variables de connexion de `pg_dump` tirées de `DATABASE_URL` : le mot de passe passe par `PGPASSWORD` (jamais sur
 * la ligne de commande, visible dans la liste des processus) et le paramètre Prisma `schema` est ignoré.
 */
export function pgEnvironment(databaseUrl: string): Record<string, string> {
  const url = new URL(databaseUrl);
  const env: Record<string, string> = {
    PGHOST: decodeURIComponent(url.hostname),
    PGPORT: url.port === '' ? '5432' : url.port,
    PGDATABASE: decodeURIComponent(url.pathname.replace(/^\//, '')),
  };
  if (url.username !== '') env['PGUSER'] = decodeURIComponent(url.username);
  if (url.password !== '') env['PGPASSWORD'] = decodeURIComponent(url.password);
  const sslmode = url.searchParams.get('sslmode');
  if (sslmode) env['PGSSLMODE'] = sslmode;
  return env;
}

function runPgDump(command: string, file: string, env: Record<string, string>): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, ['--format=custom', '--no-owner', '--no-privileges', '--file', file], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    });
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), BACKUP_TIMEOUT_MS);
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      if (stderr.length < 2_000) stderr += chunk;
    });
    child.on('error', (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(
        new BackupError(
          error.code === 'ENOENT'
            ? `Sauvegarde impossible : la commande « ${command} » est introuvable. Installez les outils clients ` +
                'PostgreSQL (paquet postgresql-client, même version majeure que le serveur) ou renseignez PG_DUMP_PATH.'
            : `Sauvegarde impossible : pg_dump n'a pas pu démarrer (${error.message}).`,
        ),
      );
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) return resolvePromise();
      const reason = stderr
        .trim()
        .split('\n')
        .slice(-3)
        .join(' ')
        .replace(/password=\S+/gi, 'password=***');
      reject(
        new BackupError(
          signal
            ? `Sauvegarde interrompue (${signal}) après ${String(BACKUP_TIMEOUT_MS / 60_000)} minutes au plus.`
            : `pg_dump a échoué (code ${String(code)})${reason ? ` : ${reason}` : '.'}`,
        ),
      );
    });
  });
}

/**
 * Sauvegarde complète de la base par `pg_dump` (format personnalisé, restaurable par `pg_restore`) dans
 * `directory` : écriture dans un fichier `.partial` renommé à la fin, jamais de fichier incomplet sous le nom final.
 *
 * Point d'extension « stockage objet » : une fois le fichier écrit, il peut être copié vers un bucket S3 (aucune
 * dépendance S3 n'est installée pour l'instant) — par exemple par une commande `aws s3 cp` ou `rclone` planifiée
 * sur le serveur, ou en ajoutant ici l'envoi avec le SDK quand le pilote S3 du stockage sera écrit.
 */
export async function backupDatabase(options: BackupOptions): Promise<BackupResult> {
  const directory = resolve(options.directory);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const fileName = backupFileName(options.now);
  const path = join(directory, fileName);
  const partial = `${path}.partial`;
  try {
    await runPgDump(options.pgDumpPath, partial, pgEnvironment(options.databaseUrl));
    await rename(partial, path);
  } catch (error) {
    await rm(partial, { force: true });
    throw error;
  }
  const info = await stat(path);
  return { fileName, path, sizeBytes: info.size };
}

/** Supprime les sauvegardes de plus de `retentionDays` jours (fichiers `mambo-proxi-*.dump` du répertoire). */
export async function rotateBackups(
  directory: string,
  now: Date,
  retentionDays = BACKUP_RETENTION_DAYS,
): Promise<string[]> {
  const root = resolve(directory);
  let names: string[];
  try {
    names = await readdir(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const cutoff = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;
  const removed: string[] = [];
  for (const name of names) {
    if (!BACKUP_FILE.test(name) && !name.endsWith('.dump.partial')) continue;
    const path = join(root, name);
    const info = await stat(path);
    if (info.mtime.getTime() < cutoff) {
      await rm(path, { force: true });
      removed.push(name);
    }
  }
  return removed;
}
