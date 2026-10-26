import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

export const REQUEST_ID_HEADER = 'X-Request-Id';

/** Identifiant transmis par le client ou le mandataire inverse, accepté s'il est court et sans caractère spécial. */
const ACCEPTED_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

/**
 * Identifiant de la requête : repris de l'en-tête `X-Request-Id` s'il est valide, sinon généré (UUID v4).
 * Il est renvoyé dans la réponse et figure dans chaque ligne de journal de la requête.
 */
export function resolveRequestId(req: IncomingMessage, res: ServerResponse): string {
  const header = req.headers['x-request-id'];
  const candidate = Array.isArray(header) ? header[0] : header;
  const id = candidate !== undefined && ACCEPTED_REQUEST_ID.test(candidate) ? candidate : randomUUID();
  res.setHeader(REQUEST_ID_HEADER, id);
  return id;
}
