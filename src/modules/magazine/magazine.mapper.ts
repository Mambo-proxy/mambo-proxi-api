import type { Lang } from '../../common/i18n/lang.js';
import type { MagazineEditionStatus, Prisma } from '../../generated/prisma/client.js';
import { mediaImageSelect, type MediaImage } from '../media/visual.mapper.js';

/** Espace insécable de « N° 1 » (comme le site). */
const NBSP = String.fromCharCode(0xa0);

/** Langues d'une édition ou d'un article (schéma `MagazineLanguage`). */
export type MagazineLanguage = 'fr' | 'en';

export const MAGAZINE_ARTICLE_SELECT = {
  id: true,
  editionId: true,
  sortOrder: true,
  title: true,
  titleEn: true,
  theme: true,
  themeEn: true,
  excerpt: true,
  excerptEn: true,
  body: true,
  bodyEn: true,
  imageId: true,
  updatedAt: true,
  image: { select: mediaImageSelect },
  edition: { select: { id: true, number: true } },
} as const satisfies Prisma.MagazineArticleSelect;

export type MagazineArticleRow = Prisma.MagazineArticleGetPayload<{ select: typeof MAGAZINE_ARTICLE_SELECT }>;

export const MAGAZINE_EDITION_SELECT = {
  id: true,
  number: true,
  title: true,
  titleEn: true,
  subtitle: true,
  subtitleEn: true,
  themes: true,
  publishAt: true,
  publishedAt: true,
  status: true,
  coverId: true,
  editorial: true,
  editorialEn: true,
  signature: true,
  signatureEn: true,
  newsletterScheduledAt: true,
  newsletterSentAt: true,
  createdAt: true,
  updatedAt: true,
  cover: { select: mediaImageSelect },
  articles: { select: MAGAZINE_ARTICLE_SELECT, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
} as const satisfies Prisma.MagazineEditionSelect;

export type MagazineEditionRow = Prisma.MagazineEditionGetPayload<{ select: typeof MAGAZINE_EDITION_SELECT }>;

/** Résolution des images (`MediaService.image`). */
export type ImageResolver = (media: MagazineEditionRow['cover']) => MediaImage | null;

/** « N° 1 » ou « Hors-série » (« No. 1 », « Special issue » en anglais). */
export function editionLabel(number: number | null, lang: Lang = 'fr'): string {
  if (number === null) return lang === 'en' ? 'Special issue' : 'Hors-série';
  return lang === 'en' ? `No.${NBSP}${String(number)}` : `N°${NBSP}${String(number)}`;
}

/** « Édition n° 1 » (statistiques de la dernière campagne). */
export function editionCampaignLabel(number: number | null): string {
  return number === null ? 'Hors-série' : `Édition n°${NBSP}${String(number)}`;
}

const filled = (value: string | null | undefined): boolean =>
  typeof value === 'string' && value.trim() !== '';

/** Article complet en anglais : titre et texte renseignés (texte facultatif s'il n'y en a pas en français). */
export function articleHasEnglish(row: Pick<MagazineArticleRow, 'titleEn' | 'body' | 'bodyEn'>): boolean {
  return filled(row.titleEn) && (filled(row.bodyEn) || !filled(row.body));
}

/** Édition complète en anglais : titre, édito (s'il y en a un) et tous ses articles. */
export function editionHasEnglish(
  row: Pick<MagazineEditionRow, 'titleEn' | 'editorial' | 'editorialEn'>,
  articles: readonly Pick<MagazineArticleRow, 'titleEn' | 'body' | 'bodyEn'>[],
): boolean {
  return (
    filled(row.titleEn) &&
    (filled(row.editorialEn) || !filled(row.editorial)) &&
    articles.every((article) => articleHasEnglish(article))
  );
}

/**
 * Statut affiché : une édition programmée dont la date est passée est publiée (la transition n'est pas écrite en
 * base : elle est évaluée à chaque lecture, sur le site comme dans le back-office).
 */
export function effectiveStatus(
  row: Pick<MagazineEditionRow, 'status' | 'publishAt'>,
  now: Date,
): MagazineEditionStatus {
  if (row.status === 'SCHEDULED' && row.publishAt !== null && row.publishAt.getTime() <= now.getTime())
    return 'PUBLISHED';
  return row.status;
}

/** Condition des éditions visibles sur le site. */
export function visibleEditionWhere(now: Date): Prisma.MagazineEditionWhereInput {
  return {
    OR: [{ status: 'PUBLISHED' }, { status: 'SCHEDULED', publishAt: { lte: now } }],
  };
}

/** Ordre des éditions du site, de la plus récente à la plus ancienne : la première est l'édition affichée par défaut. */
export const LATEST_EDITION_ORDER = [
  { publishAt: { sort: 'desc', nulls: 'last' } },
  { publishedAt: 'desc' },
  { id: 'asc' },
] as const satisfies Prisma.MagazineEditionOrderByWithRelationInput[];

/** Édition visible sur le site (ou qui le deviendra à sa date) : ses modifications demandent une revalidation. */
export function isOnline(row: Pick<MagazineEditionRow, 'status'>): boolean {
  return row.status === 'PUBLISHED' || row.status === 'SCHEDULED';
}

/** Date de publication affichée. */
export function displayedDate(row: Pick<MagazineEditionRow, 'publishAt' | 'publishedAt'>): Date | null {
  return row.publishAt ?? row.publishedAt;
}

// ─────────────────────────── Back-office ───────────────────────────

/** Schéma `AdminMagazineArticle`. */
export interface AdminMagazineArticle {
  id: string;
  title: string;
  titleEn: string | null;
  theme: string;
  themeEn: string | null;
  excerpt: string | null;
  excerptEn: string | null;
  body: string | null;
  bodyEn: string | null;
  image: MediaImage | null;
  languages: MagazineLanguage[];
  edition: { id: string; label: string } | null;
  updatedAt: string;
}

/** Schéma `AdminMagazineEditionSummary`. */
export interface AdminMagazineEditionSummary {
  id: string;
  number: number | null;
  label: string;
  title: string;
  subtitle: string | null;
  themes: string | null;
  cover: MediaImage | null;
  articlesCount: number;
  toTranslate: number;
  languages: MagazineLanguage[];
  readers: number | null;
  status: MagazineEditionStatus;
  publishAt: string | null;
  updatedAt: string;
}

/** Envoi par la newsletter d'une édition (propriété `newsletter` d'`AdminMagazineEdition`). */
export interface EditionNewsletter {
  subscribers: { fr: number; en: number };
  scheduledAt: string | null;
  sentAt: string | null;
}

/** Schéma `AdminMagazineEdition`. */
export interface AdminMagazineEdition extends AdminMagazineEditionSummary {
  titleEn: string | null;
  subtitleEn: string | null;
  coverId: string | null;
  editorial: string | null;
  editorialEn: string | null;
  signature: string | null;
  signatureEn: string | null;
  articles: AdminMagazineArticle[];
  newsletter: EditionNewsletter;
}

export function toAdminArticle(row: MagazineArticleRow, image: ImageResolver): AdminMagazineArticle {
  return {
    id: row.id,
    title: row.title,
    titleEn: row.titleEn,
    theme: row.theme,
    themeEn: row.themeEn,
    excerpt: row.excerpt,
    excerptEn: row.excerptEn,
    body: row.body,
    bodyEn: row.bodyEn,
    image: image(row.image),
    languages: articleHasEnglish(row) ? ['fr', 'en'] : ['fr'],
    edition: row.edition ? { id: row.edition.id, label: editionLabel(row.edition.number) } : null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** `readers` : `null` avant la publication ; ensuite, ouvertures des e-mails de l'édition (si la mesure est active). */
export function toAdminSummary(
  row: MagazineEditionRow,
  image: ImageResolver,
  readers: number,
  now: Date,
): AdminMagazineEditionSummary {
  const status = effectiveStatus(row, now);
  return {
    id: row.id,
    number: row.number,
    label: editionLabel(row.number),
    title: row.title,
    subtitle: row.subtitle,
    themes: row.themes,
    cover: image(row.cover),
    articlesCount: row.articles.length,
    toTranslate: row.articles.filter((article) => !articleHasEnglish(article)).length,
    languages: editionHasEnglish(row, row.articles) ? ['fr', 'en'] : ['fr'],
    readers: status === 'PUBLISHED' ? readers : null,
    status,
    publishAt: displayedDate(row)?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toAdminEdition(
  row: MagazineEditionRow,
  image: ImageResolver,
  readers: number,
  newsletter: EditionNewsletter,
  now: Date,
): AdminMagazineEdition {
  return {
    ...toAdminSummary(row, image, readers, now),
    titleEn: row.titleEn,
    subtitleEn: row.subtitleEn,
    coverId: row.coverId,
    editorial: row.editorial,
    editorialEn: row.editorialEn,
    signature: row.signature,
    signatureEn: row.signatureEn,
    articles: row.articles.map((article) => toAdminArticle(article, image)),
    newsletter,
  };
}

// ─────────────────────────── Site public ───────────────────────────

/** Schéma `MagazineArticle`. */
export interface PublicMagazineArticle {
  id: string;
  anchor: string;
  title: string;
  theme: string;
  excerpt: string | null;
  body: string | null;
  image: MediaImage | null;
}

/** Schéma `MagazineEditionSummary`. */
export interface PublicMagazineEditionSummary {
  id: string;
  number: number | null;
  label: string;
  title: string;
  subtitle: string | null;
  themes: string | null;
  cover: MediaImage | null;
  publishedAt: string | null;
  articlesCount: number;
}

/** Schéma `MagazineEdition`. */
export interface PublicMagazineEdition extends PublicMagazineEditionSummary {
  editorial: string | null;
  signature: string | null;
  articles: PublicMagazineArticle[];
}

/** Schéma `Magazine` (`GET /v1/magazine`). */
export interface PublicMagazine {
  edition: PublicMagazineEdition | null;
  editions: PublicMagazineEditionSummary[];
  isPreview: boolean;
}

/** Ancre d'un article sur la page Magazine (résultats de la recherche : `/magazine#article-{id}`). */
export function articleAnchor(id: string): string {
  return `article-${id}`;
}

/** Valeur dans la langue demandée, repli sur le français champ par champ. */
function pick<T extends string | null>(fr: T, en: string | null, lang: Lang): T | string {
  return lang === 'en' && filled(en) ? (en as string) : fr;
}

export function toPublicArticle(
  row: MagazineArticleRow,
  lang: Lang,
  image: ImageResolver,
): PublicMagazineArticle {
  return {
    id: row.id,
    anchor: articleAnchor(row.id),
    title: pick(row.title, row.titleEn, lang),
    theme: pick(row.theme, row.themeEn, lang),
    excerpt: pick(row.excerpt, row.excerptEn, lang),
    body: pick(row.body, row.bodyEn, lang),
    image: image(row.image),
  };
}

export function toPublicSummary(
  row: MagazineEditionRow,
  lang: Lang,
  image: ImageResolver,
): PublicMagazineEditionSummary {
  return {
    id: row.id,
    number: row.number,
    label: editionLabel(row.number, lang),
    title: pick(row.title, row.titleEn, lang),
    subtitle: pick(row.subtitle, row.subtitleEn, lang),
    themes: row.themes,
    cover: image(row.cover),
    publishedAt: displayedDate(row)?.toISOString() ?? null,
    articlesCount: row.articles.length,
  };
}

export function toPublicEdition(
  row: MagazineEditionRow,
  lang: Lang,
  image: ImageResolver,
): PublicMagazineEdition {
  return {
    ...toPublicSummary(row, lang, image),
    editorial: pick(row.editorial, row.editorialEn, lang),
    signature: pick(row.signature, row.signatureEn, lang),
    articles: row.articles.map((article) => toPublicArticle(article, lang, image)),
  };
}
