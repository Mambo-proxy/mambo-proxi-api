import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/** Limites par défaut (par adresse IP) ; les routes sensibles les resserrent avec `@Throttle()`. */
export const DEFAULT_THROTTLE = { ttl: 60_000, limit: 120 } as const;

/** Formulaires publics (`@Throttle({ default: PUBLIC_FORM_THROTTLE })`) : 5 envois par minute, par IP et par formulaire. */
export const PUBLIC_FORM_THROTTLE = { ttl: 60_000, limit: 5 } as const;

/**
 * Limitation de débit globale. En-têtes alignés sur le contrat (`components.responses.TooManyRequests`) :
 * `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` et `Retry-After` (en secondes) en cas de 429.
 * Le corps de la réponse 429 est produit par le filtre global (`rate-limited`).
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected override headerPrefix = 'RateLimit';
}
