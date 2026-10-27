import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { recordAudit, type AuditActor } from '../../common/audit/audit-log.js';
import { paginationMeta, pageWindow, type Page } from '../../common/pagination/pagination.js';
import { notFoundException, ProblemException } from '../../common/problem/problem.js';
import { requestRevalidation } from '../../common/revalidation/revalidation.js';
import { validationException } from '../../common/validation/validation-exception.js';
import { AppConfigService } from '../../config/app-config.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { sanitizeFileName } from '../storage/file-name.js';
import { detectImageType, type ImageType } from '../storage/file-signature.js';
import { isUploadedFile, unsupportedFileException } from '../storage/storage.service.js';
import { ADMIN_MEDIA_SELECT, toAdminMedia, type AdminMedia } from './admin-media.mapper.js';
import type { ListMediaQuery, UpdateMediaInput, UploadMediaFields } from './admin-media.schemas.js';
import {
  MAX_INPUT_PIXELS,
  UnreadableImageError,
  prepareOriginal,
  variantWidths,
  type PreparedOriginal,
} from './image-processing.js';
import { MediaProcessingService } from './media-processing.service.js';
import {
  MEDIA_STORAGE,
  isStoredMediaKey,
  newMediaFolder,
  originalKey,
  type MediaStorage,
} from './media-storage.js';
import { MAX_MEDIA_SIZE, mediaTooLargeException } from './media-upload.interceptor.js';
import { collectAllUsages, liveForeignUsages } from './media-usages.js';
import { sanitizeSvg } from './svg-sanitizer.js';

export const MEDIA_NOT_FOUND = 'Ce média n’existe plus.';
const UNSUPPORTED_MESSAGE = 'Formats acceptés : JPG, PNG, WebP ou SVG.';

/** Image reçue, contrôlée et prête à publier. */
interface CheckedImage {
  type: ImageType;
  prepared: PreparedOriginal;
  fileName: string;
  checksum: string;
}

/** Usages affichés dans le message de refus d'une suppression (les suivants sont comptés). */
const LISTED_USAGES = 5;

function mediaInUseException(labels: readonly string[]): ProblemException {
  const shown = labels.slice(0, LISTED_USAGES).join(', ');
  const more = labels.length - LISTED_USAGES;
  return new ProblemException({
    status: HttpStatus.CONFLICT,
    type: 'media-in-use',
    title: 'Image utilisée',
    detail: `Cette image est utilisée par : ${shown}${more > 0 ? ` et ${String(more)} autre${more > 1 ? 's' : ''}` : ''}. Remplacez-la avant de la supprimer.`,
  });
}

function isForeignKeyViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003';
}

/**
 * Médiathèque du back-office (`/v1/admin/media*`) : liste, détail, envoi, remplacement du fichier, texte
 * alternatif et point focal, suppression d'une image inutilisée.
 *
 * Fichiers : rangés à part des fichiers privés (`MEDIA_STORAGE_DIR`), dans un dossier aléatoire par envoi, servis
 * par `GET /v1/media/{folder}/{file}` (cache immuable). Médias du seed : adresse relative au site gardée telle
 * quelle, aucun fichier dans le stockage (le remplacement en fait un média ordinaire).
 */
