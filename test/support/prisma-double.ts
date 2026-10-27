/**
 * Double en mémoire de `PrismaService` pour les tests e2e des lectures publiques : il évalue le sous-ensemble des
 * filtres, tris et sélections utilisés par les modules (égalité, `in`, `notIn`, `not`, `lt`/`lte`/`gt`/`gte`, `AND`,
 * `OR`, filtres sur une relation, `orderBy` y compris sur une relation, `take`, `where`/`orderBy`/`take` des listes
 * sélectionnées). Les enregistrements portent leurs relations sous forme d'objets (graphe en mémoire) ; les colonnes
 * simples sont toutes renvoyées, les relations seulement si elles sont sélectionnées.
 *
 * Écritures (formulaires publics, authentification) : `create`, `createMany`, `update`, `updateMany`, `upsert` (avec
 * `{ increment }`), `delete`, `deleteMany`, `aggregate` (`_sum`), `count`, `groupBy` (`_count._all`) ;
 * `$transaction(fn)` exécute `fn` sur le double lui-même (pas d'annulation). Les enregistrements créés reçoivent un
 * identifiant `<table>_<n>` et des dates `createdAt`/`updatedAt` si absentes. Une colonne absente vaut `null` pour
 * les filtres (`revokedAt: null`, `{ not: null }`), comme une colonne facultative jamais renseignée.
 *
 * Back-office (demandes, contacts) : les enregistrements créés n'ont que leurs clés étrangères ; les relations
 * déclarées dans `LINKS` sont alors retrouvées dans les autres tables (`request.contact` par `contactId`,
 * `contact.requests` par `request.contactId`…), pour les sélections, les filtres (`some`, `none`, `every`, `is`,
 * `isNot`, filtre direct) et `_count`. Opérateurs de texte : `contains`, `startsWith`, `endsWith` (avec
 * `mode: 'insensitive'`) ; pagination : `skip`.
 *
 * Contenus du back-office (services, rubriques, zones, pages) : mêmes relations par clé (`service.category` par
 * `categoryId`, `category.services`, `zone.quarters`…), y compris pour les tris sur une relation ; une ligne créée
 * par l'API est ainsi lue telle quelle par les lectures publiques.
 */
import { vi } from 'vitest';
import { Prisma } from '../../src/generated/prisma/client.js';

type Row = Record<string, unknown>;
type Args = { where?: Row; orderBy?: unknown; take?: number; skip?: number; select?: Row; include?: Row };
type WriteArgs = Args & {
  data?: Row | Row[];
  create?: Row;
  update?: Row;
  skipDuplicates?: boolean;
  _sum?: Row;
};
type GroupByArgs = { by: string[]; where?: Row; _count?: Row };

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

const OPERATORS = new Set([
  'equals',
  'in',
  'notIn',
  'not',
  'lt',
  'lte',
  'gt',
  'gte',
  'contains',
  'startsWith',
  'endsWith',
  'mode',
]);

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
  // Tables de l'authentification et des utilisateurs (facultatives : vides par défaut).
  session?: Row[];
  trustedDevice?: Row[];
  otpChallenge?: Row[];
  passwordReset?: Row[];
  invitation?: Row[];
  auditLog?: Row[];
  appointment?: Row[];
  requestNote?: Row[];
  // Tables des demandes du back-office (facultatives : vides par défaut).
  survey?: Row[];
  attachment?: Row[];
  jobApplication?: Row[];
  // Tables des contenus du back-office (facultatives : vides par défaut).
  serviceGalleryImage?: Row[];
  serviceRelation?: Row[];
  serviceFeaturedReview?: Row[];
  serviceOffer?: Row[];
  categoryOfferSection?: Row[];
  zoneQuarter?: Row[];
  emailTemplate?: Row[];
  revalidationRequest?: Row[];
  backupRun?: Row[];
}

type TableName = keyof PrismaTables;

/** Relation retrouvée par clé : `from` (colonne de l'enregistrement) = `to` (colonne de la table liée). */
interface Link {
  table: TableName;
  from: string;
  to: string;
  many?: boolean;
}

const toUser = (from: string): Link => ({ table: 'user', from, to: 'id' });

