import { asObject, readBoolean } from '../../common/json/json-read.js';
import type { PageGroup } from '../../generated/prisma/client.js';
import { categoryHref, serviceHref } from '../catalog/catalog.mapper.js';

/** Schéma `SitemapEntry` du contrat. */
export interface SitemapEntry {
  path: string;
  lastModified: string;
  changeFrequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
  priority: number;
}

/** Pages sans intérêt pour les moteurs de recherche (confirmations, erreurs, liens reçus par e-mail). */
export const NON_INDEXED_PAGE_KEYS = [
  'devis-confirmation',
  'questionnaire',
  '404',
  'erreur',
  'maintenance',
  'newsletter-confirmation',
  'newsletter-desinscription',
] as const;

type Frequency = SitemapEntry['changeFrequency'];

/** Priorité et fréquence de mise à jour des pages éditoriales (pages fixes du site). */
const PAGE_HINTS: Partial<Record<string, [priority: number, frequency: Frequency]>> = {
  accueil: [1, 'weekly'],
  services: [0.9, 'weekly'],
  devis: [0.9, 'monthly'],
  contact: [0.8, 'monthly'],
  'avis-clients': [0.7, 'weekly'],
  recrutement: [0.6, 'weekly'],
  magazine: [0.6, 'weekly'],
  'suivi-mambo': [0.4, 'monthly'],
};

const GROUP_HINTS: Record<PageGroup, [priority: number, frequency: Frequency]> = {
  principales: [0.6, 'monthly'],
  formulaires: [0.5, 'monthly'],
  legales: [0.2, 'yearly'],
  systeme: [0.1, 'yearly'],
};

export interface SitemapPageRecord {
  key: string;
  path: string;
  group: PageGroup;
  seo: unknown;
  publishedAt: Date | null;
}

export interface SitemapSources {
  pages: readonly SitemapPageRecord[];
  categories: readonly { slug: string; updatedAt: Date }[];
  services: readonly {
    slug: string;
    kind: 'SERVICE' | 'FORMULA';
    updatedAt: Date;
    category: { slug: string };
  }[];
  jobs: readonly { slug: string; updatedAt: Date }[];
}

function normalizePath(path: string): string {
  return path.startsWith('/') ? path : `/${path}`;
}

/**
 * Plan du site : pages publiées indexables (triées par priorité), rubriques, fiches des services publiés (une formule
 * n'a pas de fiche) et offres d'emploi en ligne.
 */
export function toSitemap(sources: SitemapSources): SitemapEntry[] {
  const pages = sources.pages
    .filter((page) => page.publishedAt !== null && !readBoolean(asObject(page.seo), 'noindex', false))
    .map((page): SitemapEntry => {
      const [priority, changeFrequency] = PAGE_HINTS[page.key] ?? GROUP_HINTS[page.group];
      return {
        path: page.key === 'accueil' ? '/' : normalizePath(page.path),
        lastModified: (page.publishedAt ?? new Date(0)).toISOString(),
        changeFrequency,
        priority,
      };
    })
    .sort((a, b) => b.priority - a.priority || a.path.localeCompare(b.path));

  return [
    ...pages,
    ...sources.categories.map((category): SitemapEntry => ({
      path: categoryHref(category.slug),
      lastModified: category.updatedAt.toISOString(),
      changeFrequency: 'monthly',
      priority: 0.8,
    })),
    ...sources.services
      .filter((service) => service.kind === 'SERVICE')
      .map((service): SitemapEntry => ({
        path: serviceHref(service.category.slug, service.slug, service.kind),
        lastModified: service.updatedAt.toISOString(),
        changeFrequency: 'monthly',
        priority: 0.8,
      })),
    ...sources.jobs.map((job): SitemapEntry => ({
      path: `/recrutement/${job.slug}`,
      lastModified: job.updatedAt.toISOString(),
      changeFrequency: 'weekly',
      priority: 0.5,
    })),
  ];
}
