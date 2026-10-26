import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  PROBLEM_CONTENT_TYPE,
  ProblemException,
  createProblem,
  problemForStatus,
  type ProblemDetails,
} from './problem.js';

/** Erreur levée par l'analyse du corps (body-parser) : objet `http-errors` avec `status` et `type`. */
interface BodyParserError {
  status: number;
  type: string;
}

function isBodyParserError(exception: unknown): exception is BodyParserError {
  if (typeof exception !== 'object' || exception === null) return false;
  const candidate = exception as Partial<Record<keyof BodyParserError, unknown>>;
  return (
    typeof candidate.status === 'number' &&
    typeof candidate.type === 'string' &&
    candidate.status >= 400 &&
    candidate.status < 500
  );
}

/**
 * Filtre global : toute erreur devient une réponse `application/problem+json` (RFC 9457) conforme au
 * schéma `Problem` du contrat, avec des messages en français. Les erreurs 5xx ne révèlent aucun détail
 * interne (le détail est journalisé côté serveur).
 */
@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const problem = this.toProblem(exception);

    if (problem.status >= 500) {
      this.logger.error(exception instanceof Error ? exception : new Error('Exception non standard levée'));
    }

    if (response.headersSent) {
      response.end();
      return;
    }
    response.status(problem.status);
    response.setHeader('Content-Type', PROBLEM_CONTENT_TYPE);
    response.send(JSON.stringify(problem));
  }

  toProblem(exception: unknown): ProblemDetails {
    if (exception instanceof ProblemException) return { ...exception.problem };

    if (exception instanceof HttpException) return problemForStatus(exception.getStatus());

    if (isBodyParserError(exception)) {
      if (exception.type === 'entity.parse.failed') {
        return createProblem({
          status: HttpStatus.BAD_REQUEST,
          type: 'invalid-body',
          title: 'Requête invalide',
          detail: "Le contenu envoyé n'est pas un JSON valide.",
        });
      }
      return problemForStatus(exception.status);
    }

    return problemForStatus(HttpStatus.INTERNAL_SERVER_ERROR);
  }
}