/** Relations des tables du back-office, lues dans les autres tables quand l'enregistrement ne les porte pas. */
const LINKS: Partial<Record<TableName, Record<string, Link>>> = {
  request: {
    contact: { table: 'contact', from: 'contactId', to: 'id' },
    assignedTo: toUser('assignedToId'),
    category: { table: 'category', from: 'categoryId', to: 'id' },
    service: { table: 'service', from: 'serviceId', to: 'id' },
    notes: { table: 'requestNote', from: 'id', to: 'requestId', many: true },
    history: { table: 'requestEvent', from: 'id', to: 'requestId', many: true },
    attachments: { table: 'attachment', from: 'id', to: 'requestId', many: true },
    survey: { table: 'survey', from: 'id', to: 'requestId' },
  },
  requestNote: { author: toUser('authorId') },
  requestEvent: { actor: toUser('actorId') },
  contact: {
    requests: { table: 'request', from: 'id', to: 'contactId', many: true },
    appointments: { table: 'appointment', from: 'id', to: 'contactId', many: true },
    interests: { table: 'contactInterest', from: 'id', to: 'contactId', many: true },
    subscriber: { table: 'subscriber', from: 'id', to: 'contactId' },
  },
  contactInterest: { category: { table: 'category', from: 'categoryId', to: 'id' } },
  appointment: {
    contact: { table: 'contact', from: 'contactId', to: 'id' },
    assignedTo: toUser('assignedToId'),
  },
  // Contenus créés par le back-office (les enregistrements des lectures publiques portent leurs relations).
  category: {
    services: { table: 'service', from: 'id', to: 'categoryId', many: true },
    image: { table: 'media', from: 'imageId', to: 'id' },
    testimonial: { table: 'review', from: 'testimonialId', to: 'id' },
    offerSections: { table: 'categoryOfferSection', from: 'id', to: 'categoryId', many: true },
  },
  categoryOfferSection: {
    offers: { table: 'serviceOffer', from: 'id', to: 'sectionId', many: true },
  },
  service: {
    category: { table: 'category', from: 'categoryId', to: 'id' },
    coverImage: { table: 'media', from: 'coverImageId', to: 'id' },
    gallery: { table: 'serviceGalleryImage', from: 'id', to: 'serviceId', many: true },
    offers: { table: 'serviceOffer', from: 'id', to: 'serviceId', many: true },
    related: { table: 'serviceRelation', from: 'id', to: 'serviceId', many: true },
    featuredReviews: { table: 'serviceFeaturedReview', from: 'id', to: 'serviceId', many: true },
    requests: { table: 'request', from: 'id', to: 'serviceId', many: true },
  },
  serviceGalleryImage: { media: { table: 'media', from: 'mediaId', to: 'id' } },
  serviceRelation: { relatedService: { table: 'service', from: 'relatedServiceId', to: 'id' } },
  serviceFeaturedReview: { review: { table: 'review', from: 'reviewId', to: 'id' } },
  serviceOffer: {
    image: { table: 'media', from: 'imageId', to: 'id' },
    targetService: { table: 'service', from: 'targetServiceId', to: 'id' },
  },
  review: { service: { table: 'service', from: 'serviceId', to: 'id' } },
  zone: { quarters: { table: 'zoneQuarter', from: 'id', to: 'zoneId', many: true } },
  page: { updatedBy: toUser('updatedById'), publishedBy: toUser('publishedById') },
};

/** Accès aux tables du double (relations retrouvées par clé). */
interface Graph {
  tables: PrismaTables;
}

function isObject(value: unknown): value is Row {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date);
}

function comparable(value: unknown): unknown {
  return value instanceof Date ? value.getTime() : value;
}

function linkOf(table: TableName | undefined, key: string): Link | undefined {
  return table === undefined ? undefined : LINKS[table]?.[key];
}

function isRelation(table: TableName | undefined, key: string): boolean {
  return RELATIONS.has(key) || linkOf(table, key) !== undefined;
}

