import { Inject, Injectable } from '@nestjs/common';
import { recordAudit, type AuditActor } from '../../common/audit/audit-log.js';
import { toCsv } from '../../common/csv/csv.js';
import { paginationMeta, pageWindow, type Page } from '../../common/pagination/pagination.js';
import { notFoundException } from '../../common/problem/problem.js';
import { doualaDate } from '../../common/time/agency-day.js';
import type { Prisma, SubscriberSource } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { SUBSCRIBER_STATUS_LABELS, toSubscriber, type Subscriber } from '../contacts/admin-contact.mapper.js';
import type { ListSubscribersQuery } from './newsletter.schemas.js';

export const SUBSCRIBER_NOT_FOUND = 'Cet inscrit n’existe pas ou a déjà été supprimé.';

const SUBSCRIBER_SELECT = {
  id: true,
  email: true,
  name: true,
  phone: true,
  country: true,
  status: true,
  tags: true,
  source: true,
  confirmedAt: true,
  unsubscribedAt: true,
  createdAt: true,
} as const satisfies Prisma.SubscriberSelect;

const SOURCE_LABELS: Record<SubscriberSource, string> = {
  FOOTER: 'Pied de page',
  SUIVI_MAMBO: 'Suivi Mambo',
  INSCRIPTION: 'Inscription',
  AUTRE: 'Autre',
};

export interface CsvFile {
  fileName: string;
  body: string;
}

/**
 * Inscrits à la newsletter du back-office (tag « Admin — Newsletter ») : liste paginée (statut, recherche sur
 * l'adresse et le nom sans tenir compte de la casse), export CSV des inscrits confirmés, suppression (droit à
 * l'effacement : l'abonnement et ses envois individuels sont supprimés ; les compteurs des campagnes restent). Le
 * journal d'activité ne garde ni adresse ni nom.
 */
@Injectable()
export class AdminSubscribersService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** `GET /v1/admin/subscribers` : le plus récent en premier. */
  async list(query: ListSubscribersQuery): Promise<Page<Subscriber>> {
    const where: Prisma.SubscriberWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.q
        ? {
            OR: [
              { email: { contains: query.q, mode: 'insensitive' } },
              { name: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.subscriber.count({ where }),
      this.prisma.subscriber.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...pageWindow(query.page, query.pageSize),
        select: SUBSCRIBER_SELECT,
      }),
    ]);
    return { data: rows.map(toSubscriber), meta: paginationMeta(query.page, query.pageSize, total) };
  }

  /** `GET /v1/admin/subscribers/export.csv` : inscrits confirmés, du plus ancien au plus récent. */
  async exportCsv(actor: AuditActor, now: Date): Promise<CsvFile> {
    const rows = await this.prisma.subscriber.findMany({
      where: { status: 'CONFIRME' },
      orderBy: [{ confirmedAt: 'asc' }, { id: 'asc' }],
      select: { ...SUBSCRIBER_SELECT, language: true },
    });
    const body = toCsv(
      [
        'E-mail',
        'Nom',
        'Téléphone',
        'Pays',
        'Langue',
        'Statut',
        'Origine',
        'Étiquettes',
        'Confirmé le',
        'Inscrit le',
      ],
      rows.map((row) => [
        row.email,
        row.name,
        row.phone,
        row.country,
        row.language === 'EN' ? 'Anglais' : 'Français',
        SUBSCRIBER_STATUS_LABELS[row.status],
        SOURCE_LABELS[row.source],
        row.tags.join(', '),
        row.confirmedAt ? doualaDate(row.confirmedAt) : '',
        doualaDate(row.createdAt),
      ]),
    );
    await recordAudit(this.prisma, actor, {
      action: 'subscriber.export',
      entity: 'Subscriber',
      entityId: null,
      label: `A exporté les inscrits confirmés à la newsletter (${String(rows.length)})`,
      after: { count: rows.length },
    });
    return { fileName: `inscrits-newsletter-${doualaDate(now)}.csv`, body };
  }

  /** `DELETE /v1/admin/subscribers/{id}` */
  async remove(id: string, actor: AuditActor): Promise<void> {
    const current = await this.prisma.subscriber.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
    if (!current) throw notFoundException(SUBSCRIBER_NOT_FOUND);
    await this.prisma.$transaction(async (tx) => {
      await tx.subscriber.delete({ where: { id }, select: { id: true } });
      await recordAudit(tx, actor, {
        action: 'subscriber.delete',
        entity: 'Subscriber',
        entityId: id,
        label: 'A supprimé un inscrit de la newsletter',
        before: { status: current.status },
      });
    });
  }
}
