import { Inject, Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service.js';
import { TURNSTILE_TEST_SECRET } from '../../config/env.schema.js';

/** Vérification côté serveur des jetons Cloudflare Turnstile. */
export const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** Délai maximal de la vérification : au-delà, le jeton est refusé (le visiteur peut renvoyer le formulaire). */
export const TURNSTILE_TIMEOUT_MS = 5_000;

interface SiteverifyResponse {
  success?: unknown;
  'error-codes'?: unknown;
}

/**
 * Vérifie un jeton Turnstile auprès de Cloudflare (`fetch` natif, délai court).
 *
 * - Jeton vide : accepté hors production seulement (le site envoie un jeton vide quand aucune clé publique n'est
 *   configurée) ; refusé en production.
 * - Hors production avec la clé d'essai (`1x0000…AA`), qui valide toujours : aucun appel réseau.
 * - Erreur réseau, délai dépassé ou réponse illisible : jeton refusé (fermeture par défaut).
 */
@Injectable()
export class TurnstileService {
  private readonly logger = new Logger(TurnstileService.name);

  constructor(@Inject(AppConfigService) private readonly config: AppConfigService) {}

  async verify(token: string, remoteIp: string | undefined): Promise<boolean> {
    const production = this.config.isProduction;
    if (token.trim() === '') return !production;

    const secret = this.config.get('TURNSTILE_SECRET_KEY');
    if (!production && secret === TURNSTILE_TEST_SECRET) return true;

    const body = new URLSearchParams({ secret, response: token });
    if (remoteIp) body.set('remoteip', remoteIp);
    try {
      const response = await fetch(TURNSTILE_VERIFY_URL, {
        method: 'POST',
        body,
        signal: AbortSignal.timeout(TURNSTILE_TIMEOUT_MS),
      });
      if (!response.ok) {
        this.logger.warn(`Vérification Turnstile impossible (HTTP ${String(response.status)}).`);
        return false;
      }
      const result = (await response.json()) as SiteverifyResponse;
      if (result.success === true) return true;
      // Codes d'erreur de Cloudflare seulement (ni jeton ni adresse IP dans les journaux).
      const codes = Array.isArray(result['error-codes']) ? result['error-codes'].map(String).join(', ') : '';
      this.logger.warn(`Jeton Turnstile refusé${codes ? ` (${codes})` : ''}.`);
      return false;
    } catch (error) {
      const reason = error instanceof Error ? error.name : 'erreur inconnue';
      this.logger.warn(`Vérification Turnstile impossible (${reason}).`);
      return false;
    }
  }
}
