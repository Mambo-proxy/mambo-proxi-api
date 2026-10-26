/**
 * Validation des réponses de l'API contre le contrat `contracts/openapi.yaml` (OpenAPI 3.1, JSON Schema 2020-12).
 *
 * @example
 * const response = await request(server).get('/v1/health');
 * expectToMatchContract('get', '/v1/health', 200, response);
 */
import { readFileSync } from 'node:fs';
import Ajv2020Module, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import { parse } from 'yaml';

const CONTRACT_URL = new URL('../contracts/openapi.yaml', import.meta.url);
/** Identifiant sous lequel les composants du contrat sont enregistrés dans ajv (cible des `$ref`). */
const CONTRACT_ID = 'https://api.mamboproxi.com/contracts/openapi.json';
const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'] as const;

type JsonObject = Record<string, unknown>;

/** Réponse à valider : une réponse supertest convient telle quelle. */
export interface ContractResponse {
  status?: number;
  headers: Record<string, unknown>;
  body: unknown;
}

interface LoadedContract {
  document: JsonObject;
  ajv: InstanceType<typeof Ajv2020Module.default>;
  validators: Map<string, ValidateFunction>;
}

let loaded: LoadedContract | undefined;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function loadContract(): LoadedContract {
  if (loaded) return loaded;
  const document: unknown = parse(readFileSync(CONTRACT_URL, 'utf8'));
  if (!isObject(document) || !isObject(document['components'])) {
    throw new Error(`Contrat illisible : ${CONTRACT_URL.pathname}`);
  }
  const Ajv2020 = Ajv2020Module.default;
  const ajv = new Ajv2020({ strict: false, allErrors: true, logger: false });
  addFormatsModule.default(ajv);
  ajv.addSchema({ $id: CONTRACT_ID, components: document['components'] });
  loaded = { document, ajv, validators: new Map() };
  return loaded;
}

function decodePointerSegment(segment: string): string {
  return decodeURIComponent(segment).replace(/~1/g, '/').replace(/~0/g, '~');
}

/** Résout une référence locale (`#/components/responses/…`) dans le document. */
function resolvePointer(document: JsonObject, ref: string): unknown {
  if (!ref.startsWith('#/')) throw new Error(`Référence non prise en charge : ${ref}`);
  let node: unknown = document;
  for (const segment of ref.slice(2).split('/').map(decodePointerSegment)) {
    node = isObject(node)
      ? node[segment]
      : Array.isArray(node)
        ? (node as unknown[])[Number(segment)]
        : undefined;
    if (node === undefined) throw new Error(`Référence introuvable dans le contrat : ${ref}`);
  }
  return node;
}

/** Suit les `$ref` des objets OpenAPI (réponses, en-têtes) jusqu'à l'objet réel. */
function dereference(document: JsonObject, value: unknown): unknown {
  let current = value;
  for (let depth = 0; isObject(current) && typeof current['$ref'] === 'string'; depth += 1) {
    if (depth > 20) throw new Error('Références circulaires dans le contrat.');
    current = resolvePointer(document, current['$ref']);
  }
  return current;
}

/** Réécrit les `$ref` locaux d'un schéma pour qu'ils visent les composants enregistrés dans ajv. */
function rebaseRefs(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(rebaseRefs);
  if (!isObject(node)) return node;
  return Object.fromEntries(
    Object.entries(node).map(([key, value]) => [
      key,
      key === '$ref' && typeof value === 'string' && value.startsWith('#')
        ? `${CONTRACT_ID}${value}`
        : rebaseRefs(value),
    ]),
  );
}

function findPathTemplate(paths: JsonObject, path: string): string | undefined {
  const pathname = path.split('?')[0] ?? path;
  if (pathname in paths) return pathname;
  return Object.keys(paths).find((template) => {
    const pattern = template.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{[^}/]+\}/g, '[^/]+');
    return new RegExp(`^${pattern}$`).test(pathname);
  });
}

function headerValue(headers: Record<string, unknown>, name: string): string | undefined {
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
  const value = entry?.[1];
  if (Array.isArray(value)) return value.map(String).join(', ');
  return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined;
}

function isEmptyBody(body: unknown): boolean {
  return (
    body === undefined || body === null || body === '' || (isObject(body) && Object.keys(body).length === 0)
  );
}

function formatErrors(errors: ErrorObject[] | null | undefined): string {
  return (errors ?? [])
    .map((error) => {
      const params = JSON.stringify(error.params);
      return `  - ${error.instancePath || '(racine)'} : ${error.message ?? 'invalide'} ${params}`;
    })
    .join('\n');
}

