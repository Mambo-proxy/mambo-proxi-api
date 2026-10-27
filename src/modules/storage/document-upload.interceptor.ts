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
import { MAX_DOCUMENT_SIZE, fileTooLargeException } from './storage.service.js';

/**
 * Lecture du corps `multipart/form-data` de `POST /v1/job-applications` (multer, en mémoire) : un seul fichier, champ
 * `cv`, 5 Mo au plus (au-delà → 413 `file-too-large`, avant toute autre vérification), champs texte limités.
 * Les autres refus de multer (champ de fichier inattendu, trop de champs, corps mal formé) → 400.
 */
const MultipartCv = FileInterceptor('cv', {
  limits: {
    fileSize: MAX_DOCUMENT_SIZE,
    files: 1,
    fields: 20,
    parts: 21,
    fieldSize: 16 * 1024,
    fieldNameSize: 100,
  },
});

function toProblem(error: unknown): unknown {
  if (error instanceof ProblemException) return error;
  if (error instanceof PayloadTooLargeException) return fileTooLargeException();
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
export class CvUploadInterceptor extends MultipartCv implements NestInterceptor {
  override async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    try {
      return await super.intercept(context, next);
    } catch (error) {
      throw toProblem(error);
    }
  }
}
