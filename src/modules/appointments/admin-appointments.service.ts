import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { recordAudit, type AuditActor } from '../../common/audit/audit-log.js';
import { ProblemException, notFoundException } from '../../common/problem/problem.js';
import { validationException } from '../../common/validation/validation-exception.js';
import { DAY_MS } from '../../common/time/agency-day.js';
import { AppConfigService } from '../../config/app-config.service.js';
import type { AppointmentStatus, Language, Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { forbiddenException } from '../auth/auth.errors.js';
import type { AuthContext } from '../auth/auth.types.js';
import { hasAnyPermission, type Permission } from '../auth/permissions.js';
import { TOKEN_PURPOSES, hmacDigest, randomToken } from '../auth/tokens.js';
import { ContactsService } from '../contacts/contacts.service.js';
import { formatDoualaDateTime } from '../forms/forms.mapper.js';
import { MailQueueService } from '../mail/mail-queue.service.js';
import { nextReference } from '../requests/reference.js';
import { reasonLabel } from './appointment-labels.js';
import {
  APPOINTMENT_MAIL_SELECT,
  AppointmentMailService,
  type AppointmentMailRow,
} from './appointment-mail.service.js';
import { AppointmentRemindersService } from './appointment-reminders.service.js';
import {
  CLOSED_STATUSES,
  blockingAppointments,
  isSlotTakenError,
  lockSlots,
  slotTakenException,
} from './appointment-slots.js';
import {
  ADMIN_APPOINTMENT_SELECT,
  effectiveStart,
  toAdminAppointment,
  type AdminAppointment,
  type AdminAppointmentRow,
} from './appointment.mapper.js';
import type {
  AdminAppointmentInput,
  AppointmentAction,
  ListAppointmentsQuery,
} from './appointment.schemas.js';
import { AvailabilityService } from './availability.service.js';

/** Réponse de `GET /v1/admin/appointments`. */
export interface AppointmentsAgenda {
  data: AdminAppointment[];
  pending: AdminAppointment[];
}

/** Utilisateur à l'origine d'une action (journal d'activité). */
export interface AppointmentActor {
  auth: AuthContext;
  ip: string | null;
}

export const APPOINTMENT_NOT_FOUND = 'Ce rendez-vous n’existe pas ou ne vous est pas assigné.';
/** Validité maximale du lien d'acceptation d'un autre créneau (au plus tard, le début du créneau proposé). */
export const PROPOSAL_VALIDITY_MS = 7 * DAY_MS;
/** Taille maximale de la file « À confirmer ». */
const MAX_PENDING = 200;

/** Lien du back-office vers un rendez-vous (comme le back-office simulé du site). */
export function adminAppointmentPath(appointmentId: string): string {
  return `/admin/rendez-vous?id=${encodeURIComponent(appointmentId)}`;
}

/** Rôles qui peuvent recevoir un rendez-vous (ceux qui en voient : tous, ou les leurs). */
function isAppointmentRole(role: Parameters<typeof hasAnyPermission>[0]): boolean {
  return hasAnyPermission(role, ['appointments:read', 'appointments:read-assigned']);
}

function conflict(detail: string): ProblemException {
  return new ProblemException({ status: HttpStatus.CONFLICT, type: 'conflict', title: 'Conflit', detail });
}

function notAssignable(): ProblemException {
  return validationException([
    {
      path: 'assignedToId',
      code: 'not_assignable',
      message: 'Choisissez un membre actif qui traite les rendez-vous.',
    },
  ]);
}

const has = (auth: AuthContext, permission: Permission): boolean => auth.permissions.includes(permission);

/** Chargé·e de clientèle (`appointments:read-assigned` seule) : ses rendez-vous uniquement. */
function assignedOnly(auth: AuthContext): boolean {
  return !has(auth, 'appointments:read') && has(auth, 'appointments:read-assigned');
}

function visibleWhere(auth: AuthContext): Prisma.AppointmentWhereInput {
  return assignedOnly(auth) ? { assignedToId: auth.user.id } : {};
}

const auditActor = (actor: AppointmentActor): AuditActor => ({ userId: actor.auth.user.id, ip: actor.ip });

/** Colonnes lues avant une action : affichage, e-mails, état. */
const ACTION_SELECT = {
  ...APPOINTMENT_MAIL_SELECT,
  status: true,
  proposedStartsAt: true,
  assignedToId: true,
  reminderSentAt: true,
} as const;

type ActionRow = AppointmentMailRow & {
  status: AppointmentStatus;
  proposedStartsAt: Date | null;
  assignedToId: string | null;
  reminderSentAt: Date | null;
};

/** « MP-2026-0142 (jeudi 12 novembre 2026 à 14:00) » : libellés du journal et des notifications, sans donnée client. */
function slotOf(reference: string, startsAt: Date): string {
  return `${reference} (${formatDoualaDateTime(startsAt)})`;
}

/**
 * Rendez-vous du back-office (tag « Admin — Rendez-vous ») : agenda d'une période et file « À confirmer », détail,
 * saisie manuelle (confirmée d'office), confirmation, proposition d'un autre créneau (report), annulation, fin,
 * notes internes, assignation. Avec la seule permission `appointments:read-assigned`, tout se limite aux rendez-vous
 * assignés à l'utilisateur (un autre rendez-vous est « introuvable »). Les e-mails au client et le rappel de la
 * veille partent après l'enregistrement ; leur échec ne fait pas échouer l'action.
 */
@Injectable()
export class AdminAppointmentsService {
  private readonly logger = new Logger(AdminAppointmentsService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ContactsService) private readonly contacts: ContactsService,
    @Inject(AvailabilityService) private readonly availability: AvailabilityService,
    @Inject(AppointmentMailService) private readonly mails: AppointmentMailService,
    @Inject(AppointmentRemindersService) private readonly reminders: AppointmentRemindersService,
    @Inject(MailQueueService) private readonly mailQueue: MailQueueService,
    @Inject(AppConfigService) private readonly config: AppConfigService,
  ) {}

  /** `GET /v1/admin/appointments` : rendez-vous dont le début affiché est dans `[from, to[`, et file « À confirmer ». */
  async list(query: ListAppointmentsQuery, auth: AuthContext): Promise<AppointmentsAgenda> {
    let assignee = query.assignee;
    if (assignedOnly(auth)) {
      if (assignee !== undefined && assignee !== 'me' && assignee !== auth.user.id)
        throw forbiddenException('Vous ne voyez que les rendez-vous qui vous sont assignés.');
      assignee = 'me';
    }
    const scope: Prisma.AppointmentWhereInput[] = [visibleWhere(auth)];
    if (assignee === 'me') scope.push({ assignedToId: auth.user.id });
    else if (assignee === 'none') scope.push({ assignedToId: null });
    else if (assignee !== undefined) scope.push({ assignedToId: assignee });
    const range = { gte: new Date(query.from), lt: new Date(query.to) };

    const [rows, pending] = await Promise.all([
      this.prisma.appointment.findMany({
        where: {
          AND: [
            ...scope,
            ...(query.status ? [{ status: query.status }] : []),
            { OR: [{ proposedStartsAt: null, startsAt: range }, { proposedStartsAt: range }] },
          ],
        },
        select: ADMIN_APPOINTMENT_SELECT,
      }) as Promise<AdminAppointmentRow[]>,
      this.prisma.appointment.findMany({
        where: { AND: [...scope, { status: 'A_CONFIRMER' }] },
        select: ADMIN_APPOINTMENT_SELECT,
        orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
        take: MAX_PENDING,
      }) as Promise<AdminAppointmentRow[]>,
    ]);
    const data = [...rows].sort(
      (a, b) => effectiveStart(a).getTime() - effectiveStart(b).getTime() || (a.id < b.id ? -1 : 1),
    );
    return { data: data.map(toAdminAppointment), pending: pending.map(toAdminAppointment) };
  }

  /** `GET /v1/admin/appointments/{id}` */
  async detail(id: string, auth: AuthContext): Promise<AdminAppointment> {
    const row: AdminAppointmentRow | null = await this.prisma.appointment.findFirst({
      where: { id, ...visibleWhere(auth) },
      select: ADMIN_APPOINTMENT_SELECT,
    });
    if (!row) throw notFoundException(APPOINTMENT_NOT_FOUND);
    return toAdminAppointment(row);
  }

  /** Membre actif (mot de passe défini) dont le rôle traite des rendez-vous. */
  private async findAssignable(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, role: true, isActive: true, activatedAt: true },
    });
    if (!user || !user.isActive || user.activatedAt === null || !isAppointmentRole(user.role)) return null;
    return user;
  }

  /** 409 si `[start, end[` chevauche un rendez-vous qui occupe déjà ce créneau (à appeler après `lockSlots`). */
  private async assertFree(tx: Prisma.TransactionClient, start: Date, end: Date, excludeId?: string) {
    const [clash] = await blockingAppointments(tx, { start: start.getTime(), end: end.getTime() }, excludeId);
    if (clash)
      throw slotTakenException(
        `Ce créneau chevauche le rendez-vous ${slotOf(clash.row.reference, new Date(clash.interval.start))}. Choisissez une autre heure.`,
      );
  }

  /**
   * `POST /v1/admin/appointments` : saisie manuelle, confirmée d'office (fiche contact créée ou mise à jour par
   * e-mail, référence `MP-AAAA-NNNN`). Personne chargée : celle qui saisit, sauf choix contraire (permission
   * `appointments:assign`). Lieu : adresse de l'agence par défaut (format Agence) ; lien de visio par défaut (format
   * Visio). E-mail de confirmation avec invitation si `notifyClient`, rappel la veille.
   */
  async create(input: AdminAppointmentInput, actor: AppointmentActor, now: Date): Promise<AdminAppointment> {
    const { auth } = actor;
    const assigneeId = input.assignedToId === undefined ? auth.user.id : input.assignedToId;
    if (assigneeId !== null && assigneeId !== auth.user.id && !has(auth, 'appointments:assign'))
      throw forbiddenException('Seul un responsable peut assigner un rendez-vous à une autre personne.');
    const assignee = assigneeId === null ? null : await this.findAssignable(assigneeId);
    if (assigneeId !== null && !assignee) throw notAssignable();

    const settings = await this.availability.config();
    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(startsAt.getTime() + input.durationMinutes * 60_000);
    const location = input.format === 'AGENCE' ? (input.location ?? settings.agencyAddress) : null;
    const videoLink = input.format === 'VISIO' ? (input.videoLink ?? settings.defaultVideoLink) : null;
    const existing = await this.prisma.contact.findUnique({
      where: { email: input.contact.email },
      select: { language: true },
    });
    const language: Language = existing?.language ?? 'FR';
    const notified = assignee !== null && assignee.id !== auth.user.id ? assignee : null;

    const created = await this.withSlotGuard(() =>
      this.prisma.$transaction(async (tx) => {
        await lockSlots(tx);
        await this.assertFree(tx, startsAt, endsAt);
        const contact = await this.contacts.upsert(
          tx,
          { ...input.contact, source: 'rendez-vous', language },
          now,
        );
        const reference = await nextReference(tx, now);
        const appointment = await tx.appointment.create({
          data: {
            reference,
            requestId: null,
            contactId: contact.id,
            reason: input.reason,
            format: input.format,
            startsAt,
            endsAt,
            status: 'CONFIRME',
            proposedStartsAt: null,
            proposalTokenHash: null,
            proposalExpiresAt: null,
            location,
            videoLink,
            message: null,
            notes: input.notes,
            language,
            assignedToId: assignee?.id ?? null,
            createdById: auth.user.id,
            confirmedAt: now,
            cancelledAt: null,
            completedAt: null,
            reminderSentAt: null,
            isDemo: false,
            createdAt: now,
            updatedAt: now,
          },
          select: { id: true, reference: true },
        });
        if (notified) await this.notifyAssignee(tx, notified.id, appointment, input.reason, startsAt, now);
        await recordAudit(tx, auditActor(actor), {
          action: 'appointment.create',
          entity: 'Appointment',
          entityId: appointment.id,
          label: `A saisi le rendez-vous ${slotOf(reference, startsAt)}`,
          after: {
            status: 'CONFIRME',
            reason: input.reason,
            format: input.format,
            startsAt: startsAt.toISOString(),
            assignedToId: assignee?.id ?? null,
          },
        });
        return appointment;
      }),
    );

    const row = await this.actionRow(created.id);
    if (input.notifyClient) await this.mails.confirmed(row, now);
    await this.reminders.schedule(row, now);
    if (notified) await this.sendAssignmentMail(row, notified, auth.user.name, now);
    return this.detail(created.id, auth);
  }

  /** `PATCH /v1/admin/appointments/{id}` */
  async act(
    id: string,
    action: AppointmentAction,
    actor: AppointmentActor,
    now: Date,
  ): Promise<AdminAppointment> {
    const { auth } = actor;
    const current = await this.prisma.appointment.findFirst({
      where: { id, ...visibleWhere(auth) },
      select: ACTION_SELECT,
    });
    if (!current) throw notFoundException(APPOINTMENT_NOT_FOUND);
    if (action.action === 'assign') {
      if (!has(auth, 'appointments:assign'))
        throw forbiddenException('Seul un responsable peut assigner ou réassigner un rendez-vous.');
    } else if (
      !has(auth, 'appointments:write') &&
      !(has(auth, 'appointments:write-assigned') && current.assignedToId === auth.user.id)
    ) {
      throw forbiddenException('Vous ne pouvez agir que sur les rendez-vous qui vous sont assignés.');
    }

    switch (action.action) {
      case 'confirm':
        await this.confirm(current, action, actor, now);
        break;
      case 'propose':
        await this.propose(current, new Date(action.proposedStartsAt), action.message, actor, now);
        break;
      case 'cancel':
        await this.cancel(current, action.message, actor, now);
        break;
      case 'complete':
        await this.complete(current, actor, now);
        break;
      case 'notes':
        await this.prisma.appointment.update({
          where: { id },
          data: { notes: action.notes, updatedAt: now },
          select: { id: true },
        });
        break;
      case 'assign':
        await this.assign(current, action.assignedToId, actor, now);
        break;
    }
    return this.detail(id, auth);
  }

  /**
   * Confirmation d'une demande « À confirmer », ou d'un autre créneau proposé (le rendez-vous passe sur le créneau
   * proposé, même durée). Lieu et lien de visio : ceux de l'action, sinon ceux du rendez-vous, sinon ceux des
   * disponibilités. E-mail de confirmation avec invitation, rappel la veille.
   */
  private async confirm(
    current: ActionRow,
    action: Extract<AppointmentAction, { action: 'confirm' }>,
    actor: AppointmentActor,
    now: Date,
  ): Promise<void> {
    if (current.status !== 'A_CONFIRMER' && current.status !== 'AUTRE_CRENEAU_PROPOSE')
      throw conflict('Ce rendez-vous n’est plus à confirmer.');
    const settings = await this.availability.config();
    const startsAt = current.proposedStartsAt ?? current.startsAt;
    const endsAt = new Date(startsAt.getTime() + current.endsAt.getTime() - current.startsAt.getTime());
    const moved = startsAt.getTime() !== current.startsAt.getTime();
    const location =
      current.format === 'AGENCE'
        ? (action.location ?? current.location ?? settings.agencyAddress)
        : current.location;
    const videoLink =
      current.format === 'VISIO'
        ? (action.videoLink ?? current.videoLink ?? settings.defaultVideoLink)
        : current.videoLink;

    await this.withSlotGuard(() =>
      this.prisma.$transaction(async (tx) => {
        await lockSlots(tx);
        await this.assertFree(tx, startsAt, endsAt, current.id);
        await tx.appointment.update({
          where: { id: current.id },
          data: {
            status: 'CONFIRME',
            startsAt,
            endsAt,
            proposedStartsAt: null,
            proposalExpiresAt: null,
            location,
            videoLink,
            confirmedAt: now,
            ...(moved ? { reminderSentAt: null } : {}),
            updatedAt: now,
          },
          select: { id: true },
        });
        await recordAudit(tx, auditActor(actor), {
          action: 'appointment.confirm',
          entity: 'Appointment',
          entityId: current.id,
          label: `A confirmé le rendez-vous ${slotOf(current.reference, startsAt)}`,
          before: { status: current.status, startsAt: current.startsAt.toISOString() },
          after: { status: 'CONFIRME', startsAt: startsAt.toISOString() },
        });
      }),
    );
    const row = await this.actionRow(current.id);
    await this.mails.confirmed(row, now);
    await this.reminders.schedule(row, now);
  }

  /**
   * Proposition d'un autre créneau (report) : le créneau proposé est réservé (le créneau d'origine est libéré), le
   * client reçoit un lien d'acceptation valable jusqu'au début du créneau proposé (7 jours au plus). Le rappel d'un
   * rendez-vous déjà confirmé est retiré jusqu'à l'acceptation.
   */
  private async propose(
    current: ActionRow,
    proposedStartsAt: Date,
    message: string | null,
    actor: AppointmentActor,
    now: Date,
  ): Promise<void> {
    if (CLOSED_STATUSES.includes(current.status))
      throw conflict('Ce rendez-vous est clos : impossible de proposer un autre créneau.');
    if (proposedStartsAt.getTime() <= now.getTime())
      throw validationException([
        { path: 'proposedStartsAt', code: 'past', message: 'Choisissez une date et une heure à venir.' },
      ]);
    const duration = current.endsAt.getTime() - current.startsAt.getTime();
    const token = randomToken();
    const expiresAt = new Date(Math.min(proposedStartsAt.getTime(), now.getTime() + PROPOSAL_VALIDITY_MS));

    await this.prisma.$transaction(async (tx) => {
      await lockSlots(tx);
      await this.assertFree(
        tx,
        proposedStartsAt,
        new Date(proposedStartsAt.getTime() + duration),
        current.id,
      );
      await tx.appointment.update({
        where: { id: current.id },
        data: {
          status: 'AUTRE_CRENEAU_PROPOSE',
          proposedStartsAt,
          proposalTokenHash: this.proposalHash(token),
          proposalExpiresAt: expiresAt,
          updatedAt: now,
        },
        select: { id: true },
      });
      await recordAudit(tx, auditActor(actor), {
        action: 'appointment.propose',
        entity: 'Appointment',
        entityId: current.id,
        label: `A proposé un autre créneau pour le rendez-vous ${slotOf(current.reference, proposedStartsAt)}`,
        before: { status: current.status, startsAt: current.startsAt.toISOString() },
        after: { status: 'AUTRE_CRENEAU_PROPOSE', proposedStartsAt: proposedStartsAt.toISOString() },
      });
    });
    if (current.status === 'CONFIRME') await this.reminders.cancel(current);
    await this.mails.proposed(current, proposedStartsAt, token, message);
  }

  private async cancel(current: ActionRow, message: string | null, actor: AppointmentActor, now: Date) {
    if (CLOSED_STATUSES.includes(current.status)) throw conflict('Ce rendez-vous est déjà clos.');
    await this.prisma.$transaction(async (tx) => {
      await tx.appointment.update({
        where: { id: current.id },
        data: {
          status: 'ANNULE',
          cancelledAt: now,
          proposedStartsAt: null,
          proposalTokenHash: null,
          proposalExpiresAt: null,
          updatedAt: now,
        },
        select: { id: true },
      });
      await recordAudit(tx, auditActor(actor), {
        action: 'appointment.cancel',
        entity: 'Appointment',
        entityId: current.id,
        label: `A annulé le rendez-vous ${slotOf(current.reference, current.startsAt)}`,
        before: { status: current.status },
        after: { status: 'ANNULE' },
      });
    });
    await this.reminders.cancel(current);
    await this.mails.cancelled(current, message);
  }

  private async complete(current: ActionRow, actor: AppointmentActor, now: Date) {
    if (current.status !== 'CONFIRME') throw conflict('Seul un rendez-vous confirmé peut être terminé.');
    await this.prisma.$transaction(async (tx) => {
      await tx.appointment.update({
        where: { id: current.id },
        data: { status: 'TERMINE', completedAt: now, updatedAt: now },
        select: { id: true },
      });
      await recordAudit(tx, auditActor(actor), {
        action: 'appointment.complete',
        entity: 'Appointment',
        entityId: current.id,
        label: `A terminé le rendez-vous ${slotOf(current.reference, current.startsAt)}`,
        before: { status: current.status },
        after: { status: 'TERMINE' },
      });
    });
    await this.reminders.cancel(current);
  }

  private async assign(current: ActionRow, assignedToId: string | null, actor: AppointmentActor, now: Date) {
    const { auth } = actor;
    const assignee = assignedToId === null ? null : await this.findAssignable(assignedToId);
    if (assignedToId !== null && !assignee) throw notAssignable();
    if ((assignee?.id ?? null) === current.assignedToId) return;
    const notified = assignee !== null && assignee.id !== auth.user.id ? assignee : null;
    await this.prisma.$transaction(async (tx) => {
      await tx.appointment.update({
        where: { id: current.id },
        data: { assignedToId: assignee?.id ?? null, updatedAt: now },
        select: { id: true },
      });
      if (notified)
        await this.notifyAssignee(tx, notified.id, current, current.reason, effectiveStart(current), now);
      await recordAudit(tx, auditActor(actor), {
        action: 'appointment.assign',
        entity: 'Appointment',
        entityId: current.id,
        label: assignee
          ? `A assigné le rendez-vous ${current.reference} à ${assignee.name}`
          : `A retiré l’assignation du rendez-vous ${current.reference}`,
        before: { assignedToId: current.assignedToId },
        after: { assignedToId: assignee?.id ?? null },
      });
    });
    if (notified) await this.sendAssignmentMail(current, notified, auth.user.name, now);
  }

  /** Notification `ASSIGNMENT` de la personne chargée du rendez-vous. */
  private async notifyAssignee(
    tx: Prisma.TransactionClient,
    userId: string,
    appointment: { id: string; reference: string },
    reason: AppointmentMailRow['reason'],
    startsAt: Date,
    now: Date,
  ): Promise<void> {
    await tx.notification.create({
      data: {
        userId,
        kind: 'ASSIGNMENT',
        title: `Rendez-vous assigné — ${reasonLabel(reason)}, ${formatDoualaDateTime(startsAt)} (${appointment.reference})`,
        link: adminAppointmentPath(appointment.id),
        entityType: 'Appointment',
        entityId: appointment.id,
        readAt: null,
        createdAt: now,
      },
      select: { id: true },
    });
  }

  /** E-mail `team-assignment` (comme pour les demandes) ; un échec est journalisé sans faire échouer l'action. */
  private async sendAssignmentMail(
    row: AppointmentMailRow,
    assignee: { email: string },
    assignedByName: string,
    now: Date,
  ): Promise<void> {
    try {
      await this.mailQueue.enqueue({
        template: 'team-assignment',
        to: assignee.email,
        lang: 'fr',
        reference: row.reference,
        data: {
          reference: row.reference,
          serviceName: `Rendez-vous — ${reasonLabel(row.reason)}, ${formatDoualaDateTime(row.startsAt)}`,
          fullName: row.contact.fullName,
          assignedByName,
          actionUrl: new URL(adminAppointmentPath(row.id), this.config.get('WEB_URL')).toString(),
          assignedAt: now.toISOString(),
        },
      });
    } catch (error) {
      const reason = error instanceof Error ? error.name : 'erreur inconnue';
      this.logger.error(`E-mail d’assignation du rendez-vous ${row.reference} non mis en file (${reason}).`);
    }
  }

  private proposalHash(token: string): string {
    return hmacDigest(this.config.get('TOKEN_SIGNING_SECRET'), TOKEN_PURPOSES.appointmentProposal, token);
  }

  private async actionRow(id: string): Promise<ActionRow> {
    const row = await this.prisma.appointment.findUnique({ where: { id }, select: ACTION_SELECT });
    if (!row) throw notFoundException(APPOINTMENT_NOT_FOUND);
    return row;
  }

  /** Index unique du créneau violé malgré le verrou (écriture concurrente hors API) : 409 `slot-taken`. */
  private async withSlotGuard<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (isSlotTakenError(error)) throw slotTakenException();
      throw error;
    }
  }
}