/** Valeur d'une relation : portée par l'enregistrement (graphe) ou retrouvée par clé (`LINKS`). */
function related(graph: Graph | undefined, table: TableName | undefined, record: Row, key: string): unknown {
  if (record[key] !== undefined) return record[key];
  const link = linkOf(table, key);
  if (!link || !graph) return undefined;
  const rows = graph.tables[link.table] ?? [];
  const value = record[link.from];
  if (link.many)
    return value === null || value === undefined ? [] : rows.filter((row) => row[link.to] === value);
  if (value === null || value === undefined) return null;
  return rows.find((row) => row[link.to] === value) ?? null;
}

function isOperatorObject(value: Row): boolean {
  const keys = Object.keys(value);
  return keys.length > 0 && keys.every((key) => OPERATORS.has(key));
}

function matchesOperators(actual: unknown, filter: Row): boolean {
  const value = comparable(actual);
  const insensitive = filter['mode'] === 'insensitive';
  const text = (input: unknown): string | null =>
    typeof input === 'string' ? (insensitive ? input.toLowerCase() : input) : null;
  return Object.entries(filter).every(([operator, expected]) => {
    const target = comparable(expected);
    switch (operator) {
      case 'mode':
        return true;
      case 'contains':
        return text(actual)?.includes(text(expected) ?? '') ?? false;
      case 'startsWith':
        return text(actual)?.startsWith(text(expected) ?? '') ?? false;
      case 'endsWith':
        return text(actual)?.endsWith(text(expected) ?? '') ?? false;
      case 'equals':
        return value === target;
      case 'in':
        return (expected as unknown[]).map(comparable).includes(value);
      case 'notIn':
        return !(expected as unknown[]).map(comparable).includes(value);
      case 'not':
        if (expected === null) return value !== null && value !== undefined;
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

/** Filtre d'une relation : `some` / `none` / `every` (liste), `is` / `isNot` ou filtre direct (un seul lié). */
function matchesRelation(
  graph: Graph | undefined,
  table: TableName | undefined,
  value: unknown,
  filter: Row,
): boolean {
  if (Array.isArray(value)) {
    const rows = value as Row[];
    const test =
      (part: unknown) =>
      (row: Row): boolean =>
        matchesWhere(row, part as Row, graph, table);
    return Object.entries(filter).every(([operator, part]) => {
      if (operator === 'some') return rows.some(test(part));
      if (operator === 'none') return !rows.some(test(part));
      if (operator === 'every') return rows.every(test(part));
      throw new Error(`Filtre de liste non pris en charge par le double : ${operator}`);
    });
  }
  if ('is' in filter || 'isNot' in filter) {
    const check = (part: unknown): boolean =>
      part === null
        ? value === null || value === undefined
        : isObject(value) && matchesWhere(value, part as Row, graph, table);
    return (
      ('is' in filter ? check(filter['is']) : true) && ('isNot' in filter ? !check(filter['isNot']) : true)
    );
  }
  return isObject(value) && matchesWhere(value, filter, graph, table);
}

export function matchesWhere(record: Row, where: Row | undefined, graph?: Graph, table?: TableName): boolean {
  if (where === undefined) return true;
  return Object.entries(where).every(([key, filter]) => {
    if (key === 'AND') return (filter as Row[]).every((part) => matchesWhere(record, part, graph, table));
    if (key === 'OR') return (filter as Row[]).some((part) => matchesWhere(record, part, graph, table));
    if (key === 'NOT') {
      const parts = Array.isArray(filter) ? (filter as Row[]) : [filter as Row];
      return !parts.some((part) => matchesWhere(record, part, graph, table));
    }
    const relation = isRelation(table, key);
    const actual = relation ? related(graph, table, record, key) : record[key];
    if (filter === null) return actual === null || actual === undefined;
    if (isObject(filter)) {
      if (relation) return matchesRelation(graph, linkOf(table, key)?.table, actual, filter);
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

function compareBy(a: Row, b: Row, order: Row, graph?: Graph, table?: TableName): number {
  for (const [key, direction] of Object.entries(order)) {
    const result = isObject(direction)
      ? compareBy(
          (related(graph, table, a, key) ?? {}) as Row,
          (related(graph, table, b, key) ?? {}) as Row,
          direction,
          graph,
          linkOf(table, key)?.table,
        )
      : compareValues(a[key], b[key]) * (direction === 'desc' ? -1 : 1);
    if (result !== 0) return result;
  }
  return 0;
}

function sortRows(rows: Row[], orderBy: unknown, graph?: Graph, table?: TableName): Row[] {
  if (orderBy === undefined) return rows;
  const orders = (Array.isArray(orderBy) ? orderBy : [orderBy]) as Row[];
  return [...rows].sort((a, b) => {
    for (const order of orders) {
      const result = compareBy(a, b, order, graph, table);
      if (result !== 0) return result;
    }
    return 0;
  });
}

/** `_count: { select: { requests: true | { where } } }` : nombre d'enregistrements liés. */
function countRelations(
  graph: Graph | undefined,
  table: TableName | undefined,
  record: Row,
  args: unknown,
): Row {
  const counts: Row = {};
  const selection = isObject(args) && isObject(args['select']) ? args['select'] : {};
  for (const [key, spec] of Object.entries(selection)) {
    if (spec === false) continue;
    const value = related(graph, table, record, key);
    const rows = Array.isArray(value) ? (value as Row[]) : [];
    const where = isObject(spec) ? (spec['where'] as Row | undefined) : undefined;
    counts[key] = rows.filter((row) => matchesWhere(row, where, graph, linkOf(table, key)?.table)).length;
  }
  return counts;
}

function project(record: Row, selection: Row | undefined, graph?: Graph, table?: TableName): Row {
  const result: Row = {};
  for (const [key, value] of Object.entries(record)) {
    // Relations seulement si elles sont sélectionnées.
    if (!isRelation(table, key)) result[key] = value;
  }
  for (const [key, args] of Object.entries(selection ?? {})) {
    if (args === false || args === undefined) continue;
    if (key === '_count') {
      result[key] = countRelations(graph, table, record, args);
      continue;
    }
    // Champ simple ou JSON sélectionné (`cities: true`, `translations: true`) : valeur telle quelle, déjà copiée.
    if (!isRelation(table, key)) continue;
    const value = related(graph, table, record, key);
    const nestedTable = linkOf(table, key)?.table;
    if (Array.isArray(value)) {
      result[key] = findRows(value as Row[], args === true ? {} : (args as Args), graph, nestedTable);
    } else if (isObject(value)) {
      const nested = args === true ? undefined : ((args as Args).select ?? (args as Args).include);
      result[key] = project(value, nested, graph, nestedTable);
    } else if (value === null || value === undefined) {
      if (key in record || linkOf(table, key)) result[key] = null;
    }
  }
  return result;
}

function findRows(rows: readonly Row[], args: Args = {}, graph?: Graph, table?: TableName): Row[] {
  const filtered = rows.filter((row) => matchesWhere(row, args.where, graph, table));
  const sorted = sortRows(filtered, args.orderBy, graph, table);
  const start = args.skip ?? 0;
  const limited = sorted.slice(start, args.take === undefined ? undefined : start + args.take);
  return limited.map((row) => project(row, args.select ?? args.include, graph, table));
}

let idSequence = 0;

/** Applique les valeurs d'une écriture (`{ increment }`, `{ set }` ou valeur simple) à un enregistrement. */
function applyData(record: Row, data: Row): void {
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    // `Prisma.DbNull` / `Prisma.JsonNull` : colonne JSON remise à `null`.
    if (value === Prisma.DbNull || value === Prisma.JsonNull) {
      record[key] = null;
      continue;
    }
    if (isObject(value) && Object.keys(value).length === 1 && 'increment' in value) {
      record[key] = ((record[key] as number | null | undefined) ?? 0) + (value['increment'] as number);
    } else if (isObject(value) && Object.keys(value).length === 1 && 'set' in value) {
      record[key] = value['set'];
    } else {
      record[key] = value;
    }
  }
}

function delegate(name: TableName, rows: () => Row[], graph: Graph) {
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
  const matching = (where: Row | undefined): Row[] =>
    rows().filter((row) => matchesWhere(row, where, graph, name));
  const output = (record: Row, args: Args): Row => project(record, args.select ?? args.include, graph, name);
  return {
    findMany: vi.fn((args?: Args) => Promise.resolve(findRows(rows(), args, graph, name))),
    findFirst: vi.fn((args?: Args) => Promise.resolve(findRows(rows(), args, graph, name)[0] ?? null)),
    findUnique: vi.fn((args?: Args) => Promise.resolve(findRows(rows(), args, graph, name)[0] ?? null)),
    count: vi.fn((args?: Args) => Promise.resolve(matching(args?.where).length)),
    create: vi.fn((args: WriteArgs) => Promise.resolve(output(insert(args.data as Row), args))),
    createMany: vi.fn((args: WriteArgs) => {
      const data = Array.isArray(args.data) ? args.data : [args.data as Row];
      data.forEach((item) => insert(item));
      return Promise.resolve({ count: data.length });
    }),
    update: vi.fn((args: WriteArgs) => {
      const record = matching(args.where)[0];
      if (!record)
        return Promise.reject(new Error(`Double Prisma : ${name} introuvable pour la mise à jour.`));
      return Promise.resolve(output(update(record, args.data as Row), args));
    }),
    updateMany: vi.fn((args: WriteArgs) => {
      const found = matching(args.where);
      found.forEach((record) => update(record, args.data as Row));
      return Promise.resolve({ count: found.length });
    }),
    delete: vi.fn((args: WriteArgs) => {
      const table = rows();
      const index = table.findIndex((row) => matchesWhere(row, args.where, graph, name));
      if (index < 0)
        return Promise.reject(new Error(`Double Prisma : ${name} introuvable pour la suppression.`));
      const [removed] = table.splice(index, 1);
      return Promise.resolve(output(removed ?? {}, args));
    }),
    upsert: vi.fn((args: WriteArgs) => {
      const existing = matching(args.where)[0];
      const record = existing ? update(existing, args.update ?? {}) : insert(args.create ?? {});
      return Promise.resolve(output(record, args));
    }),
    deleteMany: vi.fn((args?: Args) => {
      const table = rows();
      const kept = table.filter((row) => !matchesWhere(row, args?.where, graph, name));
      const count = table.length - kept.length;
      table.splice(0, table.length, ...kept);
      return Promise.resolve({ count });
    }),
    aggregate: vi.fn((args: WriteArgs) => {
      const sums: Row = {};
      for (const field of Object.keys(args._sum ?? {})) {
        const values = matching(args.where)
          .map((row) => row[field])
          .filter((value): value is number => typeof value === 'number');
        sums[field] = values.length > 0 ? values.reduce((total, value) => total + value, 0) : null;
      }
      return Promise.resolve({ _sum: sums });
    }),
    groupBy: vi.fn((args: GroupByArgs) => {
      const groups = new Map<string, Row>();
      for (const row of matching(args.where)) {
        const values = args.by.map((field) => row[field] ?? null);
        const key = JSON.stringify(values);
        const group = groups.get(key) ?? {
          ...Object.fromEntries(args.by.map((field, index) => [field, values[index]])),
          _count: { _all: 0 },
        };
        (group['_count'] as { _all: number })._all += 1;
        groups.set(key, group);
      }
      return Promise.resolve([...groups.values()]);
    }),
  };
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
  'session',
  'trustedDevice',
  'otpChallenge',
  'passwordReset',
  'invitation',
  'auditLog',
  'appointment',
  'requestNote',
  'survey',
  'attachment',
  'jobApplication',
  'serviceGalleryImage',
  'serviceRelation',
  'serviceFeaturedReview',
  'serviceOffer',
  'categoryOfferSection',
  'zoneQuarter',
  'emailTemplate',
  'revalidationRequest',
  'backupRun',
] as const;

const DELEGATED_TABLES = [
  'setting',
  'media',
  'category',
  'service',
  'review',
  'page',
  'zone',
  'redirect',
  'jobOffer',
  ...OPTIONAL_TABLES,
] as const satisfies readonly TableName[];

/** Double à passer à `overrideProvider(PrismaService).useValue(…)`. */
export function createPrismaDouble(tables: PrismaTables) {
  for (const name of OPTIONAL_TABLES) tables[name] ??= [];
  const graph: Graph = { tables };
  const table = (name: TableName) => (): Row[] => tables[name] ?? [];
  const delegates = Object.fromEntries(
    DELEGATED_TABLES.map((name) => [name, delegate(name, table(name), graph)]),
  ) as Record<(typeof DELEGATED_TABLES)[number], ReturnType<typeof delegate>>;
  const double = {
    ...delegates,
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
