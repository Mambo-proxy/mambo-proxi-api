import { HttpException, HttpStatus } from '@nestjs/common';

/** Base des identifiants `type` des erreurs (voir `components.schemas.Problem` du contrat). */
export const PROBLEM_TYPE_BASE_URL = 'https://api.mamboproxi.com/problems/';

export const PROBLEM_CONTENT_TYPE = 'application/problem+json; charset=utf-8';

/** Erreur sur un champ : chemin en notation pointée et message en français prêt à afficher. */
export interface ProblemFieldError {
  path: string;
  code?: string;
  message: string;
}

/** Corps d'une réponse d'erreur au format RFC 9457 (schéma `Problem` du contrat). */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  errors?: ProblemFieldError[];
}

export interface ProblemInit {
  status: number;
  /** Identifiant court (`slot-taken`) ou URI complète. */
  type: string;
  title: string;
  detail?: string;
  errors?: ProblemFieldError[];
}

export function problemTypeUri(type: string): string {
  return /^https?:\/\//.test(type) ? type : `${PROBLEM_TYPE_BASE_URL}${type}`;
}

export function createProblem(init: ProblemInit): ProblemDetails {
  const problem: ProblemDetails = { type: problemTypeUri(init.type), title: init.title, status: init.status };
  if (init.detail !== undefined) problem.detail = init.detail;
  if (init.errors !== undefined && init.errors.length > 0) problem.errors = init.errors;
  return problem;
}

/**
 * Exception métier rendue telle quelle par le filtre global : à utiliser pour toute erreur
 * dont le message doit être affiché à l'utilisateur.
 */
export class ProblemException extends HttpException {
  readonly problem: ProblemDetails;

  constructor(init: ProblemInit) {
    const problem = createProblem(init);
    super(problem, problem.status);
    this.problem = problem;
  }
}

interface StatusProblem {
  type: string;
  title: string;
  detail?: string;
}

/** Textes par défaut, en français, des erreurs HTTP courantes (aucun détail interne). */
const STATUS_PROBLEMS: Partial<Record<number, StatusProblem>> = {
  [HttpStatus.BAD_REQUEST]: {
    type: 'bad-request',
    title: 'Requête invalide',
    detail: 'La requête envoyée est incorrecte.',
  },
  [HttpStatus.UNAUTHORIZED]: {
    type: 'unauthorized',
    title: 'Session expirée',
    detail: 'Veuillez vous reconnecter.',
  },
  [HttpStatus.FORBIDDEN]: {
    type: 'forbidden',
    title: 'Action non autorisée',
    detail: "Vous n'avez pas les droits nécessaires pour effectuer cette action.",
  },
  [HttpStatus.NOT_FOUND]: {
    type: 'not-found',
    title: 'Introuvable',
    detail: "La ressource demandée n'existe pas ou n'est plus disponible.",
  },
  [HttpStatus.METHOD_NOT_ALLOWED]: {
    type: 'method-not-allowed',
    title: 'Méthode non autorisée',
    detail: "Cette opération n'est pas disponible à cette adresse.",
  },
  [HttpStatus.CONFLICT]: {
    type: 'conflict',
    title: 'Conflit',
    detail: 'Cet élément a été modifié entre-temps.',
  },
  [HttpStatus.PAYLOAD_TOO_LARGE]: {
    type: 'payload-too-large',
    title: 'Envoi trop volumineux',
    detail: 'Le contenu envoyé dépasse la taille autorisée.',
  },
  [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: {
    type: 'unsupported-media-type',
    title: 'Format non pris en charge',
    detail: "Le format du contenu envoyé n'est pas accepté.",
  },
  [HttpStatus.UNPROCESSABLE_ENTITY]: {
    type: 'validation-error',
    title: 'Certaines informations sont à corriger',
    detail: 'Vérifiez les champs signalés puis renvoyez le formulaire.',
  },
  [HttpStatus.TOO_MANY_REQUESTS]: {
    type: 'rate-limited',
    title: 'Trop de tentatives',
    detail: 'Vous avez effectué trop de demandes. Réessayez dans quelques minutes.',
  },
  [HttpStatus.INTERNAL_SERVER_ERROR]: {
    type: 'internal-error',
    title: 'Erreur interne',
    detail: "Une erreur inattendue s'est produite. Réessayez dans quelques instants.",
  },
  [HttpStatus.SERVICE_UNAVAILABLE]: {
    type: 'service-unavailable',
    title: 'Service indisponible',
    detail: 'Le service est momentanément indisponible. Réessayez dans quelques instants.',
  },
};

/** Problème par défaut pour un code HTTP d'erreur (400 à 599). */
export function problemForStatus(status: number): ProblemDetails {
  const known = STATUS_PROBLEMS[status];
  if (known) return createProblem({ status, ...known });
  if (status >= 500) {
    return createProblem({ ...STATUS_PROBLEMS[HttpStatus.INTERNAL_SERVER_ERROR]!, status });
  }
  return createProblem({ status, type: 'request-rejected', title: 'Requête refusée' });
}
