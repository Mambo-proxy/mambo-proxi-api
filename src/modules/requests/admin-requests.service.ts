import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { recordAudit, type AuditActor } from '../../common/audit/audit-log.js';
import { toCsv } from '../../common/csv/csv.js';
import { paginationMeta, pageWindow, type Page } from '../../common/pagination/pagination.js';
import { ProblemException, notFoundException } from '../../common/problem/problem.js';
import { DAY_MS, doualaDate } from '../../common/time/agency-day.js';
import { AppConfigService } from '../../config/app-config.service.js';
import { Prisma, type RequestStatus } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { forbiddenException } from '../auth/auth.errors.js';
import type { AuthContext } from '../auth/auth.types.js';
import { isAssignableRole, type Permission } from '../auth/permissions.js';
import { MailQueueService } from '../mail/mail-queue.service.js';
import { anonymizeReviewsOfRequests } from '../reviews/review-erasure.js';
import { SETTING_KEYS } from '../settings/settings.constants.js';
import { StorageService, type SignedUrl } from '../storage/storage.service.js';
import { ANONYMIZED_FILE_NAME } from '../storage/storage.types.js';
import { SurveyInvitationsService } from '../surveys/survey-invitations.service.js';
import { nextReference } from './reference.js';
import { requestFiltersWhere, requestViewer, visibleRequestsWhere } from './request-filters.js';
import {
  REQUEST_DETAIL_SELECT,
  REQUEST_LIST_SELECT,
  REQUEST_STATUS_LABELS,
  REQUEST_STATUS_ORDER,
  REQUEST_TYPE_LABELS,
  assigneeIdsOf,
  toRequestDetail,
  toRequestListItem,
  toRequestNote,
  type RequestDetail,
  type RequestDetailRow,
  type RequestListItem,
  type RequestListRow,
  type RequestNote,
} from './request.mapper.js';
import type { ListRequestsQuery, RequestFilters, UpdateRequestInput } from './request.schemas.js';
import { requestSearchText } from './request-search.js';
import { REQUEST_DUE_DELAY_MS, adminRequestPath } from './requests.service.js';

/** Compteurs des onglets (schéma `RequestStatusCounts`), calculés avec les autres filtres. */
export type RequestStatusCounts = Record<'ALL' | RequestStatus, number>;

export interface RequestsPage extends Page<RequestListItem> {
  counts: RequestStatusCounts;
}

/** Utilisateur à l'origine d'une modification. */
export interface RequestActor {
  auth: AuthContext;
  ip: string | null;
}

export interface CsvExport {
  fileName: string;
  body: string;
}

/** Délai par défaut de l'invitation au questionnaire (paramètre `emails.surveyDelayHours`). */
export const DEFAULT_SURVEY_DELAY_HOURS = 24;
/** Validité du lien du questionnaire (docs/05 : jeton unique valable 30 jours). */
const SURVEY_VALIDITY_MS = 30 * DAY_MS;

/** Fiche commune des demandes anonymisées une à une : la demande n'est plus rattachée à la personne. */
export const ANONYMOUS_CONTACT_EMAIL = 'anonyme@mamboproxi.invalid';
/** Nom de fichier des pièces jointes d'une demande anonymisée (le fichier est supprimé du stockage). */
export { ANONYMIZED_FILE_NAME };

export const REQUEST_NOT_FOUND = 'Cette demande n’existe pas ou a été anonymisée.';
const requestNotFound = (): ProblemException => notFoundException(REQUEST_NOT_FOUND);
export const ATTACHMENT_NOT_FOUND = 'Cette pièce jointe n’existe pas ou n’est plus disponible.';

/** 422 de l'assignation : personne inconnue, désactivée ou qui ne traite pas de demandes. */
function notAssignable(): ProblemException {
  return new ProblemException({
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    type: 'validation-error',
    title: 'Certaines informations sont à corriger',
    detail: 'Cette personne ne peut pas recevoir de demandes.',
    errors: [
      {
        path: 'assignedToId',
        code: 'not_assignable',
        message: 'Choisissez un membre actif qui traite les demandes.',
      },
    ],
  });
}

const has = (auth: AuthContext, permission: Permission): boolean => auth.permissions.includes(permission);

