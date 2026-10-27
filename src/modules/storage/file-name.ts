/** Longueur maximale d'un nom de fichier conservé (extension comprise). */
export const FILE_NAME_MAX_LENGTH = 120;

/**
 * Nom de fichier affiché dans le back-office et proposé au téléchargement : sans chemin, sans caractère de contrôle
 * ni caractère réservé (`/ \ : * ? " < > |`), espaces resserrés, 120 caractères au plus, terminé par l'extension du
 * type réel (« CV Paul.exe.pdf » si le nom annoncé ne correspond pas). Le nom n'est jamais utilisé comme clé de
 * stockage (clé aléatoire).
 */
export function sanitizeFileName(
  original: string | undefined,
  extension: string,
  fallback = 'document',
): string {
  const base = (original ?? '').split(/[\\/]/).pop() ?? '';
  const cleaned = base
    .normalize('NFC')
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .replace(/[:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '');
  const suffix = `.${extension}`;
  const stem = cleaned.toLowerCase().endsWith(suffix) ? cleaned.slice(0, -suffix.length) : cleaned;
  const trimmed = stem.slice(0, FILE_NAME_MAX_LENGTH - suffix.length).trim() || fallback;
  return `${trimmed}${suffix}`;
}

/**
 * En-tête `Content-Disposition: attachment` avec un nom ASCII de repli et le nom exact encodé (RFC 6266 / 8187),
 * pour les noms accentués (« CV Aurélie.pdf »).
 */
export function downloadDisposition(fileName: string): string {
  const ascii = fileName
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(fileName).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
