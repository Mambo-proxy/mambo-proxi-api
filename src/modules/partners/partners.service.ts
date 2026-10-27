import { Inject, Injectable } from '@nestjs/common';
import { recordAudit, type AuditActor } from '../../common/audit/audit-log.js';
import { notFoundException } from '../../common/problem/problem.js';
import { CACHE_TAGS, requestRevalidation } from '../../common/revalidation/revalidation.js';
import { validationException } from '../../common/validation/validation-exception.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { ReorderInput } from '../catalog/admin-catalog.schemas.js';
import { unknownMediaErrors } from '../media/media-refs.js';
import { MediaService } from '../media/media.service.js';
import {
  PARTNER_CATEGORY_LABELS,
  PARTNER_ORDER,
  PARTNER_SELECT,
  toAdminPartner,
  toPartner,
  type AdminPartner,
  type Partner,
} from './partner.mapper.js';
import type {
  ListAdminPartnersQuery,
  ListPartnersQuery,
  PartnerInput,
  PartnerPatch,
} from './partner.schemas.js';

export const PARTNER_NOT_FOUND = 'Ce partenaire n’existe pas ou a été supprimé.';

/** Étiquettes de cache du site touchées par un partenaire visible (liste et page « Partenaires »). */
const PARTNER_TAGS = [CACHE_TAGS.partners, CACHE_TAGS.page('partenaires')];

/**
 * Partenaires : logos visibles du site (`GET /v1/partners`, triés par catégorie puis par ordre enregistré) et
 * gestion du back-office (`/v1/admin/partners*` : ajout, modification dont visibilité, ordre, suppression). Toute
 * modification d'un logo visible (avant ou après) demande la revalidation des étiquettes `partners` et
 * `page:partenaires`.
 */
