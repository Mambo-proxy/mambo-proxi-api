import { Inject, Injectable } from '@nestjs/common';
import { recordAudit, type AuditActor } from '../../common/audit/audit-log.js';
import { paginationMeta, pageWindow, type Page } from '../../common/pagination/pagination.js';
import { notFoundException } from '../../common/problem/problem.js';
import type { ApplicationStatus, Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { StorageService, type SignedUrl } from '../storage/storage.service.js';
import { ANONYMIZED_FILE_NAME } from '../storage/storage.types.js';
import {
  ADMIN_APPLICATION_SELECT,
  APPLICATION_STATUS_LABELS,
  toAdminApplication,
  type AdminApplication,
  type AdminApplicationRow,
} from './job.mapper.js';
import { SPONTANEOUS_JOB, type ListApplicationsQuery } from './job.schemas.js';

export const APPLICATION_NOT_FOUND = 'Cette candidature n’existe pas ou a été supprimée.';
const applicationNotFound = () => notFoundException(APPLICATION_NOT_FOUND);

/** Candidatures affichées : demande non anonymisée. */
const VISIBLE: Prisma.JobApplicationWhereInput = { request: { anonymizedAt: null } };

/**
 * Candidatures du back-office (tag « Admin — Recrutement ») : liste paginée (statut, offre ou `spontaneous`), détail
 * (une candidature « Nouveau » passe à « Lu » à la première ouverture), statut, lien signé du CV (5 minutes). Le
 * journal d'activité ne retient que la référence et les statuts (jamais le nom du candidat).
 */
@Injectable()
export class AdminApplicationsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(StorageService) private readonly storage: StorageService,
  ) {}

  /** `GET /v1/admin/applications` : des plus récentes aux plus anciennes. */
  async list(query: ListApplicationsQuery): Promise<Page<AdminApplication>> {
    const where: Prisma.JobApplicationWhereInput = {
      ...VISIBLE,
      ...(query.status ? { status: query.status } : {}),
      ...(query.job === undefined ? {} : { jobOfferId: query.job === SPONTANEOUS_JOB ? null : query.job }),
    };
    const [rows, total] = await Promise.all([
      this.prisma.jobApplication.findMany({
        where,
        select: ADMIN_APPLICATION_SELECT,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...pageWindow(query.page, query.pageSize),
      }) as Promise<AdminApplicationRow[]>,
      this.prisma.jobApplication.count({ where }),
    ]);
    return { data: rows.map(toAdminApplication), meta: paginationMeta(query.page, query.pageSize, total) };
  }

  private async find(id: string): Promise<AdminApplicationRow> {
    const row: AdminApplicationRow | null = await this.prisma.jobApplication.findFirst({
      where: { id, ...VISIBLE },
      select: ADMIN_APPLICATION_SELECT,
    });
    if (!row) throw applicationNotFound();
    return row;
  }

  /** `GET /v1/admin/applications/{id}` : première ouverture d'une candidature « Nouveau » → « Lu ». */
  async detail(id: string, now: Date): Promise<AdminApplication> {
    const row = await this.find(id);
    if (row.status !== 'NOUVEAU') return toAdminApplication(row);
    // Mise à jour conditionnelle : deux ouvertures simultanées ne changent le statut qu'une fois.
    await this.prisma.jobApplication.updateMany({
      where: { id, status: 'NOUVEAU' },
      data: { status: 'LU', readAt: now, updatedAt: now },
    });
    return toAdminApplication({ ...row, status: 'LU' });
  }

  /** `PATCH /v1/admin/applications/{id}` */
  async update(
    id: string,
    status: ApplicationStatus,
    actor: AuditActor,
    now: Date,
  ): Promise<AdminApplication> {
    const row = await this.find(id);
    if (row.status === status) return toAdminApplication(row);
    await this.prisma.$transaction(async (tx) => {
      await tx.jobApplication.update({
        where: { id },
        data: { status, updatedAt: now, ...(row.status === 'NOUVEAU' ? { readAt: now } : {}) },
        select: { id: true },
      });
      await recordAudit(tx, actor, {
        action: 'application.update',
        entity: 'JobApplication',
        entityId: id,
        label: `A passé la candidature ${row.request.reference} de « ${APPLICATION_STATUS_LABELS[row.status]} » à « ${APPLICATION_STATUS_LABELS[status]} »`,
        before: { status: row.status },
        after: { status },
      });
    });
    return toAdminApplication({ ...row, status });
  }

  /** `GET /v1/admin/applications/{id}/cv` : lien signé de 5 minutes ; téléchargement inscrit au journal. */
  async cv(id: string, actor: AuditActor, now: Date): Promise<SignedUrl> {
    const row = await this.find(id);
    if (row.cvAttachment.fileName === ANONYMIZED_FILE_NAME) throw applicationNotFound();
    await recordAudit(this.prisma, actor, {
      action: 'application.cv-download',
      entity: 'JobApplication',
      entityId: id,
      label: `A téléchargé le CV de la candidature ${row.request.reference}`,
    });
    return this.storage.signedUrl(row.cvAttachment, now);
  }
}
