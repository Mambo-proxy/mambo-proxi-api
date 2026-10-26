import { Injectable } from '@nestjs/common';
import {
  argon2id,
  hash as argon2Hash,
  needsRehash as argon2NeedsRehash,
  verify as argon2Verify,
} from 'argon2';

/**
 * Paramètres argon2id (RFC 9106, seconde configuration recommandée) : 64 Mio, 3 passes, 4 voies. Le format PHC du
 * condensat garde les paramètres : on peut les renforcer plus tard sans invalider les mots de passe existants
 * (`needsRehash`, réécriture à la connexion suivante).
 */
export const ARGON2_OPTIONS = {
  type: argon2id,
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 4,
} as const;

/** Hachage et vérification des mots de passe (argon2id). */
@Injectable()
export class PasswordService {
  /** Condensat d'un mot de passe inexistant, calculé une fois : égalise le temps de réponse d'un compte inconnu. */
  private dummyHash: Promise<string> | undefined;

  hash(password: string): Promise<string> {
    return argon2Hash(password, ARGON2_OPTIONS);
  }

  /** Vérifie un mot de passe ; sans condensat (compte inconnu ou invitation en cours), le calcul a lieu quand même. */
  async verify(digest: string | null | undefined, password: string): Promise<boolean> {
    if (!digest) {
      this.dummyHash ??= argon2Hash('mot-de-passe-factice-pour-le-temps-constant', ARGON2_OPTIONS);
      await argon2Verify(await this.dummyHash, password).catch(() => false);
      return false;
    }
    try {
      return await argon2Verify(digest, password);
    } catch {
      // Condensat illisible : refus, sans détail.
      return false;
    }
  }

  /** Le condensat a-t-il été calculé avec d'autres paramètres que ceux d'aujourd'hui ? */
  needsRehash(digest: string): boolean {
    return argon2NeedsRehash(digest, ARGON2_OPTIONS);
  }
}
