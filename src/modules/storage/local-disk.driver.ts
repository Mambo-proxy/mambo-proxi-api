import { randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';
import type { StorageDriver } from './storage.types.js';

/** Clé d'objet : segments en minuscules, chiffres, `-`, `_`, `.`, séparés par `/` (jamais fournie par le visiteur). */
const KEY_PATTERN = /^[a-z0-9][a-z0-9_.-]*(?:\/[a-z0-9][a-z0-9_.-]*)*$/;

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT';
}

/**
 * Pilote disque local : un fichier par clé sous `STORAGE_DIR` (volume monté sur le serveur, hors de tout répertoire
 * servi). Écriture atomique (fichier temporaire puis renommage), droits `0600`, chemins confinés au répertoire.
 */
export class LocalDiskStorageDriver implements StorageDriver {
  readonly name = 'local';
  private readonly root: string;

  constructor(directory: string) {
    this.root = resolve(directory);
  }

  private pathOf(key: string): string {
    if (!KEY_PATTERN.test(key) || key.split('/').some((segment) => segment === '.' || segment === '..'))
      throw new Error('Clé de stockage invalide.');
    const path = resolve(this.root, ...key.split('/'));
    const inside = relative(this.root, path);
    if (inside === '' || inside.startsWith('..') || isAbsolute(inside))
      throw new Error('Clé de stockage hors du répertoire.');
    return path;
  }

  async put(key: string, body: Buffer): Promise<void> {
    const path = this.pathOf(key);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      await writeFile(temporary, body, { flag: 'wx', mode: 0o600 });
      await rename(temporary, path);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }

  async get(key: string): Promise<{ stream: Readable; size: number } | null> {
    const path = this.pathOf(key);
    try {
      const info = await stat(path);
      if (!info.isFile()) return null;
      return { stream: createReadStream(path), size: info.size };
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathOf(key), { force: true });
  }

  /**
   * Objets enregistrés (clés valides seulement : ni fichiers temporaires ni sondes de santé), avec leur date de
   * modification : nettoyage des fichiers orphelins par la tâche RGPD quotidienne.
   */
  async *list(): AsyncGenerator<{ key: string; modifiedAt: Date }> {
    const pending: string[] = [this.root];
    while (pending.length > 0) {
      const directory = pending.pop() as string;
      let entries;
      try {
        entries = await readdir(directory, { withFileTypes: true });
      } catch (error) {
        if (isMissing(error)) continue;
        throw error;
      }
      for (const entry of entries) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
          pending.push(path);
          continue;
        }
        if (!entry.isFile()) continue;
        const key = relative(this.root, path).split(sep).join('/');
        if (!KEY_PATTERN.test(key) || key.endsWith('.tmp')) continue;
        const info = await stat(path);
        yield { key, modifiedAt: info.mtime };
      }
    }
  }

  async check(): Promise<boolean> {
    try {
      await mkdir(this.root, { recursive: true, mode: 0o700 });
      const probe = `${this.root}${sep}.sante-${randomBytes(4).toString('hex')}`;
      await writeFile(probe, '', { flag: 'wx', mode: 0o600 });
      await rm(probe, { force: true });
      return true;
    } catch {
      return false;
    }
  }
}
