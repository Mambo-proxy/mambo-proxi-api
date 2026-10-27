import type { Prisma } from '../../generated/prisma/client.js';

/** Auteur d'une action du back-office (journal d'activité). */
export interface AuditActor {
  userId: string;
  ip: string | null;
}

/**
 * Ligne du journal d'activité (`audit_logs`). Le libellé et les états avant / après ne contiennent aucune donnée
 * personnelle des clients (ni nom, ni adresse, ni téléphone) : seulement références, statuts et membres de l'équipe.
 */
export interface AuditEntry {
  action: string;
  entity: string;
  entityId: string | null;
  label: string;
  before?: Prisma.InputJsonObject | null;
  after?: Prisma.InputJsonObject | null;
}

export async function recordAudit(
  client: Pick<Prisma.TransactionClient, 'auditLog'>,
  actor: AuditActor,
  entry: AuditEntry,
): Promise<void> {
  await client.auditLog.create({
    data: {
      actorId: actor.userId,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId,
      label: entry.label,
      ...(entry.before ? { before: entry.before } : {}),
      ...(entry.after ? { after: entry.after } : {}),
      ip: actor.ip,
    },
    select: { id: true },
  });
}
