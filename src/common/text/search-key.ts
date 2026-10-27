/**
 * Clé de recherche : texte sans accents ni casse, espaces réduits (« Makèpè, Douala » → « makepe, douala »).
 *
 * Les colonnes `search_text` (contacts, demandes) et `city_key` (contacts) en sont remplies à chaque écriture, ce
 * qui permet des filtres Prisma ordinaires (`contains`, `startsWith`) insensibles aux accents sans l'extension
 * `unaccent` (migration `20261027000000_search_keys`). La valeur cherchée passe par la même fonction.
 */
export function searchKey(...parts: readonly (string | null | undefined)[]): string {
  return parts
    .filter((part): part is string => typeof part === 'string' && part.trim() !== '')
    .join(' ')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('fr')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Clé d'une valeur facultative : `null` si elle est vide. */
export function optionalSearchKey(value: string | null | undefined): string | null {
  const key = searchKey(value);
  return key === '' ? null : key;
}
