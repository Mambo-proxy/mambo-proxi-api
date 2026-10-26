import type { z } from 'zod';
import type { ProblemFieldError } from '../problem/problem.js';

type Issue = z.core.$ZodIssue;

interface IssueDescription {
  code: string;
  message: string;
}

const REQUIRED: IssueDescription = { code: 'required', message: 'Ce champ est obligatoire.' };

function plural(count: number | bigint, singular: string, pluralForm: string): string {
  return `${String(count)} ${Number(count) > 1 ? pluralForm : singular}`;
}

function describeInvalidType(issue: Extract<Issue, { code: 'invalid_type' }>): IssueDescription {
  if (issue.input === undefined) return REQUIRED;
  switch (issue.expected) {
    case 'number':
    case 'int':
    case 'bigint':
      return { code: 'invalid_type', message: 'Saisissez un nombre.' };
    case 'boolean':
      return { code: 'invalid_type', message: 'Indiquez oui ou non.' };
    case 'string':
      return { code: 'invalid_type', message: 'Saisissez un texte.' };
    case 'date':
      return { code: 'invalid_date', message: 'Saisissez une date valide.' };
    case 'array':
      return { code: 'invalid_type', message: 'Une liste de valeurs est attendue.' };
    default:
      return { code: 'invalid_type', message: 'Valeur invalide.' };
  }
}

function describeInvalidFormat(issue: Extract<Issue, { code: 'invalid_format' }>): IssueDescription {
  switch (issue.format) {
    case 'email':
      return { code: 'invalid_email', message: 'Saisissez une adresse e-mail valide.' };
    case 'url':
      return { code: 'invalid_url', message: 'Saisissez une adresse web valide.' };
    case 'datetime':
    case 'date':
    case 'time':
      return { code: 'invalid_date', message: 'Saisissez une date valide.' };
    case 'uuid':
    case 'cuid':
    case 'cuid2':
    case 'ulid':
      return { code: 'invalid_id', message: 'Identifiant invalide.' };
    default:
      return { code: 'invalid_format', message: "Le format n'est pas valide." };
  }
}

function describeTooSmall(issue: Extract<Issue, { code: 'too_small' }>): IssueDescription {
  const min = issue.minimum;
  switch (issue.origin) {
    case 'string':
      if (issue.exact) {
        return {
          code: 'invalid_length',
          message: `Saisissez exactement ${plural(min, 'caractère', 'caractères')}.`,
        };
      }
      if (Number(min) <= 1) return REQUIRED;
      return { code: 'too_short', message: `Saisissez au moins ${plural(min, 'caractère', 'caractères')}.` };
    case 'array':
    case 'set':
      if (Number(min) <= 1) return { code: 'too_few', message: 'Sélectionnez au moins un élément.' };
      return { code: 'too_few', message: `Sélectionnez au moins ${plural(min, 'élément', 'éléments')}.` };
    case 'date':
      return { code: 'too_early', message: 'Cette date est trop ancienne.' };
    case 'file':
      return { code: 'file_too_small', message: 'Le fichier est vide ou trop petit.' };
    default:
      return issue.inclusive === false
        ? { code: 'too_small', message: `La valeur doit être supérieure à ${String(min)}.` }
        : { code: 'too_small', message: `La valeur doit être supérieure ou égale à ${String(min)}.` };
  }
}

function describeTooBig(issue: Extract<Issue, { code: 'too_big' }>): IssueDescription {
  const max = issue.maximum;
  switch (issue.origin) {
    case 'string':
      if (issue.exact) {
        return {
          code: 'invalid_length',
          message: `Saisissez exactement ${plural(max, 'caractère', 'caractères')}.`,
        };
      }
      return { code: 'too_long', message: `Saisissez au plus ${plural(max, 'caractère', 'caractères')}.` };
    case 'array':
    case 'set':
      return { code: 'too_many', message: `Sélectionnez au plus ${plural(max, 'élément', 'éléments')}.` };
    case 'date':
      return { code: 'too_late', message: 'Cette date est trop lointaine.' };
    case 'file':
      return { code: 'file_too_large', message: 'Le fichier est trop volumineux.' };
    default:
      return issue.inclusive === false
        ? { code: 'too_big', message: `La valeur doit être inférieure à ${String(max)}.` }
        : { code: 'too_big', message: `La valeur doit être inférieure ou égale à ${String(max)}.` };
  }
}

/**
 * Code stable et message par défaut, en français, d'une erreur zod.
 * Les messages fixés dans un schéma (`{ error: '…' }`) restent prioritaires.
 */
export function describeIssue(issue: Issue): IssueDescription {
  switch (issue.code) {
    case 'invalid_type':
      return describeInvalidType(issue);
    case 'invalid_format':
      return describeInvalidFormat(issue);
    case 'too_small':
      return describeTooSmall(issue);
    case 'too_big':
      return describeTooBig(issue);
    case 'invalid_value':
      // Case à cocher obligatoire (`z.literal(true)`) : non cochée = champ obligatoire.
      if (issue.input === undefined || (issue.values.length === 1 && issue.values[0] === true))
        return REQUIRED;
      return { code: 'invalid_choice', message: 'Choisissez une valeur parmi celles proposées.' };
    case 'unrecognized_keys':
      return { code: 'unknown_field', message: "Ce champ n'est pas attendu." };
    case 'not_multiple_of':
      return {
        code: 'not_multiple_of',
        message: `La valeur doit être un multiple de ${String(issue.divisor)}.`,
      };
    case 'custom': {
      const code: unknown = issue.params?.['code'];
      return { code: typeof code === 'string' ? code : 'invalid', message: 'Valeur invalide.' };
    }
    default:
      return { code: 'invalid', message: 'Valeur invalide.' };
  }
}

/** Table de messages en français à passer à `safeParse(…, { error: frenchErrorMap })`. */
export const frenchErrorMap: z.core.$ZodErrorMap = (issue) =>
  describeIssue(issue as unknown as Issue).message;

/** Chemin d'un champ en notation pointée (`contact.email`, `items.0.label`). */
export function formatIssuePath(path: readonly PropertyKey[]): string {
  return path
    .map((segment) => (typeof segment === 'symbol' ? (segment.description ?? '') : String(segment)))
    .join('.');
}

/**
 * Convertit les erreurs zod en erreurs de champ du contrat (`errors[]`).
 * Les valeurs saisies ne sont jamais recopiées (aucune donnée personnelle dans les réponses ni les journaux).
 */
export function issuesToProblemErrors(issues: readonly Issue[]): ProblemFieldError[] {
  return issues.flatMap((issue): ProblemFieldError[] => {
    const { code } = describeIssue(issue);
    if (issue.code === 'unrecognized_keys') {
      return issue.keys.map((key) => ({
        path: formatIssuePath([...issue.path, key]),
        code,
        message: issue.message,
      }));
    }
    return [{ path: formatIssuePath(issue.path), code, message: issue.message }];
  });
}
