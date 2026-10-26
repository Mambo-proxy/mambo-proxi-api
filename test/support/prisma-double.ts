/**
 * Double en mémoire de `PrismaService` pour les tests e2e des lectures publiques : il évalue le sous-ensemble des
 * filtres, tris et sélections utilisés par les modules (égalité, `in`, `notIn`, `not`, `lt`/`lte`/`gt`/`gte`, `AND`,
 * `OR`, filtres sur une relation, `orderBy` y compris sur une relation, `take`, `where`/`orderBy`/`take` des listes
 * sélectionnées). Les enregistrements portent leurs relations sous forme d'objets (graphe en mémoire) ; les colonnes
 * simples sont toutes renvoyées, les relations seulement si elles sont sélectionnées.
 */
import { vi } from 'vitest';

type Row = Record<string, unknown>;
type Args = { where?: Row; orderBy?: unknown; take?: number; select?: Row; include?: Row };

/** Champs des enregistrements du double qui sont des relations (les autres, JSON compris, sont des colonnes). */
const RELATIONS = new Set([
  'category',
  'services',
  'coverImage',
  'image',
  'gallery',
  'media',
  'offers',
  'related',
  'relatedService',
  'featuredReviews',
  'review',
  'testimonial',
  'offerSections',
  'targetService',
  'service',
  'quarters',
]);

const OPERATORS = new Set(['equals', 'in', 'notIn', 'not', 'lt', 'lte', 'gt', 'gte']);

function isObject(value: unknown): value is Row {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date);
}

function comparable(value: unknown): unknown {
  return value instanceof Date ? value.getTime() : value;
}

function isOperatorObject(value: Row): boolean {
  const keys = Object.keys(value);
  return keys.length > 0 && keys.every((key) => OPERATORS.has(key));
}

function matchesOperators(actual: unknown, filter: Row): boolean {
  const value = comparable(actual);
  return Object.entries(filter).every(([operator, expected]) => {
    const target = comparable(expected);
    switch (operator) {
      case 'equals':
        return value === target;
      case 'in':
        return (expected as unknown[]).map(comparable).includes(value);
      case 'notIn':
        return !(expected as unknown[]).map(comparable).includes(value);
      case 'not':
        return isObject(expected) ? !matchesOperators(actual, expected) : value !== target;
      case 'lt':
        return value !== null && value !== undefined && (value as number) < (target as number);
      case 'lte':
        return value !== null && value !== undefined && (value as number) <= (target as number);
      case 'gt':
        return value !== null && value !== undefined && (value as number) > (target as number);
      case 'gte':
        return value !== null && value !== undefined && (value as number) >= (target as number);
      default:
        throw new Error(`Opérateur non pris en charge par le double : ${operator}`);
    }
  });
}

export function matchesWhere(record: Row, where: Row | undefined): boolean {
  if (where === undefined) return true;
  return Object.entries(where).every(([key, filter]) => {
    if (key === 'AND') return (filter as Row[]).every((part) => matchesWhere(record, part));
    if (key === 'OR') return (filter as Row[]).some((part) => matchesWhere(record, part));
    if (key === 'NOT') return !matchesWhere(record, filter as Row);
    const actual = record[key];
    if (isObject(filter)) {
      if (RELATIONS.has(key)) return isObject(actual) && matchesWhere(actual, filter);
      if (isOperatorObject(filter)) return matchesOperators(actual, filter);
      return false;
    }
    return comparable(actual) === comparable(filter);
  });
}

function compareValues(a: unknown, b: unknown): number {
  const left = comparable(a);
  const right = comparable(b);
  if (left === right) return 0;
  if (left === null || left === undefined) return 1;
  if (right === null || right === undefined) return -1;
  return (left as number | string) < (right as number | string) ? -1 : 1;
}

function compareBy(a: Row, b: Row, order: Row): number {
  for (const [key, direction] of Object.entries(order)) {
    const result = isObject(direction)
      ? compareBy((a[key] ?? {}) as Row, (b[key] ?? {}) as Row, direction)
      : compareValues(a[key], b[key]) * (direction === 'desc' ? -1 : 1);
    if (result !== 0) return result;
  }
  return 0;
}

function sortRows(rows: Row[], orderBy: unknown): Row[] {
  if (orderBy === undefined) return rows;
  const orders = (Array.isArray(orderBy) ? orderBy : [orderBy]) as Row[];
  return [...rows].sort((a, b) => {
    for (const order of orders) {
      const result = compareBy(a, b, order);
      if (result !== 0) return result;
    }
    return 0;
  });
}

function project(record: Row, selection: Row | undefined): Row {
  const result: Row = {};
  for (const [key, value] of Object.entries(record)) {
    // Relations seulement si elles sont sélectionnées.
    if (!RELATIONS.has(key)) result[key] = value;
  }
  for (const [key, args] of Object.entries(selection ?? {})) {
    if (args === false || args === undefined) continue;
    // Champ simple ou JSON sélectionné (`cities: true`, `translations: true`) : valeur telle quelle, déjà copiée.
    if (!RELATIONS.has(key)) continue;
    const related = record[key];
    if (Array.isArray(related)) {
      result[key] = findRows(related as Row[], args === true ? {} : (args as Args));
    } else if (isObject(related)) {
      const nested = args === true ? undefined : ((args as Args).select ?? (args as Args).include);
      result[key] = project(related, nested);
    } else if (related === null || related === undefined) {
      if (key in record) result[key] = related ?? null;
    }
  }
  return result;
}

function findRows(rows: readonly Row[], args: Args = {}): Row[] {
  const filtered = rows.filter((row) => matchesWhere(row, args.where));
  const sorted = sortRows(filtered, args.orderBy);
  const limited = args.take === undefined ? sorted : sorted.slice(0, args.take);
  return limited.map((row) => project(row, args.select ?? args.include));
}

function delegate(rows: () => readonly Row[]) {
  return {
    findMany: vi.fn((args?: Args) => Promise.resolve(findRows(rows(), args))),
    findFirst: vi.fn((args?: Args) => Promise.resolve(findRows(rows(), args)[0] ?? null)),
    findUnique: vi.fn((args?: Args) => Promise.resolve(findRows(rows(), args)[0] ?? null)),
  };
}

export interface PrismaTables {
  setting: Row[];
  media: Row[];
  category: Row[];
  service: Row[];
  review: Row[];
  page: Row[];
  zone: Row[];
  redirect: Row[];
  jobOffer: Row[];
}

/** Double à passer à `overrideProvider(PrismaService).useValue(…)`. */
export function createPrismaDouble(tables: PrismaTables) {
  return {
    setting: delegate(() => tables.setting),
    media: delegate(() => tables.media),
    category: delegate(() => tables.category),
    service: delegate(() => tables.service),
    review: delegate(() => tables.review),
    page: delegate(() => tables.page),
    zone: delegate(() => tables.zone),
    redirect: delegate(() => tables.redirect),
    jobOffer: delegate(() => tables.jobOffer),
    $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
    $disconnect: vi.fn().mockResolvedValue(undefined),
  };
}
