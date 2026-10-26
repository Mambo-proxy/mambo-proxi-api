/**
 * Double en mémoire de `PrismaService` pour les tests e2e des lectures publiques : il évalue le sous-ensemble des
 * filtres, tris et sélections utilisés par les modules (égalité, `in`, `notIn`, `not`, `lt`/`lte`/`gt`/`gte`, `AND`,
 * `OR`, filtres sur une relation, `orderBy` y compris sur une relation, `take`, `where`/`orderBy`/`take` des listes
 * sélectionnées). Les enregistrements portent leurs relations sous forme d'objets (graphe en mémoire) ; les colonnes
 * simples sont toutes renvoyées, les relations seulement si elles sont sélectionnées.
 *
 * Écritures (formulaires publics) : `create`, `createMany`, `update`, `upsert` (avec `{ increment }`), `deleteMany`,
 * `aggregate` (`_sum`), `count` ; `$transaction(fn)` exécute `fn` sur le double lui-même (pas d'annulation). Les
 * enregistrements créés reçoivent un identifiant `<table>_<n>` et des dates `createdAt`/`updatedAt` si absentes.
 */
import { vi } from 'vitest';

type Row = Record<string, unknown>;
type Args = { where?: Row; orderBy?: unknown; take?: number; select?: Row; include?: Row };
type WriteArgs = Args & {
  data?: Row | Row[];
  create?: Row;
  update?: Row;
  skipDuplicates?: boolean;
  _sum?: Row;
};

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

let idSequence = 0;

/** Applique les valeurs d'une écriture (`{ increment }`, `{ set }` ou valeur simple) à un enregistrement. */
function applyData(record: Row, data: Row): void {
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    if (isObject(value) && Object.keys(value).length === 1 && 'increment' in value) {
      record[key] = ((record[key] as number | null | undefined) ?? 0) + (value['increment'] as number);
    } else if (isObject(value) && Object.keys(value).length === 1 && 'set' in value) {
      record[key] = value['set'];
    } else {
      record[key] = value;
    }
  }
}

function delegate(name: string, rows: () => Row[]) {
  const insert = (data: Row): Row => {
    idSequence += 1;
    const now = new Date();
    const record: Row = { id: `${name}_${String(idSequence)}`, createdAt: now, updatedAt: now };
    applyData(record, data);
    rows().push(record);
    return record;
  };
  const update = (record: Row, data: Row): Row => {
    applyData(record, data);
    if (!('updatedAt' in data)) record['updatedAt'] = new Date();
    return record;
  };
  return {
    findMany: vi.fn((args?: Args) => Promise.resolve(findRows(rows(), args))),
    findFirst: vi.fn((args?: Args) => Promise.resolve(findRows(rows(), args)[0] ?? null)),
    findUnique: vi.fn((args?: Args) => Promise.resolve(findRows(rows(), args)[0] ?? null)),
    count: vi.fn((args?: Args) =>
      Promise.resolve(rows().filter((row) => matchesWhere(row, args?.where)).length),
    ),
    create: vi.fn((args: WriteArgs) =>
      Promise.resolve(project(insert(args.data as Row), args.select ?? args.include)),
    ),
    createMany: vi.fn((args: WriteArgs) => {
      const data = Array.isArray(args.data) ? args.data : [args.data as Row];
      data.forEach((item) => insert(item));
      return Promise.resolve({ count: data.length });
    }),
    update: vi.fn((args: WriteArgs) => {
      const record = rows().find((row) => matchesWhere(row, args.where));
      if (!record)
        return Promise.reject(new Error(`Double Prisma : ${name} introuvable pour la mise à jour.`));
      return Promise.resolve(project(update(record, args.data as Row), args.select ?? args.include));
    }),
    upsert: vi.fn((args: WriteArgs) => {
      const existing = rows().find((row) => matchesWhere(row, args.where));
      const record = existing ? update(existing, args.update ?? {}) : insert(args.create ?? {});
      return Promise.resolve(project(record, args.select ?? args.include));
    }),
    deleteMany: vi.fn((args?: Args) => {
      const table = rows();
      const kept = table.filter((row) => !matchesWhere(row, args?.where));
      const count = table.length - kept.length;
      table.splice(0, table.length, ...kept);
      return Promise.resolve({ count });
    }),
    aggregate: vi.fn((args: WriteArgs) => {
      const matching = rows().filter((row) => matchesWhere(row, args.where));
      const sums: Row = {};
      for (const field of Object.keys(args._sum ?? {})) {
        const values = matching
          .map((row) => row[field])
          .filter((value): value is number => typeof value === 'number');
        sums[field] = values.length > 0 ? values.reduce((total, value) => total + value, 0) : null;
      }
      return Promise.resolve({ _sum: sums });
    }),
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
  // Tables des formulaires publics (facultatives : vides par défaut).
  user?: Row[];
  training?: Row[];
  event?: Row[];
  contact?: Row[];
  contactInterest?: Row[];
  subscriber?: Row[];
  referenceCounter?: Row[];
  request?: Row[];
  requestEvent?: Row[];
  notification?: Row[];
}

const OPTIONAL_TABLES = [
  'user',
  'training',
  'event',
  'contact',
  'contactInterest',
  'subscriber',
  'referenceCounter',
  'request',
  'requestEvent',
  'notification',
] as const;

/** Double à passer à `overrideProvider(PrismaService).useValue(…)`. */
export function createPrismaDouble(tables: PrismaTables) {
  for (const name of OPTIONAL_TABLES) tables[name] ??= [];
  const table = (name: keyof PrismaTables) => (): Row[] => tables[name] ?? [];
  const double = {
    setting: delegate('setting', table('setting')),
    media: delegate('media', table('media')),
    category: delegate('category', table('category')),
    service: delegate('service', table('service')),
    review: delegate('review', table('review')),
    page: delegate('page', table('page')),
    zone: delegate('zone', table('zone')),
    redirect: delegate('redirect', table('redirect')),
    jobOffer: delegate('jobOffer', table('jobOffer')),
    user: delegate('user', table('user')),
    training: delegate('training', table('training')),
    event: delegate('event', table('event')),
    contact: delegate('contact', table('contact')),
    contactInterest: delegate('contactInterest', table('contactInterest')),
    subscriber: delegate('subscriber', table('subscriber')),
    referenceCounter: delegate('referenceCounter', table('referenceCounter')),
    request: delegate('request', table('request')),
    requestEvent: delegate('requestEvent', table('requestEvent')),
    notification: delegate('notification', table('notification')),
    $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
    $disconnect: vi.fn().mockResolvedValue(undefined),
    $transaction: vi.fn((operation: unknown): Promise<unknown> => {
      if (typeof operation === 'function')
        return Promise.resolve((operation as (tx: unknown) => unknown)(double));
      return Promise.all(operation as Promise<unknown>[]);
    }),
  };
  return double;
}
