/**
 * Exports CSV du back-office (demandes, contacts) : UTF-8 avec BOM (Excel reconnaît l'encodage), séparateur `;`
 * (Excel en français), lignes terminées par CRLF, chaque cellule entre guillemets (`"` doublé).
 *
 * Injection de formules (CSV injection, OWASP) : une cellule qui commence par `=`, `+`, `-`, `@`, une tabulation ou
 * un retour chariot est préfixée d'une apostrophe, pour qu'un tableur l'affiche comme du texte au lieu de l'exécuter
 * (`=HYPERLINK(…)` saisi dans un formulaire public). Exception : les nombres et numéros de téléphone (`+237…`,
 * `-12`), qui ne peuvent rien exécuter et resteraient sinon illisibles.
 */
export const CSV_BOM = '\uFEFF';
export const CSV_CONTENT_TYPE = 'text/csv; charset=utf-8';

const FORMULA_START = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^[+-]?\d[\d\s.,]*$/;

export type CsvValue = string | number | null | undefined;

/** Valeur d'une cellule, neutralisée puis échappée. */
export function csvCell(value: CsvValue): string {
  const text = value === null || value === undefined ? '' : String(value);
  const safe = FORMULA_START.test(text) && !PLAIN_NUMBER.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** Document complet : BOM, en-tête puis lignes. */
export function toCsv(header: readonly string[], rows: readonly (readonly CsvValue[])[]): string {
  const lines = [header, ...rows].map((row) => row.map(csvCell).join(';'));
  return `${CSV_BOM}${lines.join('\r\n')}`;
}

/** En-tête `Content-Disposition` d'un fichier à télécharger (nom ASCII, sans guillemets). */
export function attachmentDisposition(fileName: string): string {
  return `attachment; filename="${fileName.replace(/[^\w.-]/g, '_')}"`;
}
