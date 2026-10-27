import { HttpStatus, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { jobApplicationInputSchema } from './job.schemas.js';

/** Champs du formulaire `multipart/form-data` et fichier `cv` (lu par `CvUploadInterceptor`), validés ensemble. */
export const ApplicationForm = createParamDecorator((_data: unknown, context: ExecutionContext): unknown => {
  const request = context.switchToHttp().getRequest<Request & { file?: unknown }>();
  const fields: unknown = request.body;
  return {
    ...(typeof fields === 'object' && fields !== null ? fields : {}),
    cv: request.file,
  };
});

/** Corps invalide → 422 `validation-error` (le décorateur n'est pas `@Body()` : réglage explicite du problème). */
export const APPLICATION_PIPE = new ZodValidationPipe(jobApplicationInputSchema, {
  problem: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    type: 'validation-error',
    title: 'Certaines informations sont à corriger',
    detail: 'Vérifiez les champs signalés puis renvoyez le formulaire.',
  },
});