function compile(contract: LoadedContract, key: string, schema: unknown): ValidateFunction {
  let validator = contract.validators.get(key);
  if (!validator) {
    validator = contract.ajv.compile(rebaseRefs(schema) as JsonObject);
    contract.validators.set(key, validator);
  }
  return validator;
}

/**
 * Vérifie qu'une réponse est décrite par le contrat (chemin, méthode, statut, type de contenu)
 * et que son corps respecte le schéma correspondant. Lève une erreur détaillée sinon.
 */
export function expectToMatchContract(
  method: string,
  path: string,
  status: number,
  response: ContractResponse,
): void {
  const contract = loadContract();
  const verb = method.toLowerCase();
  const label = `${verb.toUpperCase()} ${path} → ${status}`;

  if (!(HTTP_METHODS as readonly string[]).includes(verb))
    throw new Error(`Méthode HTTP inconnue : ${method}`);
  if (response.status !== undefined && response.status !== status) {
    throw new Error(`${label} : statut reçu ${response.status}, attendu ${status}.`);
  }

  const paths = contract.document['paths'];
  if (!isObject(paths)) throw new Error('Le contrat ne décrit aucun chemin.');
  const template = findPathTemplate(paths, path);
  if (template === undefined) throw new Error(`${label} : chemin absent du contrat.`);
  const pathItem = dereference(contract.document, paths[template]);
  const operation = isObject(pathItem) ? pathItem[verb] : undefined;
  if (!isObject(operation) || !isObject(operation['responses'])) {
    throw new Error(`${label} : opération absente du contrat (${verb.toUpperCase()} ${template}).`);
  }

  const responses = operation['responses'];
  const statusKey = [String(status), `${String(status)[0]}XX`, 'default'].find((key) => key in responses);
  if (statusKey === undefined) {
    throw new Error(`${label} : statut non documenté (documentés : ${Object.keys(responses).join(', ')}).`);
  }
  const responseSpec = dereference(contract.document, responses[statusKey]);
  if (!isObject(responseSpec)) throw new Error(`${label} : réponse illisible dans le contrat.`);

  if (isObject(responseSpec['headers'])) {
    for (const [name, header] of Object.entries(responseSpec['headers'])) {
      const spec = dereference(contract.document, header);
      if (isObject(spec) && spec['required'] === true && headerValue(response.headers, name) === undefined) {
        throw new Error(`${label} : en-tête obligatoire absent : ${name}.`);
      }
    }
  }

  const content = responseSpec['content'];
  if (!isObject(content)) {
    if (!isEmptyBody(response.body))
      throw new Error(`${label} : le contrat ne prévoit aucun corps de réponse.`);
    return;
  }

  const mediaType = headerValue(response.headers, 'content-type')?.split(';')[0]?.trim().toLowerCase();
  if (mediaType === undefined || !(mediaType in content)) {
    throw new Error(
      `${label} : type de contenu « ${mediaType ?? 'absent'} » non prévu (prévus : ${Object.keys(content).join(', ')}).`,
    );
  }
  const media = content[mediaType];
  if (!isObject(media) || media['schema'] === undefined) return;

  const validator = compile(contract, `${verb} ${template} ${statusKey} ${mediaType}`, media['schema']);
  if (!validator(response.body)) {
    throw new Error(
      `Réponse non conforme au contrat : ${label} (${mediaType})\n${formatErrors(validator.errors)}\nCorps reçu : ${JSON.stringify(response.body)}`,
    );
  }
}

/**
 * Compile à l'avance les schémas nommés : la première compilation résout tout `components` du contrat (plusieurs
 * secondes sur une machine lente). À appeler dans un `beforeAll` avec un délai suffisant.
 */
export const CONTRACT_WARM_UP_TIMEOUT = 60_000;

export function prepareContract(...schemaNames: string[]): void {
  const contract = loadContract();
  for (const schemaName of schemaNames)
    compile(contract, `schema ${schemaName}`, { $ref: `#/components/schemas/${schemaName}` });
}

/** Vérifie une valeur contre un schéma nommé du contrat (`components.schemas.<nom>`). */
export function expectToMatchSchema(schemaName: string, value: unknown): void {
  const contract = loadContract();
  const components = contract.document['components'] as JsonObject;
  if (!isObject(components['schemas']) || !(schemaName in components['schemas'])) {
    throw new Error(`Schéma absent du contrat : ${schemaName}`);
  }
  const validator = compile(contract, `schema ${schemaName}`, {
    $ref: `#/components/schemas/${schemaName}`,
  });
  if (!validator(value)) {
    throw new Error(
      `Valeur non conforme au schéma ${schemaName}\n${formatErrors(validator.errors)}\nValeur : ${JSON.stringify(value)}`,
    );
  }
}
