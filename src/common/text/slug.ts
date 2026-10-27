/** Longueur maximale d'un slug (schéma `Slug` du contrat). */
const SLUG_MAX_LENGTH = 120;

/**
 * Slug d'adresse (schéma `Slug` du contrat) tiré d'un nom : minuscules sans accents, ligatures dépliées, tout autre
 * caractère remplacé par un tiret (« Visites guidées de Douala » → `visites-guidees-de-douala`). Vide si le nom ne
 * contient ni lettre ni chiffre.
 */
export function slugify(value: string, maxLength: number = SLUG_MAX_LENGTH): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('fr')
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/, '');
}

/**
 * Premier slug libre parmi `base`, `base-2`, `base-3`… (`taken` : slugs déjà utilisés), en restant dans la longueur
 * maximale du contrat.
 */
export function uniqueSlug(base: string, taken: ReadonlySet<string>, fallback = 'contenu'): string {
  const root = base === '' ? fallback : base;
  if (!taken.has(root)) return root;
  for (let index = 2; ; index += 1) {
    const suffix = `-${String(index)}`;
    const candidate = `${root.slice(0, SLUG_MAX_LENGTH - suffix.length).replace(/-+$/, '')}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}
