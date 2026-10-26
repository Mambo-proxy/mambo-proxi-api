import { HttpStatus } from '@nestjs/common';
import { ProblemException, type ProblemFieldError } from '../problem/problem.js';

/**
 * 422 `validation-error` (réponse `ValidationError` du contrat) pour une règle vérifiée après la validation du
 * schéma (ex. rubrique inconnue, champ obligatoire selon la rubrique), avec les mêmes textes que `ZodValidationPipe`.
 */
export function validationException(errors: ProblemFieldError[]): ProblemException {
  return new ProblemException({
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    type: 'validation-error',
    title: 'Certaines informations sont à corriger',
    detail: 'Vérifiez les champs signalés puis renvoyez le formulaire.',
    errors,
  });
}
