import type { Request } from 'express';
import type { AuditActor } from '../../common/audit/audit-log.js';
import type { AuthContext } from './auth.types.js';

/** Auteur d'une action du back-office pour le journal d'activité : membre connecté et adresse IP. */
export function auditActor(auth: AuthContext, request: Request): AuditActor {
  return { userId: auth.user.id, ip: request.ip ?? null };
}
