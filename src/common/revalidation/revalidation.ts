import type { Prisma } from '../../generated/prisma/client.js';

/**
 * Point d'accroche de la revalidation du site (docs/05 §3.4) : chaque modification visible sur le site public
 * (publication, dépublication, enregistrement d'un contenu publié, paramètres, zones) inscrit, dans la même
 * transaction, une demande `revalidation_requests` (`PENDING`) avec les étiquettes de cache du site
 * (`mambo-proxi-web/src/lib/api/tags.ts`). L'envoi (`POST {WEB_URL}/api/revalidate`, réessais) sera fait par le
 * module de revalidation ; d'ici là, les lectures publiques restent à jour d'elles-mêmes : elles sont relues à
 * chaque requête (`Cache-Control: public, no-cache` + `ETag` recalculé sur le corps).
 */
export const CACHE_TAGS = {
  settings: 'settings',
  navigation: 'navigation',
  redirects: 'redirects',
  sitemap: 'sitemap',
  categories: 'categories',
  services: 'services',
  zones: 'zones',
  reviews: 'reviews',
  page: (key: string) => `page:${key}`,
  category: (slug: string) => `category:${slug}`,
  service: (slug: string) => `service:${slug}`,
  jobs: 'jobs',
  job: (slug: string) => `job:${slug}`,
} as const;

export async function requestRevalidation(
  client: Pick<Prisma.TransactionClient, 'revalidationRequest'>,
  tags: Iterable<string>,
): Promise<void> {
  const unique = [...new Set(tags)].sort();
  if (unique.length === 0) return;
  await client.revalidationRequest.create({ data: { tags: unique }, select: { id: true } });
}
