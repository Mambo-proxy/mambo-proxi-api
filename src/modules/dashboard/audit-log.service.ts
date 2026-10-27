import { Inject, Injectable } from '@nestjs/common';
import { isPlainObject } from '../../common/i18n/translations.js';
import { pageWindow, paginationMeta, type Page } from '../../common/pagination/pagination.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { USER_REF_SELECT, toUserRef, type UserRef } from '../users/user-ref.js';
import type { AuditLogQuery } from './dashboard.schemas.js';

/** Schéma `AuditLogEntry` du contrat. */
export interface AuditLogEntry {
  id: string;
  actor: UserRef | null;
  action: string;
  entity: string;
  entityId: string | null;
  label: string;
  diff: Record<string, unknown> | null;
  ip: string | null;
  createdAt: string;
}

/**
 * `diff` du contrat, déduit des états avant / après enregistrés : pour chaque champ modifié, `[avant, après]` ; un
 * seul des deux états → ses champs tels quels (ex. `{ fields: [...] }` des paramètres) ; rien → `null`.
 */
export function auditDiff(before: Prisma.JsonValue, after: Prisma.JsonValue): Record<string, unknown> | null {
  const old = isPlainObject(before) ? before : null;
  const next = isPlainObject(after) ? after : null;
  if (old === null && next === null) return null;
  if (old === null) return Object.keys(next ?? {}).length === 0 ? null : { ...next };
  if (next === null) return Object.keys(old).length === 0 ? null : { ...old };
  const diff: Record<string, unknown> = {};
  for (const key of new Set([...Object.keys(old), ...Object.keys(next)])) {
    const previous = old[key] ?? null;
    const current = next[key] ?? null;
    if (JSON.stringify(previous) !== JSON.stringify(current)) diff[key] = [previous, current];
  }
  return Object.keys(diff).length === 0 ? null : diff;
}

/** Journal d'activité (`GET /v1/admin/audit-log`, permission `audit:read`) : du plus récent au plus ancien. */
@Injectable()
export class AuditLogService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(query: AuditLogQuery): Promise<Page<AuditLogEntry>> {
    const where: Prisma.AuditLogWhereInput = {
      ...(query.actor ? { actorId: query.actor } : {}),
      ...(query.entity ? { entity: query.entity } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        select: {
          id: true,
          action: true,
          entity: true,
          entityId: true,
          label: true,
          before: true,
          after: true,
          ip: true,
          createdAt: true,
          actor: { select: USER_REF_SELECT },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...pageWindow(query.page, query.pageSize),
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return {
      data: rows.map((row) => ({
        id: row.id,
        actor: row.actor ? toUserRef(row.actor) : null,
        action: row.action,
        entity: row.entity,
        entityId: row.entityId,
        label: row.label,
        diff: auditDiff(row.before, row.after),
        ip: row.ip,
        createdAt: row.createdAt.toISOString(),
      })),
      meta: paginationMeta(query.page, query.pageSize, total),
    };
  }
}
