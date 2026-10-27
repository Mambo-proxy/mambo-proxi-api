import { Injectable } from '@nestjs/common';
import type {
  ContactPreference,
  Language,
  NotificationKind,
  PartnershipType,
  Prisma,
  RequestType,
  Role,
} from '../../generated/prisma/client.js';
import { ROLES, hasAnyPermission } from '../auth/permissions.js';
import { nextReference } from './reference.js';
import { requestSearchText } from './request-search.js';

/** Échéance de traitement d'une nouvelle demande : réception + 24 h (comme les données simulées du site). */
export const REQUEST_DUE_DELAY_MS = 24 * 60 * 60 * 1000;

/** Rôles qui voient toutes les demandes (`requests:read`) et reçoivent les notifications « nouvelle demande ». */
export const TEAM_NOTIFIED_ROLES: readonly Role[] = ROLES.filter((role) =>
  hasAnyPermission(role, ['requests:read']),
);

/** Champ affiché dans le panneau de détail du back-office (schéma `RequestField` du contrat). */
export interface RequestField {
  key: string;
  label: string;
  value: string;
}

/** Demande reçue par un formulaire public, avant attribution de la référence. */
export interface ReceivedRequestDraft {
  type: RequestType;
  contactId: string;
  categoryId?: string | null;
  serviceId?: string | null;
  trainingId?: string | null;
  otherTraining?: string | null;
  eventId?: string | null;
  seats?: number | null;
  participants?: number | null;
  period?: string | null;
  organization?: string | null;
  partnershipType?: PartnershipType | null;
  contactPreference?: ContactPreference | null;
  subject: string;
  /** Valeurs propres au formulaire et `fields` (libellé + valeur formatée) pour le back-office. */
  payload: Prisma.InputJsonObject;
  message?: string | null;
  language: Language;
  /** Preuve du consentement : horodatage, adresse IP et agent utilisateur (effacés à l'anonymisation). */
  consentAt: Date;
  ip?: string | null;
  userAgent?: string | null;
}

export interface TeamNotification {
  kind: NotificationKind;
  /** Titre affiché ; la référence est ajoutée entre parenthèses. */
  title: string;
}

export interface CreatedRequest {
  id: string;
  reference: string;
  createdAt: Date;
  dueAt: Date;
}

/** Lien du back-office vers le détail d'une demande (comme les notifications du seed). */
export function adminRequestPath(requestId: string): string {
  return `/admin/demandes?id=${encodeURIComponent(requestId)}`;
}

/** Création des demandes : référence, statut `NOUVELLE`, échéance, historique « reçue », notifications de l'équipe. */
@Injectable()
export class RequestsService {
  /**
   * À appeler dans la transaction de création (avec la fiche contact) : la référence n'est consommée que si tout
   * est enregistré.
   */
  async createReceived(
    tx: Prisma.TransactionClient,
    draft: ReceivedRequestDraft,
    notification: TeamNotification,
    now: Date,
  ): Promise<CreatedRequest> {
    const reference = await nextReference(tx, now);
    const dueAt = new Date(now.getTime() + REQUEST_DUE_DELAY_MS);
    const request = await tx.request.create({
      data: {
        ...draft,
        reference,
        searchText: requestSearchText(reference, draft.subject),
        status: 'NOUVELLE',
        dueAt,
        createdAt: now,
      },
      select: { id: true, reference: true, createdAt: true },
    });
    await tx.requestEvent.create({
      data: { requestId: request.id, kind: 'RECEIVED', createdAt: now },
    });
    await this.notifyTeam(tx, request.id, reference, notification, now);
    return { id: request.id, reference: request.reference, createdAt: request.createdAt, dueAt };
  }

  /** Une notification par membre actif de l'équipe qui voit toutes les demandes. */
  private async notifyTeam(
    tx: Prisma.TransactionClient,
    requestId: string,
    reference: string,
    notification: TeamNotification,
    now: Date,
  ): Promise<void> {
    const users = await tx.user.findMany({
      where: { isActive: true, role: { in: [...TEAM_NOTIFIED_ROLES] } },
      select: { id: true },
    });
    if (users.length === 0) return;
    await tx.notification.createMany({
      data: users.map((user) => ({
        userId: user.id,
        kind: notification.kind,
        title: `${notification.title} (${reference})`,
        link: adminRequestPath(requestId),
        entityType: 'Request',
        entityId: requestId,
        createdAt: now,
      })),
    });
  }
}
