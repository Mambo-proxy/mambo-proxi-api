import { Inject, Injectable } from '@nestjs/common';
import { evaluateAntiSpam, spamRejectedException, type AntiSpamInput } from './anti-spam.schema.js';
import { TurnstileService } from './turnstile.service.js';

/** Issue de la protection anti-spam : envoi accepté, ou piège rempli (succès factice sans enregistrement). */
export type AntiSpamOutcome = 'accepted' | 'trapped';

/**
 * Protection commune des formulaires publics (schéma `AntiSpam` du contrat), dans l'ordre : champ piège (aucun appel
 * réseau pour un robot), délai minimal de remplissage, puis jeton Turnstile. Délai trop court ou jeton refusé →
 * 400 `spam-check-failed` (réponse `SpamRejected`).
 */
@Injectable()
export class AntiSpamService {
  constructor(@Inject(TurnstileService) private readonly turnstile: TurnstileService) {}

  async check(antiSpam: AntiSpamInput, remoteIp: string | undefined, now: Date): Promise<AntiSpamOutcome> {
    const verdict = evaluateAntiSpam(antiSpam, now);
    if (verdict === 'trap') return 'trapped';
    if (verdict === 'too-fast') throw spamRejectedException();
    if (!(await this.turnstile.verify(antiSpam.turnstileToken, remoteIp))) throw spamRejectedException();
    return 'accepted';
  }
}
