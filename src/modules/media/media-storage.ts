import { randomBytes } from 'node:crypto';
import { isAbsolute, relative, resolve } from 'node:path';
import type { StorageDriver } from '../storage/storage.types.js';

/**
 * Fichiers publics de la médiathèque : un pilote de stockage distinct de celui des fichiers privés (CV, pièces
 * jointes), sur son propre répertoire `MEDIA_STORAGE_DIR`. La route publique `GET /v1/media/{folder}/{file}` ne lit
 * que ce pilote et seulement des noms de la forme ci-dessous : aucun fichier privé ne peut y être atteint.
 *
 * Disposition : un dossier aléatoire de 128 bits par fichier envoyé (`<32 hex>/`), contenant `original.<ext>`
 * (image redressée, sans métadonnées, ou SVG assaini) et les variantes `<largeur>.<avif|webp>`. Un remplacement crée
 * un nouveau dossier : chaque adresse désigne toujours le même contenu (cache immuable).
 */
export const MEDIA_STORAGE = Symbol('MEDIA_STORAGE');

export type MediaStorage = StorageDriver;

export const VARIANT_WIDTHS = [480, 960, 1600] as const;
export const VARIANT_FORMATS = ['avif', 'webp'] as const;
export type VariantWidth = (typeof VARIANT_WIDTHS)[number];
export type VariantFormat = (typeof VARIANT_FORMATS)[number];

const FOLDER = /^[0-9a-f]{32}$/;
const FILE = /^(?:original\.(?:jpg|png|webp|svg)|(?:480|960|1600)\.(?:avif|webp))$/;

/** Types servis, d'après l'extension (déterminée par l'API à l'enregistrement, jamais par le visiteur). */
export const MEDIA_CONTENT_TYPES: Readonly<Record<string, string>> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
};

export function newMediaFolder(): string {
  return randomBytes(16).toString('hex');
}

export function originalKey(folder: string, extension: string): string {
  return `${folder}/original.${extension}`;
}

export function variantKey(folder: string, width: VariantWidth, format: VariantFormat): string {
  return `${folder}/${String(width)}.${format}`;
}

/** Clé d'un fichier de la médiathèque (dossier et nom contrôlés), ou `null`. */
export function mediaFileKey(folder: string, file: string): string | null {
  return FOLDER.test(folder) && FILE.test(file) ? `${folder}/${file}` : null;
}

/**
 * Clé enregistrée par l'API (fichier présent dans `MEDIA_STORAGE_DIR`). Les médias du seed ont pour clé une adresse
 * relative au site (`/photos/…`) ou absolue : aucun fichier à lire ni à supprimer.
 */
export function isStoredMediaKey(key: string): boolean {
  const [folder, file, ...rest] = key.split('/');
  return (
    rest.length === 0 && folder !== undefined && file !== undefined && mediaFileKey(folder, file) !== null
  );
}

/** Dossier d'une clé enregistrée. */
export function folderOf(key: string): string | null {
  return isStoredMediaKey(key) ? (key.split('/')[0] ?? null) : null;
}

/** Les répertoires des fichiers publics et privés ne doivent ni coïncider ni s'imbriquer (vérifié au démarrage). */
export function assertSeparateDirectories(mediaDirectory: string, privateDirectory: string): void {
  const media = resolve(mediaDirectory);
  const privateRoot = resolve(privateDirectory);
  const inside = (parent: string, child: string): boolean => {
    const path = relative(parent, child);
    return path === '' || (!path.startsWith('..') && !isAbsolute(path));
  };
  if (inside(media, privateRoot) || inside(privateRoot, media))
    throw new Error(
      'MEDIA_STORAGE_DIR et STORAGE_DIR doivent être deux répertoires distincts (ni identiques, ni imbriqués).',
    );
}
