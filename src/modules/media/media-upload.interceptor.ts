import {
  BadRequestException,
  HttpStatus,
  Injectable,
  PayloadTooLargeException,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Observable } from 'rxjs';
import { ProblemException } from '../../common/problem/problem.js';

/** Taille maximale d'une image envoyée à la médiathèque : 10 Mo (contrat). */
export const MAX_MEDIA_SIZE = 10 * 1024 * 1024;

/** 413 `file-too-large` des envois de la médiathèque. */
export function mediaTooLargeException(): ProblemException {
  return new ProblemException({
    status: HttpStatus.PAYLOAD_TOO_LARGE,
    type: 'file-too-large',
    title: 'Fichier trop volumineux',
    detail: 'L’image dépasse 10 Mo. Réduisez-la avant de l’envoyer.',
  });
}

/**
 * Corps `multipart/form-data` de `POST /v1/admin/media` et `PUT /v1/admin/media/{id}/file` (multer, en mémoire) : un
 * seul fichier, champ `file`, 10 Mo au plus (au-delà → 413 avant toute autre vérification), champs texte limités
 * (`alt`). Les autres refus de multer (champ de fichier inattendu, corps mal formé) → 400.
 */
const MultipartImage = FileInterceptor('file', {
  limits: {
    fileSize: MAX_MEDIA_SIZE,
    files: 1,
    fields: 5,
    parts: 6,
    fieldSize: 4 * 1024,
    fieldNameSize: 100,
  },
});

function toProblem(error: unknown): unknown {
  if (error instanceof ProblemException) return error;
  if (error instanceof PayloadTooLargeException) return mediaTooLargeException();
  if (error instanceof BadRequestException)
    return new ProblemException({
      status: HttpStatus.BAD_REQUEST,
      type: 'bad-request',
      title: 'Requête invalide',
      detail: 'Le formulaire envoyé est incomplet ou mal formé. Rechargez la page puis réessayez.',
    });
  return error;
}

@Injectable()
export class MediaUploadInterceptor extends MultipartImage implements NestInterceptor {
  override async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    try {
      return await super.intercept(context, next);
    } catch (error) {
      throw toProblem(error);
    }
  }
}
