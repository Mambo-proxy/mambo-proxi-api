/**
 * Recherche plein texte du site public : comparaison sans accents ni casse (« deido » trouve « Deïdo »), mots
 * cherchés en début de mot, pluriels simples repliés (« chefs » trouve « chef »), plages à surligner exprimées en
 * positions UTF-16 du texte d'origine (`String.prototype.slice`).
 */

export interface TextRange {
  start: number;
  end: number;
}

/** Texte replié et correspondance de chaque unité repliée vers sa position dans le texte d'origine. */
interface Folded {
  text: string;
  starts: number[];
  ends: number[];
}

const LIGATURES: Readonly<Record<string, string>> = { œ: 'oe', Œ: 'oe', æ: 'ae', Æ: 'ae', ß: 'ss' };

function foldChar(char: string): string {
  return (LIGATURES[char] ?? char).normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('fr');
}

export function fold(text: string): Folded {
  let folded = '';
  const starts: number[] = [];
  const ends: number[] = [];
  let index = 0;
  for (const char of text) {
    const value = foldChar(char);
    for (let unit = 0; unit < value.length; unit += 1) {
      starts.push(index);
      ends.push(index + char.length);
    }
    folded += value;
    index += char.length;
  }
  return { text: folded, starts, ends };
}

/** Mot replié : un « s » ou un « x » final est retiré au-delà de 3 lettres (pluriels). */
function stem(word: string): string {
  return word.length > 3 && /[sx]$/.test(word) ? word.slice(0, -1) : word;
}

/** Mots cherchés, repliés (lettres et chiffres seulement), sans doublon. */
export function queryTerms(query: string): string[] {
  const words = fold(query)
    .text.split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 0)
    .map(stem);
  return [...new Set(words)];
}

const isWordChar = (char: string | undefined): boolean => char !== undefined && /[\p{L}\p{N}]/u.test(char);

/** Occurrences (en début de mot) d'un terme dans un texte replié. */
function occurrences(folded: string, term: string): number[] {
  const found: number[] = [];
  let from = 0;
  for (;;) {
    const at = folded.indexOf(term, from);
    if (at < 0) return found;
    if (!isWordChar(folded[at - 1])) found.push(at);
    from = at + 1;
  }
}

/** Résultat de la comparaison d'un texte avec les termes cherchés. */
export interface TextMatch {
  /** Termes trouvés dans le texte. */
  matched: ReadonlySet<string>;
  /** Plages à surligner (texte d'origine), triées et fusionnées. */
  ranges: TextRange[];
  /** Nombre total d'occurrences. */
  hits: number;
  /** Position (texte d'origine) de la première occurrence, ou `null`. */
  first: number | null;
}

export function matchText(text: string, terms: readonly string[]): TextMatch {
  const folded = fold(text);
  const matched = new Set<string>();
  const raw: TextRange[] = [];
  for (const term of terms) {
    for (const at of occurrences(folded.text, term)) {
      matched.add(term);
      const start = folded.starts[at];
      const end = folded.ends[at + term.length - 1];
      if (start !== undefined && end !== undefined) raw.push({ start, end });
    }
  }
  raw.sort((a, b) => a.start - b.start || b.end - a.end);
  const ranges: TextRange[] = [];
  for (const range of raw) {
    const last = ranges.at(-1);
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else ranges.push({ ...range });
  }
  return { matched, ranges, hits: raw.length, first: ranges[0]?.start ?? null };
}

const ELLIPSIS = '…';

/**
 * Extrait de `maxLength` caractères au plus, centré sur la première occurrence (coupé entre deux mots, « … » au
 * début et à la fin s'il est coupé), avec ses plages à surligner.
 */
export function excerptAround(
  text: string,
  terms: readonly string[],
  maxLength = 240,
): { excerpt: string; highlights: TextRange[] } {
  const clean = text.replace(/\s+/g, ' ').trim();
  const match = matchText(clean, terms);
  if (clean.length <= maxLength) return { excerpt: clean, highlights: match.ranges };

  const anchor = match.first ?? 0;
  let start = anchor <= 60 ? 0 : anchor - 60;
  if (start > 0) {
    const space = clean.lastIndexOf(' ', start);
    start = space > 0 && anchor - space < 120 ? space + 1 : start;
  }
  const prefix = start > 0 ? `${ELLIPSIS} ` : '';
  let end = Math.min(clean.length, start + maxLength - prefix.length);
  let suffix = '';
  if (end < clean.length) {
    end = start + maxLength - prefix.length - 2;
    const space = clean.lastIndexOf(' ', end);
    if (space > start + 40) end = space;
    suffix = ` ${ELLIPSIS}`;
  }
  const body = clean.slice(start, end).trim();
  const excerpt = `${prefix}${body}${suffix}`;
  const shift =
    prefix.length - start - (clean.slice(start, end).length - clean.slice(start, end).trimStart().length);
  const highlights = match.ranges
    .map((range) => ({ start: range.start + shift, end: range.end + shift }))
    .filter((range) => range.start >= prefix.length && range.end <= prefix.length + body.length);
  return { excerpt, highlights };
}

/** Texte brut d'un fragment HTML (balises retirées, entités courantes décodées, marques d'accent `==` retirées). */
export function plainText(value: string): string {
  return value
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/==/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
