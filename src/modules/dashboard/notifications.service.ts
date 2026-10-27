import { Inject, Injectable } from '@nestjs/common';
import type { NotificationKind } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';

/** Schéma `Notification` du contrat. */
export interface AdminNotification {
  id: string;
  kind: NotificationKind;
  title: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationsList {
  data: AdminNotification[];
  unreadCount: number;
}

/** Nombre de notifications renvoyées (contrat : « 30 dernières notifications »). */
export const RECENT_NOTIFICATIONS = 30;

/**
 * Notifications du back-office (panneau de la cloche) : une ligne par destinataire, créée par les modules des
 * demandes, rendez-vous, avis et candidatures. Chacun ne voit et ne marque que les siennes.
 */
@Injectable()
export class NotificationsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(userId: string): Promise<NotificationsList> {
    const [rows, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where: { userId },
        select: { id: true, kind: true, title: true, link: true, readAt: true, createdAt: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: RECENT_NOTIFICATIONS,
      }),
      this.prisma.notification.count({ where: { userId, readAt: null } }),
    ]);
    return {
      data: rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        title: row.title,
        link: row.link,
        readAt: row.readAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
      })),
      unreadCount,
    };
  }

  /** Marque comme lues les notifications désignées (toutes sans `ids`) ; celles d'un autre utilisateur sont ignorées. */
  async markRead(userId: string, ids: readonly string[] | undefined, now: Date): Promise<void> {
    if (ids !== undefined && ids.length === 0) return;
    await this.prisma.notification.updateMany({
      where: { userId, readAt: null, ...(ids === undefined ? {} : { id: { in: [...ids] } }) },
      data: { readAt: now },
    });
  }
}
