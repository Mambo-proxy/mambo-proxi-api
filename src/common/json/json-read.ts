import { isPlainObject } from '../i18n/translations.js';

/**
 * Lecture prudente des colonnes JSON (paramètres, structures éditées dans le back-office) : une valeur absente ou de
 * mauvais type prend la valeur de repli, pour que la réponse reste conforme au contrat.
 */
export type JsonObject = Record<string, unknown>;

export function asObject(value: unknown): JsonObject {
  return isPlainObject(value) ? value : {};
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? (value as unknown[]) : [];
}

/** Liste des objets d'un tableau JSON (les autres éléments sont écartés). */
export function asObjectArray(value: unknown): JsonObject[] {
  return asArray(value).filter(isPlainObject);
}

export function readString(source: JsonObject, key: string, fallback: string): string {
  const value = source[key];
  return typeof value === 'string' && value !== '' ? value : fallback;
}

/** Texte facultatif : `null` si absent ou vide. */
export function readNullableString(source: JsonObject, key: string): string | null {
  const value = source[key];
  return typeof value === 'string' && value !== '' ? value : null;
}

export function readBoolean(source: JsonObject, key: string, fallback: boolean): boolean {
  const value = source[key];
  return typeof value === 'boolean' ? value : fallback;
}

export function readNullableNumber(source: JsonObject, key: string): number | null {
  const value = source[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function readStringArray(source: JsonObject, key: string): string[] {
  return asArray(source[key]).filter((item): item is string => typeof item === 'string');
}
