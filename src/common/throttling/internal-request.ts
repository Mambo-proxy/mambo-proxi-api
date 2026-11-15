import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * En-tête des appels serveur du site (rendus Next.js par le réseau interne `http://api:4000`). Ces appels arrivent
 * tous de l'adresse du conteneur `web` : limités comme un visiteur, ils partageraient un seul quota pour tout le
 * site. Ils sont reconnus par un jeton dérivé de `REVALIDATE_SECRET`, déjà partagé par l'API et le site.
 */
export const INTERNAL_TOKEN_HEADER = 'x-internal-token';

/** Jeton envoyé par le site (même calcul dans `mambo-proxi-web/src/lib/api/internal-token.ts`). */
export function internalToken(secret: string): string {
  return createHmac('sha256', secret).update('mambo-proxi:internal-api').digest('hex');
}

/** Vrai si la requête porte le jeton des appels serveur du site (comparaison en temps constant). */
export function isInternalRequest(headers: Record<string, unknown>, secret: string): boolean {
  const received = headers[INTERNAL_TOKEN_HEADER];
  if (typeof received !== 'string') return false;
  const expected = Buffer.from(internalToken(secret));
  const actual = Buffer.from(received);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
