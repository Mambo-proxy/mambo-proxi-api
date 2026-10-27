import { Controller, Get, HttpStatus, Inject, Param, Res, StreamableFile } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ProblemException, notFoundException } from '../../common/problem/problem.js';
import { AppConfigService } from '../../config/app-config.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { Public } from '../auth/auth.decorators.js';
import { readDownloadToken } from './download-token.js';
import { downloadDisposition } from './file-name.js';
import { StorageService } from './storage.service.js';
import { ANONYMIZED_FILE_NAME } from './storage.types.js';

export const FILE_NOT_FOUND = 'Ce fichier n’existe pas ou n’est plus disponible.';

/** 410 `link-expired` : lien signé valable mais périmé (le back-office en redemande un). */
function linkExpiredException(): ProblemException {
  return new ProblemException({
    status: HttpStatus.GONE,
    type: 'link-expired',
    title: 'Lien expiré',
    detail: 'Ce lien de téléchargement a expiré. Relancez le téléchargement depuis le back-office.',
  });
}

/**
 * Téléchargement d'un fichier privé par lien signé (`SignedUrl` des routes `…/cv` et `…/attachments/{id}`) : route
 * publique pour la garde (le jeton HMAC de 5 minutes tient lieu de session), jamais mise en cache, fichier envoyé
 * en pièce jointe sous son nom assaini.
 */
@ApiTags('Site')
@Public()
@Controller('files')
export class FilesController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(StorageService) private readonly storage: StorageService,
    @Inject(AppConfigService) private readonly config: AppConfigService,
  ) {}

  @Get(':token')
  @ApiOperation({
    operationId: 'downloadFile',
    summary: 'Télécharger un fichier privé (lien signé de 5 min)',
  })
  async download(
    @Param('token') token: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const now = new Date();
    const claims =
      token.length <= 1024 ? readDownloadToken(this.config.get('TOKEN_SIGNING_SECRET'), token) : null;
    if (!claims) throw notFoundException(FILE_NOT_FOUND);
    if (claims.expiresAt.getTime() <= now.getTime()) throw linkExpiredException();
    const attachment = await this.prisma.attachment.findUnique({
      where: { id: claims.attachmentId },
      select: {
        storageKey: true,
        fileName: true,
        mimeType: true,
        request: { select: { anonymizedAt: true } },
      },
    });
    if (
      !attachment ||
      attachment.fileName === ANONYMIZED_FILE_NAME ||
      (attachment.request !== null && attachment.request.anonymizedAt !== null)
    )
      throw notFoundException(FILE_NOT_FOUND);
    const file = await this.storage.open(attachment.storageKey);
    if (!file) throw notFoundException(FILE_NOT_FOUND);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    return new StreamableFile(file.stream, {
      type: attachment.mimeType,
      length: file.size,
      disposition: downloadDisposition(attachment.fileName),
    });
  }
}
