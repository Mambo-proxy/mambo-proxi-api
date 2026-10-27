import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { Prisma, Role } from '../../generated/prisma/client.js';
import { ProblemException, notFoundException } from '../../common/problem/problem.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AccountLinksService } from '../auth/account-links.service.js';
import { ONLINE_WINDOW_MINUTES } from '../auth/auth.constants.js';
import { AuthService } from '../auth/auth.service.js';
import type { AuthUser } from '../auth/auth.types.js';
import { roleLabel } from '../auth/permissions.js';
import type { InviteUserInput, UpdateUserInput } from './users.schemas.js';
import {
  ADMIN_USER_SELECT,
  compareByPresence,
  toAdminUser,
  toPresence,
  type AdminUser,
  type AdminUserRow,
  type TeamPresence,
} from './users.mapper.js';

/** Demandes ouvertes et rendez-vous à venir (`openTasks` de la présence). */
const OPEN_REQUEST_STATUSES = ['NOUVELLE', 'EN_COURS'] as const;
const UPCOMING_APPOINTMENT_STATUSES = ['A_CONFIRMER', 'CONFIRME', 'AUTRE_CRENEAU_PROPOSE'] as const;

function conflict(detail: string): ProblemException {
  return new ProblemException({ status: HttpStatus.CONFLICT, type: 'conflict', title: 'Conflit', detail });
}

const userNotFound = (): ProblemException => notFoundException('Cet utilisateur n’existe plus.');

function prismaCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
}

/** Administrateur actif : rôle ADMIN, compte actif et activé (mot de passe défini). */
function isActiveAdmin(user: { role: Role; isActive: boolean; activatedAt: Date | null }): boolean {
  return user.role === 'ADMIN' && user.isActive && user.activatedAt !== null;
}

/** Contexte de l'administrateur à l'origine d'une modification (journal d'activité). */
export interface Actor {
  user: AuthUser;
  ip: string | null;
}

/**
 * Utilisateurs du back-office (tag « Admin — Utilisateurs ») : liste, présence de l'équipe, rôles, invitation,
 * modification, désactivation, suppression et réinitialisation par un administrateur. Chaque modification est
 * inscrite au journal d'activité (sans adresse e-mail ni secret).
 */
