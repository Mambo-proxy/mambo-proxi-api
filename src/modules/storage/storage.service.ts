import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type { Readable } from 'node:stream';
import { ProblemException } from '../../common/problem/problem.js';
import { AppConfigService } from '../../config/app-config.service.js';
import type { ScanStatus } from '../../generated/prisma/client.js';
import { DOWNLOAD_TOKEN_TTL_MS, signDownloadToken } from './download-token.js';
import { sanitizeFileName } from './file-name.js';
import { detectDocumentType } from './file-signature.js';
import { STORAGE_DRIVER, VIRUS_SCANNER, type StorageDriver, type VirusScanner } from './storage.types.js';

/** Taille maximale d'un document reçu (CV) : 5 Mo. */
export const MAX_DOCUMENT_SIZE = 5 * 1024 * 1024;

/** Fichier reçu par `multipart/form-data` (champ lu en mémoire par multer). */
export interface UploadedFile {
  fieldname: string;
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export function isUploadedFile(value: unknown): value is UploadedFile {
  if (typeof value !== 'object' || value === null) return false;
  const file = value as Record<string, unknown>;
  return Buffer.isBuffer(file['buffer']) && typeof file['size'] === 'number';
}

/** Document contrôlé et enregistré : colonnes de la table `attachments`. */
export interface StoredDocument {
  storageKey: string;
  fileName: string;
  mimeType: string;
  size: number;
  checksum: string;
  scanStatus: ScanStatus;
}

/** Schéma `SignedUrl` du contrat. */
export interface SignedUrl {
  url: string;
  fileName: string;
  expiresAt: string;
}

/** 413 `file-too-large` de `POST /v1/job-applications`. */
export function fileTooLargeException(): ProblemException {
  return new ProblemException({
    status: HttpStatus.PAYLOAD_TOO_LARGE,
    type: 'file-too-large',
    title: 'Fichier trop volumineux',
    detail: 'Votre CV dépasse 5 Mo. Compressez-le ou envoyez une version PDF plus légère.',
  });
}

/** 415 `unsupported-file` de `POST /v1/job-applications`. */
export function unsupportedFileException(
  detail = 'Formats acceptés pour le CV : PDF, DOC ou DOCX.',
): ProblemException {
  return new ProblemException({
    status: HttpStatus.UNSUPPORTED_MEDIA_TYPE,
    type: 'unsupported-file',
    title: 'Format non accepté',
    detail,
  });
}

/** Préfixe des clés : `cv` (candidatures), `pieces-jointes` (autres pièces jointes des demandes). */
export type StoragePrefix = 'cv' | 'pieces-jointes';

/**
 * Fichiers privés : contrôle des documents reçus (taille, type réel par signature, analyse antivirus facultative),
 * enregistrement sous une clé aléatoire, liens de téléchargement signés de 5 minutes et purge (anonymisation).
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);

  constructor(
    @Inject(STORAGE_DRIVER) private readonly driver: StorageDriver,
    @Inject(VIRUS_SCANNER) private readonly scanner: VirusScanner,
    @Inject(AppConfigService) private readonly config: AppConfigService,
  ) {}

  /**
   * Contrôle un document (CV) puis l'enregistre : vide ou de type non reconnu → 415, plus de 5 Mo → 413, refusé
   * par l'analyse antivirus → 415. Le nom affiché est assaini et prend l'extension du type réel.
   */
  async storeDocument(file: UploadedFile, prefix: StoragePrefix, now: Date): Promise<StoredDocument> {
    if (file.size > MAX_DOCUMENT_SIZE || file.buffer.length > MAX_DOCUMENT_SIZE)
      throw fileTooLargeException();
    const type = file.buffer.length === 0 ? null : detectDocumentType(file.buffer);
    if (!type) throw unsupportedFileException();
    const scanStatus = await this.scanner.scan(file.buffer);
    if (scanStatus === 'INFECTED')
      throw unsupportedFileException('Ce fichier a été refusé par le contrôle antivirus.');
    const year = String(now.getUTCFullYear());
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    const storageKey = `${prefix}/${year}/${month}/${randomBytes(16).toString('hex')}.${type.extension}`;
    await this.driver.put(storageKey, file.buffer, type.mimeType);
    return {
      storageKey,
      fileName: sanitizeFileName(file.originalname, type.extension, prefix === 'cv' ? 'cv' : 'document'),
      mimeType: type.mimeType,
      size: file.buffer.length,
      checksum: createHash('sha256').update(file.buffer).digest('hex'),
      scanStatus,
    };
  }

  /** Flux d'un fichier ; `null` s'il n'existe plus. */
  open(storageKey: string): Promise<{ stream: Readable; size: number } | null> {
    return this.driver.get(storageKey);
  }

  /** Supprime des fichiers sans faire échouer l'appelant (journal sans donnée personnelle : nombre seulement). */
  async deleteQuietly(storageKeys: readonly string[]): Promise<void> {
    if (storageKeys.length === 0) return;
    const results = await Promise.allSettled(storageKeys.map((key) => this.driver.delete(key)));
    const failed = results.filter((result) => result.status === 'rejected').length;
    if (failed > 0) this.logger.error(`${String(failed)} fichier(s) non supprimé(s) du stockage.`);
  }

  /** Lien de téléchargement signé (5 minutes) d'une pièce jointe, servi par `GET /v1/files/{token}`. */
  signedUrl(attachment: { id: string; fileName: string }, now: Date): SignedUrl {
    const expiresAt = new Date(now.getTime() + DOWNLOAD_TOKEN_TTL_MS);
    const token = signDownloadToken(this.config.get('TOKEN_SIGNING_SECRET'), {
      attachmentId: attachment.id,
      expiresAt,
    });
    const url = new URL(`/v1/files/${token}`, this.config.get('API_URL')).toString();
    return { url, fileName: attachment.fileName, expiresAt: expiresAt.toISOString() };
  }

  check(): Promise<boolean> {
    return this.driver.check();
  }
}