@Injectable()
export class AdminMediaService {
  private readonly logger = new Logger(AdminMediaService.name);
  private readonly publicBaseUrl: string;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MEDIA_STORAGE) private readonly storage: MediaStorage,
    @Inject(MediaProcessingService) private readonly processing: MediaProcessingService,
    @Inject(AppConfigService) config: AppConfigService,
  ) {
    this.publicBaseUrl = config.get('MEDIA_PUBLIC_URL');
  }

  /** `GET /v1/admin/media` : plus récents d'abord. */
  async list(query: ListMediaQuery): Promise<Page<AdminMedia>> {
    const and: Prisma.MediaWhereInput[] = [];
    if (query.q !== undefined && query.q !== '')
      and.push({
        OR: [
          { fileName: { contains: query.q, mode: 'insensitive' } },
          { alt: { contains: query.q, mode: 'insensitive' } },
        ],
      });
    if (query.status !== undefined) and.push({ status: query.status });
    if (query.used !== undefined) {
      const relations: Prisma.MediaWhereInput[] = [
        { usages: { some: {} } },
        { partners: { some: {} } },
        { events: { some: {} } },
        { magazineCovers: { some: {} } },
        { magazineArticles: { some: {} } },
      ];
      and.push(
        query.used
          ? { OR: relations }
          : {
              usages: { none: {} },
              partners: { none: {} },
              events: { none: {} },
              magazineCovers: { none: {} },
              magazineArticles: { none: {} },
            },
      );
    }
    const where: Prisma.MediaWhereInput = and.length > 0 ? { AND: and } : {};
    const [total, rows] = await Promise.all([
      this.prisma.media.count({ where }),
      this.prisma.media.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...pageWindow(query.page, query.pageSize),
        select: ADMIN_MEDIA_SELECT,
      }),
    ]);
    return {
      data: rows.map((row) => toAdminMedia(row, this.publicBaseUrl)),
      meta: paginationMeta(query.page, query.pageSize, total),
    };
  }

  /** `GET /v1/admin/media/{id}` */
  async detail(id: string): Promise<AdminMedia> {
    const row = await this.prisma.media.findUnique({ where: { id }, select: ADMIN_MEDIA_SELECT });
    if (row === null) throw notFoundException(MEDIA_NOT_FOUND);
    return toAdminMedia(row, this.publicBaseUrl);
  }

  /**
   * Contrôle d'un fichier reçu : présent (422), 10 Mo (413), type réel JPG/PNG/WebP/SVG (415), SVG assaini, image
   * décodable et de 50 mégapixels au plus (415) ; image redressée et sans métadonnées.
   */
  private async check(file: unknown): Promise<CheckedImage> {
    if (!isUploadedFile(file))
      throw validationException([{ path: 'file', code: 'required', message: 'Choisissez une image.' }]);
    if (file.size > MAX_MEDIA_SIZE || file.buffer.length > MAX_MEDIA_SIZE) throw mediaTooLargeException();
    const type = file.buffer.length === 0 ? null : detectImageType(file.buffer);
    if (type === null) throw unsupportedFileException(UNSUPPORTED_MESSAGE);
    const body = type.vector ? sanitizeSvg(file.buffer) : file.buffer;
    if (body === null)
      throw unsupportedFileException('Ce fichier SVG est illisible ou ne contient aucun dessin.');
    let prepared: PreparedOriginal;
    try {
      prepared = await prepareOriginal(body, type);
    } catch (error) {
      if (error instanceof UnreadableImageError)
        throw unsupportedFileException(
          error.reason === 'too-large'
            ? `L’image dépasse ${String(MAX_INPUT_PIXELS / 1_000_000)} mégapixels. Réduisez ses dimensions avant de l’envoyer.`
            : 'Cette image est illisible ou endommagée. Exportez-la de nouveau puis réessayez.',
        );
      throw error;
    }
    return {
      type,
      prepared,
      fileName: sanitizeFileName(file.originalname, type.extension, 'image'),
      checksum: createHash('sha256').update(file.buffer).digest('hex'),
    };
  }

  /** Variantes à produire : aucune pour un SVG ou une image plus étroite que 480 px. */
  private needsVariants(image: CheckedImage): boolean {
    return !image.type.vector && variantWidths(image.prepared.width).length > 0;
  }

  /** Publie l'original dans un nouveau dossier ; renvoie sa clé. */
  private async publish(image: CheckedImage): Promise<string> {
    const key = originalKey(newMediaFolder(), image.type.extension);
    await this.storage.put(key, image.prepared.body, image.type.mimeType);
    return key;
  }

  private async removeQuietly(keys: readonly string[]): Promise<void> {
    const results = await Promise.allSettled(
      keys.filter(isStoredMediaKey).map((key) => this.storage.delete(key)),
    );
    const failed = results.filter((result) => result.status === 'rejected').length;
    if (failed > 0) this.logger.error(`${String(failed)} fichier(s) de la médiathèque non supprimé(s).`);
  }

  /** `POST /v1/admin/media` */
  async upload(file: unknown, fields: UploadMediaFields, actor: AuditActor): Promise<AdminMedia> {
    const image = await this.check(file);
    const storageKey = await this.publish(image);
    const processing = this.needsVariants(image);
    let id: string;
    try {
      id = await this.prisma.$transaction(async (tx) => {
        const row = await tx.media.create({
          data: {
            storageKey,
            fileName: image.fileName,
            mimeType: image.type.kind,
            size: image.prepared.body.length,
            width: image.prepared.width,
            height: image.prepared.height,
            alt: fields.alt,
            focalX: null,
            focalY: null,
            blurDataUrl: image.prepared.blurDataUrl,
            variants: [],
            status: processing ? 'PROCESSING' : 'READY',
            checksum: image.checksum,
            uploadedById: actor.userId,
            isDemo: false,
          },
          select: { id: true },
        });
        await recordAudit(tx, actor, {
          action: 'media.create',
          entity: 'Media',
          entityId: row.id,
          label: `A ajouté l’image « ${image.fileName} »`,
          after: {
            mimeType: image.type.mimeType,
            width: image.prepared.width,
            height: image.prepared.height,
          },
        });
        return row.id;
      });
    } catch (error) {
      await this.removeQuietly([storageKey]);
      throw error;
    }
    if (processing) await this.processing.enqueueVariants(id, storageKey);
    return this.detail(id);
  }

  /** `PUT /v1/admin/media/{id}/file` : même identifiant, nouveaux fichiers (nouvelles adresses). */
  async replace(id: string, file: unknown, actor: AuditActor): Promise<AdminMedia> {
    const current = await this.prisma.media.findUnique({
      where: { id },
      select: { storageKey: true, variants: true, fileName: true },
    });
    if (current === null) throw notFoundException(MEDIA_NOT_FOUND);
    const image = await this.check(file);
    const storageKey = await this.publish(image);
    const processing = this.needsVariants(image);
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.media.update({
          where: { id },
          data: {
            storageKey,
            fileName: image.fileName,
            mimeType: image.type.kind,
            size: image.prepared.body.length,
            width: image.prepared.width,
            height: image.prepared.height,
            blurDataUrl: image.prepared.blurDataUrl,
            variants: [],
            status: processing ? 'PROCESSING' : 'READY',
            checksum: image.checksum,
          },
          select: { id: true },
        });
        await requestRevalidation(tx, await this.processing.tagsOf(tx, id));
        await recordAudit(tx, actor, {
          action: 'media.replace',
          entity: 'Media',
          entityId: id,
          label: `A remplacé l’image « ${current.fileName} » par « ${image.fileName} »`,
          after: {
            mimeType: image.type.mimeType,
            width: image.prepared.width,
            height: image.prepared.height,
          },
        });
      });
    } catch (error) {
      await this.removeQuietly([storageKey]);
      throw error;
    }
    await this.processing.scheduleCleanup([current.storageKey, ...variantKeys(current.variants)]);
    if (processing) await this.processing.enqueueVariants(id, storageKey);
    return this.detail(id);
  }

  /** `PATCH /v1/admin/media/{id}` : texte alternatif et point focal (`null` : centré). */
  async update(id: string, patch: UpdateMediaInput, actor: AuditActor): Promise<AdminMedia> {
    const current = await this.prisma.media.findUnique({ where: { id }, select: { fileName: true } });
    if (current === null) throw notFoundException(MEDIA_NOT_FOUND);
    await this.prisma.$transaction(async (tx) => {
      await tx.media.update({
        where: { id },
        data: {
          ...(patch.alt === undefined ? {} : { alt: patch.alt }),
          ...(patch.focalPoint === undefined
            ? {}
            : { focalX: patch.focalPoint?.x ?? null, focalY: patch.focalPoint?.y ?? null }),
        },
        select: { id: true },
      });
      await requestRevalidation(tx, await this.processing.tagsOf(tx, id));
      await recordAudit(tx, actor, {
        action: 'media.update',
        entity: 'Media',
        entityId: id,
        label: `A modifié l’image « ${current.fileName} »`,
        after: {
          fields: [
            ...(patch.alt === undefined ? [] : ['alt']),
            ...(patch.focalPoint === undefined ? [] : ['focalPoint']),
          ],
        },
      });
    });
    return this.detail(id);
  }

  /**
   * `DELETE /v1/admin/media/{id}` : usages recalculés sur les contenus (brouillons compris) et relations directes ;
   * utilisé → 409 `media-in-use`. Les fichiers sont supprimés après la validation de la transaction.
   */
  async remove(id: string, actor: AuditActor): Promise<void> {
    const row = await this.prisma.media.findUnique({ where: { id }, select: ADMIN_MEDIA_SELECT });
    if (row === null) throw notFoundException(MEDIA_NOT_FOUND);
    const usages = [
      ...(await collectAllUsages(this.prisma)).filter((entry) => entry.mediaId === id),
      ...liveForeignUsages(id, row),
    ];
    if (usages.length > 0) throw mediaInUseException([...new Set(usages.map((usage) => usage.label))]);
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.mediaUsage.deleteMany({ where: { mediaId: id } });
        await tx.media.delete({ where: { id }, select: { id: true } });
        await recordAudit(tx, actor, {
          action: 'media.delete',
          entity: 'Media',
          entityId: id,
          label: `A supprimé l’image « ${row.fileName} »`,
        });
      });
    } catch (error) {
      // Référence par clé étrangère non prévue ci-dessus (contenu ajouté entre-temps, nouveau module).
      if (isForeignKeyViolation(error)) throw mediaInUseException(['un autre contenu du site']);
      throw error;
    }
    await this.removeQuietly([row.storageKey, ...variantKeys(row.variants)]);
  }
}

/** Clés des variantes enregistrées dans la colonne `variants`. */
function variantKeys(value: Prisma.JsonValue): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((variant) =>
    typeof variant === 'object' &&
    variant !== null &&
    !Array.isArray(variant) &&
    typeof variant['storageKey'] === 'string'
      ? [variant['storageKey']]
      : [],
  );
}