@Injectable()
export class UsersService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AccountLinksService) private readonly links: AccountLinksService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  /** `GET /v1/admin/users` : par date de création, puis par nom. */
  async list(): Promise<AdminUser[]> {
    const rows: AdminUserRow[] = await this.prisma.user.findMany({
      select: ADMIN_USER_SELECT,
      orderBy: [{ createdAt: 'asc' }, { name: 'asc' }],
    });
    return rows.map(toAdminUser);
  }

  /**
   * `GET /v1/admin/users/presence` : membres actifs (statut `ACTIF`) ; « en ligne » = activité depuis moins de
   * 5 minutes sur une session encore valide.
   */
  async presence(now: Date): Promise<TeamPresence> {
    const members = await this.prisma.user.findMany({
      where: { isActive: true, activatedAt: { not: null } },
      select: { id: true, name: true, role: true, lastActiveAt: true, lastLoginAt: true },
    });
    const ids = members.map((member) => member.id);
    const cutoff = new Date(now.getTime() - ONLINE_WINDOW_MINUTES * 60_000);
    const [sessions, requests, appointments] = await Promise.all([
      this.prisma.session.findMany({
        where: {
          userId: { in: ids },
          revokedAt: null,
          expiresAt: { gt: now },
          lastActiveAt: { gte: cutoff },
        },
        select: { userId: true },
      }),
      this.prisma.request.findMany({
        where: { assignedToId: { in: ids }, status: { in: [...OPEN_REQUEST_STATUSES] }, anonymizedAt: null },
        select: { assignedToId: true },
      }),
      this.prisma.appointment.findMany({
        where: {
          assignedToId: { in: ids },
          status: { in: [...UPCOMING_APPOINTMENT_STATUSES] },
          endsAt: { gte: now },
        },
        select: { assignedToId: true },
      }),
    ]);
    const online = new Set(sessions.map((session) => session.userId));
    const tasks = new Map<string, number>();
    for (const { assignedToId } of [...requests, ...appointments])
      if (assignedToId) tasks.set(assignedToId, (tasks.get(assignedToId) ?? 0) + 1);

    const data = members
      .map((member) => toPresence(member, online.has(member.id), tasks.get(member.id) ?? 0))
      .sort(compareByPresence);
    return {
      onlineWindowMinutes: ONLINE_WINDOW_MINUTES,
      onlineCount: data.filter((member) => member.online).length,
      generatedAt: now.toISOString(),
      data,
    };
  }

  /** `POST /v1/admin/users/invite` : compte créé sans mot de passe, lien valable 7 jours. */
  async invite(input: InviteUserInput, actor: Actor, now: Date): Promise<AdminUser> {
    const existing = await this.prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true },
    });
    if (existing) throw conflict('Un utilisateur utilise déjà cette adresse.');
    let created: AdminUserRow;
    try {
      created = await this.prisma.user.create({
        data: {
          email: input.email,
          name: input.name,
          role: input.role,
          isActive: true,
          passwordHash: null,
          activatedAt: null,
          invitedAt: now,
          invitedById: actor.user.id,
          lastLoginAt: null,
          lastActiveAt: null,
        },
        select: ADMIN_USER_SELECT,
      });
    } catch (error) {
      if (prismaCode(error) === 'P2002') throw conflict('Un utilisateur utilise déjà cette adresse.');
      throw error;
    }
    await this.links.sendInvitation(created, created.role, actor.user.id, now);
    await this.audit(
      actor,
      'user.invite',
      created.id,
      `A invité ${created.name} (${roleLabel(created.role)})`,
      null,
      {
        name: created.name,
        role: created.role,
      },
    );
    return toAdminUser(created);
  }

  private async findRow(id: string): Promise<AdminUserRow> {
    const row = await this.prisma.user.findUnique({ where: { id }, select: ADMIN_USER_SELECT });
    if (!row) throw userNotFound();
    return row;
  }

  /** Reste-t-il un autre administrateur actif que `excludedId` ? */
  private async hasOtherActiveAdmin(excludedId: string): Promise<boolean> {
    const count = await this.prisma.user.count({
      where: { id: { not: excludedId }, role: 'ADMIN', isActive: true, activatedAt: { not: null } },
    });
    return count > 0;
  }

  /**
   * `PATCH /v1/admin/users/{id}` : nom, rôle, activation. Le dernier administrateur actif ne peut être ni
   * rétrogradé ni désactivé ; on ne peut pas désactiver son propre compte. Désactivation : sessions, appareils de
   * confiance et codes révoqués aussitôt. Un changement de rôle s'applique dès la requête suivante.
   */
  async update(id: string, input: UpdateUserInput, actor: Actor, now: Date): Promise<AdminUser> {
    const before = await this.findRow(id);
    if (input.isActive === false && id === actor.user.id)
      throw conflict('Vous ne pouvez pas désactiver votre propre compte.');
    const after = {
      role: input.role ?? before.role,
      isActive: input.isActive ?? before.isActive,
      activatedAt: before.activatedAt,
    };
    if (isActiveAdmin(before) && !isActiveAdmin(after) && !(await this.hasOtherActiveAdmin(id)))
      throw conflict('Impossible de retirer le dernier administrateur actif.');

    const updated: AdminUserRow = await this.prisma.user.update({
      where: { id },
      data: {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.role === undefined ? {} : { role: input.role }),
        ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
      },
      select: ADMIN_USER_SELECT,
    });
    if (before.isActive && !updated.isActive) await this.auth.revokeCredentials(id, now);

    await this.audit(
      actor,
      'user.update',
      id,
      this.updateLabel(before, updated),
      { name: before.name, role: before.role, isActive: before.isActive },
      { name: updated.name, role: updated.role, isActive: updated.isActive },
    );
    return toAdminUser(updated);
  }

  private updateLabel(before: AdminUserRow, after: AdminUserRow): string {
    if (before.isActive && !after.isActive) return `A désactivé ${after.name}`;
    if (!before.isActive && after.isActive) return `A réactivé ${after.name}`;
    if (before.role !== after.role) return `A donné le rôle ${roleLabel(after.role)} à ${after.name}`;
    return `A modifié l’utilisateur ${after.name}`;
  }

  /**
   * `DELETE /v1/admin/users/{id}`. Refus (409) : son propre compte, le dernier administrateur actif, ou un
   * utilisateur qui a rédigé des notes sur des demandes (historique à conserver : le désactiver).
   */
  async remove(id: string, actor: Actor): Promise<void> {
    const user = await this.findRow(id);
    if (id === actor.user.id) throw conflict('Vous ne pouvez pas supprimer votre propre compte.');
    if (isActiveAdmin(user) && !(await this.hasOtherActiveAdmin(id)))
      throw conflict('Impossible de supprimer le dernier administrateur actif.');
    const historyConflict = (): ProblemException =>
      conflict(
        'Cet utilisateur a un historique dans les demandes : désactivez-le plutôt que de le supprimer.',
      );
    if ((await this.prisma.requestNote.count({ where: { authorId: id } })) > 0) throw historyConflict();
    try {
      await this.prisma.user.delete({ where: { id } });
    } catch (error) {
      if (prismaCode(error) === 'P2003') throw historyConflict();
      throw error;
    }
    await this.audit(actor, 'user.delete', id, `A supprimé l’utilisateur ${user.name}`, {
      name: user.name,
      role: user.role,
    });
  }

  /**
   * `POST /v1/admin/users/{id}/reset-password` : lien de réinitialisation (1 h) et sessions révoquées ; pour une
   * invitation pas encore acceptée, nouvelle invitation (7 jours). Compte désactivé : 409.
   */
  async sendReset(id: string, actor: Actor, now: Date): Promise<{ message: string }> {
    const user = await this.findRow(id);
    if (!user.isActive)
      throw conflict('Ce compte est désactivé : réactivez-le avant de lui envoyer un lien.');
    if (user.activatedAt === null) {
      await this.links.sendInvitation(user, user.role, actor.user.id, now);
      await this.audit(actor, 'user.invite-resend', id, `A renvoyé l’invitation de ${user.name}`);
      return { message: `Invitation renvoyée à ${user.email}.` };
    }
    await this.auth.revokeCredentials(id, now);
    await this.links.sendPasswordReset(user, actor.user.id, now);
    await this.audit(actor, 'user.reset-password', id, `A envoyé un lien de réinitialisation à ${user.name}`);
    return { message: `Lien de réinitialisation envoyé à ${user.email}.` };
  }

  private async audit(
    actor: Actor,
    action: string,
    entityId: string,
    label: string,
    before?: Prisma.InputJsonObject | null,
    after?: Prisma.InputJsonObject | null,
  ): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        actorId: actor.user.id,
        action,
        entity: 'User',
        entityId,
        label,
        ...(before ? { before } : {}),
        ...(after ? { after } : {}),
        ip: actor.ip,
      },
      select: { id: true },
    });
  }
}
