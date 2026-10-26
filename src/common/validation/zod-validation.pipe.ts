import { HttpStatus, type ArgumentMetadata, type PipeTransform } from '@nestjs/common';
import type { z } from 'zod';
import { ProblemException, type ProblemInit } from '../problem/problem.js';
import { frenchErrorMap, issuesToProblemErrors } from './zod-issues.js';

export interface ZodValidationPipeOptions {
  /** Remplace le type, le titre, le détail ou le statut par défaut (ex. « Recherche invalide »). */
  problem?: Partial<Omit<ProblemInit, 'errors'>>;
}

/**
 * Corps invalide → 422 `validation-error` (réponse `ValidationError` du contrat).
 * Paramètres d'adresse ou de requête invalides → 400 `invalid-query` (ex. `GET /v1/search`).
 */
const DEFAULT_PROBLEMS: Record<'body' | 'other', Omit<ProblemInit, 'errors'>> = {
  body: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    type: 'validation-error',
    title: 'Certaines informations sont à corriger',
    detail: 'Vérifiez les champs signalés puis renvoyez le formulaire.',
  },
  other: {
    status: HttpStatus.BAD_REQUEST,
    type: 'invalid-query',
    title: 'Requête invalide',
    detail: 'Vérifiez les paramètres de la requête.',
  },
};

/**
 * Valide et transforme une entrée avec un schéma zod.
 *
 * @example
 * create(@Body(new ZodValidationPipe(createQuoteSchema)) body: CreateQuote) { … }
 */
export class ZodValidationPipe<TSchema extends z.ZodType> implements PipeTransform<
  unknown,
  Promise<z.output<TSchema>>
> {
  constructor(
    private readonly schema: TSchema,
    private readonly options: ZodValidationPipeOptions = {},
  ) {}

  async transform(value: unknown, metadata: ArgumentMetadata): Promise<z.output<TSchema>> {
    const result = await this.schema.safeParseAsync(value, { error: frenchErrorMap, reportInput: true });
    if (result.success) return result.data;

    const defaults = DEFAULT_PROBLEMS[metadata.type === 'body' ? 'body' : 'other'];
    throw new ProblemException({
      ...defaults,
      ...this.options.problem,
      errors: issuesToProblemErrors(result.error.issues),
    });
  }
}
