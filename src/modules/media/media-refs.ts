import type { ProblemFieldError } from '../../common/problem/problem.js';
import type { MediaService } from './media.service.js';

/** Image référencée par un contenu du back-office, avec le chemin du champ (erreur 422). */
export interface MediaReference {
  path: string;
  id: string | null | undefined;
}

export const UNKNOWN_MEDIA_MESSAGE = 'Cette image n’existe pas dans la médiathèque.';

/**
 * Erreurs des images inconnues (une requête) : les contenus ne font que référencer des médias déjà présents dans
 * la médiathèque (l'envoi des fichiers relève de `POST /v1/admin/media`).
 */
export async function unknownMediaErrors(
  media: MediaService,
  references: readonly MediaReference[],
): Promise<ProblemFieldError[]> {
  const ids = references
    .map((reference) => reference.id)
    .filter((id): id is string => typeof id === 'string');
  const unknown = await media.unknownIds(ids);
  return references
    .filter((reference) => typeof reference.id === 'string' && unknown.has(reference.id))
    .map((reference) => ({ path: reference.path, code: 'unknown_media', message: UNKNOWN_MEDIA_MESSAGE }));
}
