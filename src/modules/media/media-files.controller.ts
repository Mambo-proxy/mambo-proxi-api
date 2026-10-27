import { Controller, Get, Inject, Param, Res, StreamableFile } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { notFoundException } from '../../common/problem/problem.js';
import { Public } from '../auth/auth.decorators.js';
import { MEDIA_CONTENT_TYPES, MEDIA_STORAGE, mediaFileKey, type MediaStorage } from './media-storage.js';

const MEDIA_FILE_NOT_FOUND = 'Cette image n’existe pas ou n’est plus disponible.';

/**
 * Fichiers publics de la médiathèque (`MediaImage.url`, `variants[].url`) : route publique, sans limitation de débit
 * (images des pages du site, optimiseur d'images du site, CDN). Seuls les noms produits par l'API sont acceptés
 * (dossier de 32 caractères hexadécimaux, `original.<ext>` ou `<largeur>.<avif|webp>`) et ils ne sont lus que dans
 * le stockage des médias (`MEDIA_STORAGE_DIR`), jamais dans celui des fichiers privés. Aucune lecture de la base :
 * un fichier existe tant que le média (ou sa version remplacée, 24 h) existe.
 */
@ApiTags('Site')
@Public()
@SkipThrottle()
@Controller('media')
export class MediaFilesController {
  constructor(@Inject(MEDIA_STORAGE) private readonly storage: MediaStorage) {}

  @Get(':folder/:file')
  @ApiOperation({
    operationId: 'getMediaFile',
    summary: 'Fichier public d’un média (original assaini ou variante)',
  })
  async file(
    @Param('folder') folder: string,
    @Param('file') file: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const key = mediaFileKey(folder, file);
    if (key === null) throw notFoundException(MEDIA_FILE_NOT_FOUND);
    const found = await this.storage.get(key);
    if (found === null) throw notFoundException(MEDIA_FILE_NOT_FOUND);
    const extension = file.slice(file.lastIndexOf('.') + 1);
    const type = MEDIA_CONTENT_TYPES[extension] ?? 'application/octet-stream';
    // Adresse propre à un contenu qui ne change jamais (un remplacement crée un nouveau dossier).
    response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    if (type === 'image/svg+xml')
      // SVG ouvert directement : aucun script, aucune ressource externe, même si l'assainissement laissait passer.
      response.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    return new StreamableFile(found.stream, { type, length: found.size });
  }
}