@Injectable()
export class PartnersService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MediaService) private readonly media: MediaService,
  ) {}

  /** `GET /v1/partners` */
  async listPublic(query: ListPartnersQuery): Promise<Partner[]> {
    const rows = await this.prisma.partner.findMany({
      where: { visible: true, ...(query.category ? { category: query.category } : {}) },
      orderBy: [...PARTNER_ORDER],
      select: PARTNER_SELECT,
    });
    return rows.map((row) => toPartner(row, this.media, query.lang));
  }

  /** `GET /v1/admin/partners` */
  async list(query: ListAdminPartnersQuery): Promise<AdminPartner[]> {
    const rows = await this.prisma.partner.findMany({
      where: query.category ? { category: query.category } : {},
      orderBy: [...PARTNER_ORDER],
      select: PARTNER_SELECT,
    });
    return rows.map((row) => toAdminPartner(row, this.media));
  }

  /** `POST /v1/admin/partners` : placé en fin de sa catégorie, visible par défaut. */
  async create(input: PartnerInput, actor: AuditActor): Promise<AdminPartner> {
    const errors = await unknownMediaErrors(this.media, [{ path: 'logoImageId', id: input.logoImageId }]);
    if (errors.length > 0) throw validationException(errors);
    const visible = input.visible ?? true;
    const row = await this.prisma.$transaction(async (tx) => {
      const last = await tx.partner.aggregate({
        where: { category: input.category },
        _max: { sortOrder: true },
      });
      const created = await tx.partner.create({
        data: {
          name: input.name,
          category: input.category,
          logoImageId: input.logoImageId ?? null,
          url: input.url ?? null,
          visible,
          sortOrder: (last._max.sortOrder ?? 0) + 1,
        },
        select: PARTNER_SELECT,
      });
      if (visible) await requestRevalidation(tx, PARTNER_TAGS);
      await recordAudit(tx, actor, {
        action: 'partner.create',
        entity: 'Partner',
        entityId: created.id,
        label: `A ajouté le partenaire « ${created.name} » (${PARTNER_CATEGORY_LABELS.fr[created.category]})`,
        after: { category: created.category, visible },
      });
      return created;
    });
    return toAdminPartner(row, this.media);
  }

  /** `PATCH /v1/admin/partners/{id}` : champs fournis seulement (dont `visible`). */
  async update(id: string, patch: PartnerPatch, actor: AuditActor): Promise<AdminPartner> {
    const current = await this.prisma.partner.findUnique({ where: { id }, select: PARTNER_SELECT });
    if (!current) throw notFoundException(PARTNER_NOT_FOUND);
    const errors = await unknownMediaErrors(this.media, [{ path: 'logoImageId', id: patch.logoImageId }]);
    if (errors.length > 0) throw validationException(errors);

    const data: Prisma.PartnerUpdateInput = {};
    if (patch.name !== undefined) data.name = patch.name;
    if (patch.url !== undefined) data.url = patch.url;
    if (patch.visible !== undefined) data.visible = patch.visible;
    if (patch.logoImageId !== undefined)
      data.logoImage =
        patch.logoImageId === null ? { disconnect: true } : { connect: { id: patch.logoImageId } };
    const row = await this.prisma.$transaction(async (tx) => {
      if (patch.category !== undefined && patch.category !== current.category) {
        const last = await tx.partner.aggregate({
          where: { category: patch.category },
          _max: { sortOrder: true },
        });
        data.category = patch.category;
        data.sortOrder = (last._max.sortOrder ?? 0) + 1;
      }
      const updated = await tx.partner.update({ where: { id }, data, select: PARTNER_SELECT });
      if (current.visible || updated.visible) await requestRevalidation(tx, PARTNER_TAGS);
      await recordAudit(tx, actor, {
        action: 'partner.update',
        entity: 'Partner',
        entityId: id,
        label:
          current.visible !== updated.visible
            ? `A ${updated.visible ? 'affiché' : 'masqué'} le partenaire « ${updated.name} »`
            : `A modifié le partenaire « ${updated.name} »`,
        before: { category: current.category, visible: current.visible },
        after: { category: updated.category, visible: updated.visible, fields: Object.keys(patch) },
      });
      return updated;
    });
    return toAdminPartner(row, this.media);
  }

  /** `PATCH /v1/admin/partners/reorder` : rang = position dans `ids` (une catégorie ou toute la liste). */
  async reorder(input: ReorderInput, actor: AuditActor): Promise<void> {
    const rows = await this.prisma.partner.findMany({
      where: { id: { in: input.ids } },
      select: { id: true, category: true, visible: true },
    });
    const scope = input.scope ?? undefined;
    if (
      rows.length !== input.ids.length ||
      (scope !== undefined && rows.some((row) => row.category !== scope))
    )
      throw validationException([
        { path: 'ids', code: 'invalid_order', message: 'Partenaires inconnus ou d’une autre catégorie.' },
      ]);
    await this.prisma.$transaction(async (tx) => {
      for (const [index, id] of input.ids.entries())
        await tx.partner.update({ where: { id }, data: { sortOrder: index + 1 }, select: { id: true } });
      if (rows.some((row) => row.visible)) await requestRevalidation(tx, PARTNER_TAGS);
      await recordAudit(tx, actor, {
        action: 'partner.reorder',
        entity: 'Partner',
        entityId: null,
        label: 'A réordonné les partenaires',
        after: { scope: scope ?? null, ids: input.ids },
      });
    });
  }

  /** `DELETE /v1/admin/partners/{id}` */
  async remove(id: string, actor: AuditActor): Promise<void> {
    const current = await this.prisma.partner.findUnique({
      where: { id },
      select: { id: true, name: true, category: true, visible: true },
    });
    if (!current) throw notFoundException(PARTNER_NOT_FOUND);
    await this.prisma.$transaction(async (tx) => {
      await tx.partner.delete({ where: { id }, select: { id: true } });
      if (current.visible) await requestRevalidation(tx, PARTNER_TAGS);
      await recordAudit(tx, actor, {
        action: 'partner.delete',
        entity: 'Partner',
        entityId: id,
        label: `A supprimé le partenaire « ${current.name} »`,
        before: { category: current.category, visible: current.visible },
      });
    });
  }
}
