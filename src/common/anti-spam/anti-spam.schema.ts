import { HttpStatus } from '@nestjs/common';
import { z } from 'zod';
import { ProblemException } from '../problem/problem.js';

/** Délai minimal de remplissage d'un formulaire (schéma `AntiSpam` du contrat : 3 s). */
export const MIN_FILL_DURATION_MS = 3_000;

/**
 * Schéma `AntiSpam` du contrat. Le champ piège n'est pas limité à 0 caractère ici, contrairement au contrat :
 * un piège rempli reçoit une réponse de succès factice (sans enregistrement) plutôt qu'une erreur 422 qui
 * signalerait au robot le champ à laisser vide.
 */
export const antiSpamSchema = z.object({
  turnstileToken: z.string().max(4096),
  honeypot: z.string().max(4096).optional(),
  startedAt: z.iso.datetime({ offset: true }),
});
export type AntiSpamInput = z.output<typeof antiSpamSchema>;

/** Résultat des contrôles locaux (avant la vérification Turnstile). */
export type AntiSpamVerdict = 'ok' | 'trap' | 'too-fast';

/**
 * Contrôles sans appel réseau : champ piège rempli → `trap` ; formulaire envoyé moins de 3 s après son ouverture →
 * `too-fast`. Une date d'ouverture dans le futur (horloge du visiteur en avance) est tolérée : seule la vérification
 * Turnstile fait alors foi.
 */
export function evaluateAntiSpam(antiSpam: AntiSpamInput, now: Date): AntiSpamVerdict {
  if (antiSpam.honeypot !== undefined && antiSpam.honeypot.trim() !== '') return 'trap';
  const elapsed = now.getTime() - new Date(antiSpam.startedAt).getTime();
  if (elapsed >= 0 && elapsed < MIN_FILL_DURATION_MS) return 'too-fast';
  return 'ok';
}

/** Réponse `SpamRejected` du contrat (400 `spam-check-failed`). */
export function spamRejectedException(): ProblemException {
  return new ProblemException({
    status: HttpStatus.BAD_REQUEST,
    type: 'spam-check-failed',
    title: 'Vérification de sécurité échouée',
    detail: "La vérification anti-robot n'a pas abouti. Rechargez la page puis réessayez.",
  });
}