/** Statut, échéance et notes : toute demande (`requests:write`) ou les siennes (`requests:write-assigned`). */
function canWrite(auth: AuthContext, request: { assignedToId: string | null }): boolean {
  return (
    has(auth, 'requests:write') ||
    (has(auth, 'requests:write-assigned') && request.assignedToId === auth.user.id)
  );
}

const auditActor = (actor: RequestActor): AuditActor => ({ userId: actor.auth.user.id, ip: actor.ip });

/** Libellé court d'une demande pour les e-mails et notifications de l'équipe (service, sujet ou type). */
function requestTitle(request: {
  type: keyof typeof REQUEST_TYPE_LABELS;
  subject: string | null;
  service: { name: string } | null;
}): string {
  return request.service?.name ?? request.subject ?? REQUEST_TYPE_LABELS[request.type];
}

/**
 * Demandes du back-office (tag « Admin — Demandes ») : liste filtrée et paginée avec compteurs, export CSV, détail,
 * statut, assignation, échéance, notes internes, duplication et anonymisation. Avec la seule permission
 * `requests:read-assigned` (chargé·e de clientèle), tout se limite aux demandes assignées à l'utilisateur ; une
 * demande hors de son périmètre est « introuvable » (404), comme une demande anonymisée.
 */
@Injectable()
export class AdminRequestsService {
  private readonly logger = new Logger(AdminRequestsService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MailQueueService) private readonly mailQueue: MailQueueService,
    @Inject(AppConfigService) private readonly config: AppConfigService,
    @Inject(SurveyInvitationsService) private readonly surveys: SurveyInvitationsService,
    @Inject(StorageService) private readonly storage: StorageService,
  ) {}

  /** `assignee` autre que soi-même avec la seule permission `requests:read-assigned` : 403. */
  private checkAssigneeFilter(filters: RequestFilters, auth: AuthContext): void {
    const viewer = requestViewer(auth);
    if (
      viewer.assignedOnly &&
      filters.assignee !== undefined &&
      filters.assignee !== 'me' &&
      filters.assignee !== viewer.userId
    )
      throw forbiddenException('Vous ne voyez que les demandes qui vous sont assignées.');
  }

  /** `GET /v1/admin/requests` : page triée (`-createdAt` par défaut) et compteurs par statut. */
  async list(query: ListRequestsQuery, auth: AuthContext, now: Date): Promise<RequestsPage> {
    this.checkAssigneeFilter(query, auth);
    const { status, page, pageSize, sort, ...filters } = query;
    const base = requestFiltersWhere(filters, requestViewer(auth), now);
    const where: Prisma.RequestWhereInput = status ? { AND: [base, { status }] } : base;
    const [rows, total, ...counts] = await Promise.all([
      this.prisma.request.findMany({
        where,
        select: REQUEST_LIST_SELECT,
        orderBy: [{ [sort.field]: sort.direction }, { id: sort.direction }],
        ...pageWindow(page, pageSize),
      }) as Promise<RequestListRow[]>,
      this.prisma.request.count({ where }),
      this.prisma.request.count({ where: base }),
      ...REQUEST_STATUS_ORDER.map((value) =>
        this.prisma.request.count({ where: { AND: [base, { status: value }] } }),
      ),
    ]);
    const [all = 0, nouvelle = 0, enCours = 0, realisee = 0, cloturee = 0] = counts;
    return {
      data: rows.map((row) => toRequestListItem(row, now)),
      meta: paginationMeta(page, pageSize, total),
      counts: {
        ALL: all,
        NOUVELLE: nouvelle,
        EN_COURS: enCours,
        PRESTATION_REALISEE: realisee,
        CLOTUREE: cloturee,
      },
    };
  }

  /**
   * `GET /v1/admin/requests/export.csv` : demandes filtrées, des plus récentes aux plus anciennes (colonnes du
   * back-office simulé du site). L'export est inscrit au journal d'activité (nombre de lignes seulement).
   */
  async exportCsv(filters: RequestFilters, actor: RequestActor, now: Date): Promise<CsvExport> {
    const { auth } = actor;
    this.checkAssigneeFilter(filters, auth);
    const { status, ...rest } = filters;
    const base = requestFiltersWhere(rest, requestViewer(auth), now);
    const rows = (await this.prisma.request.findMany({
      where: status ? { AND: [base, { status }] } : base,
      select: REQUEST_LIST_SELECT,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    })) as RequestListRow[];
    const body = toCsv(
      [
        'Référence',
        'Type',
        'Statut',
        'Client',
        'E-mail',
        'Téléphone',
        'Ville',
        'Pays',
        'Service',
        'Assignée à',
        'Échéance',
        'Reçue le',
      ],
      rows.map((row) => [
        row.reference,
        REQUEST_TYPE_LABELS[row.type],
        REQUEST_STATUS_LABELS[row.status],
        row.contact.fullName,
        row.contact.email,
        row.contact.phone,
        row.contact.city,
        row.contact.country,
        row.subject,
        row.assignedTo?.name,
        row.dueAt?.toISOString(),
        row.createdAt.toISOString(),
      ]),
    );
    await recordAudit(this.prisma, auditActor(actor), {
      action: 'request.export',
      entity: 'Request',
      entityId: null,
      label: `A exporté ${String(rows.length)} demande${rows.length > 1 ? 's' : ''} (CSV)`,
      after: { count: rows.length },
    });
    return { fileName: `demandes-${doualaDate(now)}.csv`, body };
  }

  /** `GET /v1/admin/requests/{id}` */
  async detail(id: string, auth: AuthContext, now: Date): Promise<RequestDetail> {
    const row: RequestDetailRow | null = await this.prisma.request.findFirst({
      where: { id, ...visibleRequestsWhere(requestViewer(auth)) },
      select: REQUEST_DETAIL_SELECT,
    });
    if (!row) throw requestNotFound();
    const ids = assigneeIdsOf(row.history);
    const users =
      ids.length === 0
        ? []
        : await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
    return toRequestDetail(row, now, new Map(users.map((user) => [user.id, user.name])));
  }

  private async findVisible(id: string, auth: AuthContext) {
    const row = await this.prisma.request.findFirst({
      where: { id, ...visibleRequestsWhere(requestViewer(auth)) },
      select: {
        id: true,
        reference: true,
        type: true,
        status: true,
        subject: true,
        assignedToId: true,
        dueAt: true,
        completedAt: true,
        closedAt: true,
        service: { select: { name: true } },
        contact: { select: { fullName: true } },
        survey: { select: { id: true, status: true } },
      },
    });
    if (!row) throw requestNotFound();
    return row;
  }

  /**
   * `GET /v1/admin/requests/{id}/attachments/{attachmentId}` : lien signé de 5 minutes vers une pièce jointe d'une
   * demande visible (même périmètre que le détail) ; pièce jointe d'une autre demande ou anonymisée → 404.
   */
  async attachmentUrl(id: string, attachmentId: string, auth: AuthContext, now: Date): Promise<SignedUrl> {
    const request = await this.findVisible(id, auth);
    const attachment = await this.prisma.attachment.findFirst({
      where: { id: attachmentId, requestId: request.id },
      select: { id: true, fileName: true },
    });
    if (!attachment || attachment.fileName === ANONYMIZED_FILE_NAME)
      throw notFoundException(ATTACHMENT_NOT_FOUND);
    return this.storage.signedUrl(attachment, now);
  }

  /** Supprime du stockage les fichiers des demandes anonymisées (après validation de la transaction). */
  async purgeFiles(storageKeys: readonly string[]): Promise<void> {
    await this.storage.deleteQuietly(storageKeys);
  }

  /** Membre actif (mot de passe défini) dont le rôle traite des demandes (`assignable` de la présence). */
  private async findAssignable(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, role: true, isActive: true, activatedAt: true },
    });
    if (!user || !user.isActive || user.activatedAt === null || !isAssignableRole(user.role)) return null;
    return user;
  }

  private async surveyDelayHours(): Promise<number> {
    const setting = await this.prisma.setting.findUnique({
      where: { key: SETTING_KEYS.emails },
      select: { value: true },
    });
    const value = (setting?.value as Record<string, unknown> | null | undefined)?.['surveyDelayHours'];
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 720
      ? value
      : DEFAULT_SURVEY_DELAY_HOURS;
  }

  /**
   * `PATCH /v1/admin/requests/{id}` : statut, assignation, échéance. Tous les contrôles précèdent la moindre
   * écriture (la requête est acceptée ou refusée en entier). Chaque changement de statut ou d'assignation crée un
   * événement d'historique ; le passage d'un devis à « Prestation réalisée » programme l'invitation au questionnaire
   * (`emails.surveyDelayHours`, 24 h par défaut ; l'envoi relève du module des questionnaires) ; un retour en
   * arrière annule l'invitation pas encore envoyée. Une assignation à quelqu'un d'autre que soi-même le prévient
   * (notification `ASSIGNMENT` et e-mail `team-assignment`).
   */
  async update(
    id: string,
    input: UpdateRequestInput,
    actor: RequestActor,
    now: Date,
  ): Promise<RequestDetail> {
    const { auth } = actor;
    const current = await this.findVisible(id, auth);
    if ((input.status !== undefined || input.dueAt !== undefined) && !canWrite(auth, current))
      throw forbiddenException('Vous ne pouvez modifier que les demandes qui vous sont assignées.');
    const order = (status: RequestStatus): number => REQUEST_STATUS_ORDER.indexOf(status);
    if (input.status && order(input.status) < order(current.status) && !has(auth, 'requests:revert-status'))
      throw forbiddenException('Seul un administrateur peut revenir à un statut précédent.');
    if (input.assignedToId !== undefined && !has(auth, 'requests:assign'))
      throw forbiddenException('Seul un responsable peut assigner ou réassigner une demande.');
    const assignee = input.assignedToId ? await this.findAssignable(input.assignedToId) : null;
    if (input.assignedToId && !assignee) throw notAssignable();

    const statusChange = input.status !== undefined && input.status !== current.status ? input.status : null;
    const assignmentChange =
      input.assignedToId !== undefined && (assignee?.id ?? null) !== current.assignedToId;
    const scheduleSurvey =
      statusChange === 'PRESTATION_REALISEE' && current.type === 'DEVIS' && current.survey === null;
    const delayHours = scheduleSurvey ? await this.surveyDelayHours() : 0;
    const notified = assignmentChange && assignee !== null && assignee.id !== auth.user.id ? assignee : null;

    const scheduled = await this.prisma.$transaction(async (tx) => {
      let survey: { id: string; scheduledFor: Date | null } | null = null;
      const data: Prisma.RequestUncheckedUpdateInput = { updatedAt: now };
      if (statusChange) {
        data.status = statusChange;
        const target = order(statusChange);
        if (statusChange === 'PRESTATION_REALISEE') data.completedAt = now;
        else if (target < order('PRESTATION_REALISEE')) data.completedAt = null;
        if (statusChange === 'CLOTUREE') data.closedAt = now;
        else data.closedAt = null;
      }
      if (assignmentChange) {
        data.assignedToId = assignee?.id ?? null;
        data.assignedAt = assignee ? now : null;
      }
      if (input.dueAt !== undefined) data.dueAt = input.dueAt === null ? null : new Date(input.dueAt);
      await tx.request.update({ where: { id }, data, select: { id: true } });

      if (statusChange)
        await tx.requestEvent.create({
          data: {
            requestId: id,
            kind: 'STATUS_CHANGED',
            data: { from: current.status, to: statusChange },
            actorId: auth.user.id,
            createdAt: now,
          },
          select: { id: true },
        });
      if (scheduleSurvey) {
        const scheduledFor = new Date(now.getTime() + delayHours * 60 * 60 * 1000);
        survey = await tx.survey.create({
          data: {
            requestId: id,
            // Jeton remplacé à l'envoi par le module des questionnaires (seul son condensat est conservé).
            tokenHash: createHash('sha256').update(randomBytes(32)).digest('hex'),
            status: 'SCHEDULED',
            scheduledFor,
            expiresAt: new Date(scheduledFor.getTime() + SURVEY_VALIDITY_MS),
            sentAt: null,
            remindedAt: null,
            completedAt: null,
            rating: null,
            npsScore: null,
          },
          select: { id: true, scheduledFor: true },
        });
        await tx.requestEvent.create({
          data: {
            requestId: id,
            kind: 'SURVEY_SCHEDULED',
            data: { delayHours, scheduledFor: scheduledFor.toISOString() },
            actorId: null,
            createdAt: now,
          },
          select: { id: true },
        });
      }
      if (
        statusChange &&
        order(statusChange) < order('PRESTATION_REALISEE') &&
        current.survey?.status === 'SCHEDULED'
      )
        await tx.survey.delete({ where: { id: current.survey.id }, select: { id: true } });
      if (assignmentChange)
        await tx.requestEvent.create({
          data: {
            requestId: id,
            kind: 'ASSIGNED',
            data: assignee
              ? { assignedToId: assignee.id, assignedToName: assignee.name }
              : { assignedToId: null },
            actorId: auth.user.id,
            createdAt: now,
          },
          select: { id: true },
        });
      if (notified)
        await tx.notification.create({
          data: {
            userId: notified.id,
            kind: 'ASSIGNMENT',
            title: `Demande assignée — ${requestTitle(current)} (${current.reference})`,
            link: adminRequestPath(id),
            entityType: 'Request',
            entityId: id,
            readAt: null,
            createdAt: now,
          },
          select: { id: true },
        });
      await recordAudit(tx, auditActor(actor), {
        action: 'request.update',
        entity: 'Request',
        entityId: id,
        label: this.updateLabel(current.reference, statusChange, current.status, assignmentChange, assignee),
        before: {
          status: current.status,
          assignedToId: current.assignedToId,
          dueAt: current.dueAt?.toISOString() ?? null,
        },
        after: {
          status: statusChange ?? current.status,
          assignedToId: assignmentChange ? (assignee?.id ?? null) : current.assignedToId,
          dueAt:
            input.dueAt === undefined
              ? (current.dueAt?.toISOString() ?? null)
              : input.dueAt === null
                ? null
                : new Date(input.dueAt).toISOString(),
        },
      });
      return survey;
    });

    // Invitation au questionnaire : tâche différée de la file `survey-invitations` (après l'enregistrement).
    if (scheduled) await this.surveys.scheduleInvitation(scheduled, now);
    if (notified) await this.sendAssignmentMail(current, notified, auth.user.name, now);
    return this.detail(id, auth, now);
  }

  private updateLabel(
    reference: string,
    statusChange: RequestStatus | null,
    from: RequestStatus,
    assignmentChange: boolean,
    assignee: { name: string } | null,
  ): string {
    if (statusChange)
      return `A passé la demande ${reference} de « ${REQUEST_STATUS_LABELS[from]} » à « ${REQUEST_STATUS_LABELS[statusChange]} »`;
    if (assignmentChange)
      return assignee
        ? `A assigné la demande ${reference} à ${assignee.name}`
        : `A retiré l’assignation de la demande ${reference}`;
    return `A modifié l’échéance de la demande ${reference}`;
  }

  /** E-mail `team-assignment` (désactivable dans les modèles) ; un échec est journalisé sans faire échouer. */
  private async sendAssignmentMail(
    request: Awaited<ReturnType<AdminRequestsService['findVisible']>>,
    assignee: { email: string },
    assignedByName: string,
    now: Date,
  ): Promise<void> {
    try {
      await this.mailQueue.enqueue({
        template: 'team-assignment',
        to: assignee.email,
        lang: 'fr',
        reference: request.reference,
        data: {
          reference: request.reference,
          serviceName: requestTitle(request),
          fullName: request.contact.fullName,
          assignedByName,
          requestId: request.id,
          actionUrl: new URL(adminRequestPath(request.id), this.config.get('WEB_URL')).toString(),
          // Distingue deux assignations successives à la même personne (identifiant de tâche stable).
          assignedAt: now.toISOString(),
        },
      });
    } catch (error) {
      const reason = error instanceof Error ? error.name : 'erreur inconnue';
      this.logger.error(
        `E-mail d’assignation de la demande ${request.reference} non mis en file (${reason}).`,
      );
    }
  }

  /** `POST /v1/admin/requests/{id}/notes` : note interne et événement `NOTE_ADDED`. */
  async addNote(id: string, body: string, auth: AuthContext, now: Date): Promise<RequestNote> {
    const request = await this.findVisible(id, auth);
    if (!canWrite(auth, request))
      throw forbiddenException('Vous ne pouvez annoter que les demandes qui vous sont assignées.');
    return this.prisma.$transaction(async (tx) => {
      const note = await tx.requestNote.create({
        data: { requestId: id, authorId: auth.user.id, body, createdAt: now },
        select: { id: true, body: true, createdAt: true, author: { select: { id: true, name: true } } },
      });
      await tx.requestEvent.create({
        data: {
          requestId: id,
          kind: 'NOTE_ADDED',
          data: Prisma.DbNull,
          actorId: auth.user.id,
          createdAt: now,
        },
        select: { id: true },
      });
      await tx.request.update({ where: { id }, data: { updatedAt: now }, select: { id: true } });
      return toRequestNote(note);
    });
  }

  /**
   * `POST /v1/admin/requests/{id}/duplicate` : copie au statut « Nouvelle », nouvelle référence, échéance à
   * 24 h ; ni notes, ni historique, ni pièces jointes, ni questionnaire. L'assignation est conservée.
   */
  async duplicate(id: string, actor: RequestActor, now: Date): Promise<RequestDetail> {
    const { auth } = actor;
    const source = await this.prisma.request.findFirst({
      where: { id, ...visibleRequestsWhere(requestViewer(auth)) },
      select: {
        reference: true,
        type: true,
        contactId: true,
        categoryId: true,
        serviceId: true,
        jobOfferId: true,
        trainingId: true,
        otherTraining: true,
        eventId: true,
        seats: true,
        participants: true,
        period: true,
        organization: true,
        partnershipType: true,
        contactPreference: true,
        subject: true,
        payload: true,
        message: true,
        language: true,
        consentAt: true,
        assignedToId: true,
        assignedAt: true,
      },
    });
    if (!source) throw requestNotFound();
    const created = await this.prisma.$transaction(async (tx) => {
      const reference = await nextReference(tx, now);
      const copy = await tx.request.create({
        data: {
          type: source.type,
          contactId: source.contactId,
          categoryId: source.categoryId,
          serviceId: source.serviceId,
          jobOfferId: source.jobOfferId,
          trainingId: source.trainingId,
          otherTraining: source.otherTraining,
          eventId: source.eventId,
          seats: source.seats,
          participants: source.participants,
          period: source.period,
          organization: source.organization,
          partnershipType: source.partnershipType,
          contactPreference: source.contactPreference,
          subject: source.subject,
          payload: source.payload ?? {},
          message: source.message,
          language: source.language,
          // Consentement donné pour la demande d'origine (horodatage seul : ni IP ni agent utilisateur recopiés).
          consentAt: source.consentAt,
          assignedToId: source.assignedToId,
          assignedAt: source.assignedAt,
          reference,
          searchText: requestSearchText(reference, source.subject),
          status: 'NOUVELLE',
          dueAt: new Date(now.getTime() + REQUEST_DUE_DELAY_MS),
          duplicatedFromId: id,
          ip: null,
          userAgent: null,
          completedAt: null,
          closedAt: null,
          anonymizedAt: null,
          createdAt: now,
          updatedAt: now,
        },
        select: { id: true, reference: true },
      });
      await tx.requestEvent.create({
        data: {
          requestId: copy.id,
          kind: 'DUPLICATED',
          data: { fromId: id, fromReference: source.reference },
          actorId: auth.user.id,
          createdAt: now,
        },
        select: { id: true },
      });
      await recordAudit(tx, auditActor(actor), {
        action: 'request.duplicate',
        entity: 'Request',
        entityId: copy.id,
        label: `A dupliqué la demande ${source.reference} en ${copy.reference}`,
        after: { fromId: id, reference: copy.reference },
      });
      return copy;
    });
    return this.detail(created.id, auth, now);
  }

  /**
   * `DELETE /v1/admin/requests/{id}` : anonymisation RGPD (la demande reste comptée dans les statistiques mais
   * disparaît du back-office : 404 ensuite).
   */
  async anonymize(id: string, actor: RequestActor, now: Date): Promise<void> {
    const request = await this.findVisible(id, actor.auth);
    const storageKeys = await this.prisma.$transaction(async (tx) => {
      const anonymousId = await this.anonymousContactId(tx, now);
      const keys = await this.anonymizeInTx(tx, [id], actor.auth.user.id, now, anonymousId);
      await recordAudit(tx, auditActor(actor), {
        action: 'request.anonymize',
        entity: 'Request',
        entityId: id,
        label: `A anonymisé la demande ${request.reference}`,
      });
      return keys;
    });
    await this.purgeFiles(storageKeys);
  }

  /** Fiche commune « Contact anonymisé » (créée à la première anonymisation, jamais affichée). */
  private async anonymousContactId(tx: Prisma.TransactionClient, now: Date): Promise<string> {
    const contact = await tx.contact.upsert({
      where: { email: ANONYMOUS_CONTACT_EMAIL },
      create: {
        email: ANONYMOUS_CONTACT_EMAIL,
        fullName: 'Contact anonymisé',
        firstName: null,
        lastName: null,
        phone: null,
        country: null,
        city: null,
        district: null,
        organization: null,
        activity: null,
        preferredChannel: null,
        source: null,
        searchText: '',
        cityKey: null,
        anonymizedAt: now,
        lastActivityAt: now,
      },
      update: {},
      select: { id: true },
    });
    return contact.id;
  }

  /**
   * Anonymise des demandes (une demande, ou toutes celles d'un contact effacé) : message, valeurs du formulaire,
   * structure, preuve technique du consentement (IP, agent utilisateur), sujet libre des messages de contact,
   * notes internes, noms des pièces jointes (`fichier-anonymise`), réponses libres du
   * questionnaire ; message et notes du rendez-vous lié. L'horodatage du consentement, le type, le service, le
   * statut et les dates restent pour les statistiques. `relinkContactId` : fiche à laquelle rattacher la demande
   * (fiche commune anonyme) ; absent, la demande reste sur sa fiche (effacée par l'appelant). Renvoie les clés de
   * stockage des fichiers à supprimer, par `purgeFiles`, une fois la transaction validée (un fichier supprimé ne
   * se restaure pas si la transaction est annulée).
   */
  async anonymizeInTx(
    tx: Prisma.TransactionClient,
    ids: readonly string[],
    actorId: string,
    now: Date,
    relinkContactId?: string,
  ): Promise<string[]> {
    if (ids.length === 0) return [];
    const rows = await tx.request.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, reference: true, type: true, subject: true, service: { select: { name: true } } },
    });
    for (const row of rows) {
      const subject =
        row.type === 'CONTACT' || row.type === 'INFORMATION' ? (row.service?.name ?? null) : row.subject;
      await tx.request.update({
        where: { id: row.id },
        data: {
          payload: {},
          message: null,
          organization: null,
          otherTraining: null,
          period: null,
          ip: null,
          userAgent: null,
          subject,
          searchText: requestSearchText(row.reference, subject),
          anonymizedAt: now,
          ...(relinkContactId ? { contactId: relinkContactId } : {}),
        },
        select: { id: true },
      });
    }
    const requestIds = { in: rows.map((row) => row.id) };
    const files = await tx.attachment.findMany({
      where: { requestId: requestIds, fileName: { not: ANONYMIZED_FILE_NAME } },
      select: { storageKey: true },
    });
    await tx.requestNote.deleteMany({ where: { requestId: requestIds } });
    await tx.attachment.updateMany({
      where: { requestId: requestIds },
      data: { fileName: ANONYMIZED_FILE_NAME },
    });
    await tx.jobApplication.updateMany({ where: { requestId: requestIds }, data: { notes: null } });
    await anonymizeReviewsOfRequests(tx, ids);
    await tx.survey.updateMany({
      where: { requestId: requestIds },
      data: { answers: Prisma.DbNull, displayName: null, city: null },
    });
    await tx.appointment.updateMany({
      where: { requestId: requestIds },
      data: { message: null, notes: null, ...(relinkContactId ? { contactId: relinkContactId } : {}) },
    });
    await tx.requestEvent.createMany({
      data: rows.map((row) => ({ requestId: row.id, kind: 'ANONYMIZED' as const, actorId, createdAt: now })),
    });
    return files.map((file) => file.storageKey);
  }
}
