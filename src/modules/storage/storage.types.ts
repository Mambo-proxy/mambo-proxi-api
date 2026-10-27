import type { Readable } from 'node:stream';
import type { ScanStatus } from '../../generated/prisma/client.js';

/**
 * Pilote de stockage des fichiers privés (CV, pièces jointes des demandes). Les fichiers ne sont jamais servis
 * statiquement : la lecture passe par l'API (route `GET /v1/files/{token}`, lien signé de courte durée).
 *
 * Point d'extension : un pilote S3 (bucket privé `S3_BUCKET_PRIVATE`, URL présignées) implémentera la même interface
 * et sera choisi par `STORAGE_DRIVER=s3` dans `StorageModule` ; aucune dépendance S3 n'est installée pour l'instant,
 * seul le pilote disque local (`STORAGE_DRIVER=local`, répertoire `STORAGE_DIR`) existe.
 */
export interface StorageDriver {
  /** Nom du pilote (journaux, état de santé). */
  readonly name: string;
  /** Enregistre le contenu sous la clé (remplace un objet existant). */
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  /** Flux de lecture et taille ; `null` si l'objet n'existe pas. */
  get(key: string): Promise<{ stream: Readable; size: number } | null>;
  /** Supprime l'objet ; sans erreur s'il n'existe pas. */
  delete(key: string): Promise<void>;
  /** Le stockage répond (lecture et écriture possibles). */
  check(): Promise<boolean>;
}

/** Jeton d'injection du pilote de stockage. */
export const STORAGE_DRIVER = Symbol('STORAGE_DRIVER');

/**
 * Analyse antivirus d'un fichier reçu. Point d'accroche ClamAV (`clamd`, commande `INSTREAM`) : désactivé tant
 * qu'aucun service n'est déployé ; l'analyse renvoie alors `SKIPPED` (colonne `attachments.scan_status`).
 */
export interface VirusScanner {
  scan(body: Buffer): Promise<ScanStatus>;
}

/** Jeton d'injection de l'analyse antivirus. */
export const VIRUS_SCANNER = Symbol('VIRUS_SCANNER');

/** Nom de fichier des pièces jointes d'une demande anonymisée (le fichier lui-même est supprimé du stockage). */
export const ANONYMIZED_FILE_NAME = 'fichier-anonymise';
