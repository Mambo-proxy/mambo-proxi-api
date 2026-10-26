import { HttpStatus } from '@nestjs/common';
import type { ErrorRequestHandler } from 'express';
import { ProblemException } from './problem.js';

function isJsonParseError(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && 'type' in error && error.type === 'entity.parse.failed'
  );
}

/**
 * Placé juste après l'analyseur JSON : un corps illisible devient le problème `invalid-body` du contrat
 * (sans cela, NestJS le convertit en 400 générique avec le message anglais de l'analyseur).
 */
export const mapBodyParserErrors: ErrorRequestHandler = (error: unknown, _request, _response, next) => {
  next(
    isJsonParseError(error)
      ? new ProblemException({
          status: HttpStatus.BAD_REQUEST,
          type: 'invalid-body',
          title: 'Requête invalide',
          detail: "Le contenu envoyé n'est pas un JSON valide.",
        })
      : error,
  );
};
