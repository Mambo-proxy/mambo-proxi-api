import { applyDecorators, Header } from '@nestjs/common';

/**
 * Cache HTTP des lectures publiques (site, catalogue, pages, zones).
 *
 * Le contrat ne fixe ni durée de cache ni en-tête `ETag` : le site met en cache par tags de revalidation
 * (`settings`, `navigation`, `zones`…), invalidés à chaque publication depuis le back-office. Les réponses peuvent
 * donc être conservées par un cache partagé, mais doivent être revalidées à chaque utilisation (`no-cache`) pour qu'une
 * publication soit visible aussitôt. La revalidation est peu coûteuse : Express calcule un `ETag` faible sur le corps
 * de chaque réponse (réglage `etag` de `configureApp`) et répond `304 Not Modified`, sans corps, à une requête
 * `If-None-Match` qui le reprend.
 */
export const PUBLIC_CACHE_CONTROL = 'public, no-cache';

/** Aperçu d'un brouillon (jeton `?preview=` du back-office) : jamais conservé par un cache. */
export const PREVIEW_CACHE_CONTROL = 'private, no-store';

/** Réglage Express du calcul de l'`ETag` des réponses (`W/"<longueur>-<empreinte>"`). */
export const ETAG_MODE = 'weak';

/** En-tête `Cache-Control` d'une lecture publique (à placer sur la méthode du contrôleur). */
export function PublicCache(): MethodDecorator {
  return applyDecorators(Header('Cache-Control', PUBLIC_CACHE_CONTROL));
}
