import { searchKey } from '../../common/text/search-key.js';

/** Clé de recherche d'une demande (colonne `search_text`) : référence et sujet, sans accents ni casse. */
export function requestSearchText(reference: string, subject: string | null | undefined): string {
  return searchKey(reference, subject);
}
