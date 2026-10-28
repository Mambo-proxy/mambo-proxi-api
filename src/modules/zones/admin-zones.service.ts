import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { recordAudit, type AuditActor } from '../../common/audit/audit-log.js';
import { asObject } from '../../common/json/json-read.js';
import { notFoundException, ProblemException } from '../../common/problem/problem.js';
import { CACHE_TAGS, requestRevalidation } from '../../common/revalidation/revalidation.js';
import { searchKey } from '../../common/text/search-key.js';
import { slugify, uniqueSlug } from '../../common/text/slug.js';
import { Prisma, type ZoneTone } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { ReorderInput } from '../catalog/admin-catalog.schemas.js';
import { SETTING_KEYS } from '../settings/settings.constants.js';
import type { TextTranslationStatus } from '../../common/i18n/text-translation.js';
import { validationException } from '../../common/validation/validation-exception.js';
import type { QuarterInput, ZoneInput, ZonePatch } from './admin-zones.schemas.js';
import {
  nextZoneHashes,
  reviewedZoneFieldErrors,
  zoneTranslationStatus,
  type QuarterTexts,
} from './zone-translations.js';
import { toZoneArea, type ZoneArea, type ZoneQuarter } from './zones.mapper.js';

export const ADMIN_ZONE_NOT_FOUND = 'Cette zone n’existe plus.';
const DAY_MS = 86_400_000;

const adminZoneSelect = {
  id: true,
  key: true,
  name: true,
  nameEn: true,
  tone: true,
  description: true,
  descriptionEn: true,
  result: true,
  resultEn: true,
  translationHashes: true,
  delay: true,
  feeAmount: true,
  feeCurrency: true,
  feeFrom: true,
  area: true,
  active: true,
  sortOrder: true,
  updatedAt: true,
  quarters: {
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select: {
      id: true,
      name: true,
      normalizedName: true,
      detail: true,
      detailEn: true,
      mapLabel: true,
      mapLabelEn: true,
      isBase: true,
      labelOnSmallMap: true,
      lat: true,
      lng: true,
      mapX: true,
      mapY: true,
    },
  },
} satisfies Prisma.ZoneSelect;

type AdminZoneRecord = Prisma.ZoneGetPayload<{ select: typeof adminZoneSelect }>;

/** Schéma `AdminZone` du contrat. */
export interface AdminZone {
  id: string;
  key: string;
  name: string;
  nameEn: string | null;
  tone: ZoneTone;
  description: string;
  descriptionEn: string | null;
  result: string;
  resultEn: string | null;
  delay: string | null;
  fee: { amount: number; currency: 'XAF'; from: boolean } | null;
  active: boolean;
  quarters: ZoneQuarter[];
  area: ZoneArea | null;
  requestsCount: number;
  sortOrder: number;
  updatedAt: string;
  translationStatus: { en: TextTranslationStatus };
}

/** Schéma `AdminZones` du contrat. */
export interface AdminZones {
  zones: AdminZone[];
  showFees: boolean;
}

function toAdminZone(zone: AdminZoneRecord, requestsCount: number): AdminZone {
  return {
    id: zone.id,
    key: zone.key,
    name: zone.name,
    nameEn: zone.nameEn,
    tone: zone.tone,
    description: zone.description,
    descriptionEn: zone.descriptionEn,
    result: zone.result,
    resultEn: zone.resultEn,
    delay: zone.delay,
    fee: zone.feeAmount === null ? null : { amount: zone.feeAmount, currency: 'XAF', from: zone.feeFrom },
    active: zone.active,
    quarters: zone.quarters.map((quarter) => ({
      name: quarter.name,
      detail: quarter.detail,
      mapLabel: quarter.mapLabel,
      isBase: quarter.isBase,
      labelOnSmallMap: quarter.labelOnSmallMap,
      coordinates:
        quarter.lat !== null && quarter.lng !== null ? { lat: quarter.lat, lng: quarter.lng } : null,
      position: quarter.mapX !== null && quarter.mapY !== null ? { x: quarter.mapX, y: quarter.mapY } : null,
    })),
    area: toZoneArea(zone.area),
    requestsCount,
    sortOrder: zone.sortOrder,
    updatedAt: zone.updatedAt.toISOString(),
    translationStatus: { en: zoneTranslationStatus(zone) },
  };
}

/** Colonnes simples d'une zone (tarif indicatif à plat, contour GeoJSON). */
function scalarData(fields: ZonePatch): Prisma.ZoneUncheckedUpdateInput {
  const { quarters: _quarters, fee, area, reviewedFields: _reviewed, ...rest } = fields;
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rest)) if (value !== undefined) data[key] = value;
  if (fee !== undefined) {
    data['feeAmount'] = fee?.amount ?? null;
    data['feeCurrency'] = 'XAF';
    data['feeFrom'] = fee?.from ?? false;
  }
  if (area !== undefined) data['area'] = area === null ? Prisma.DbNull : area;
  return data;
}

/**
 * Zones d'intervention du back-office (`/v1/admin/zones*`) : quartiers, contours, délais et tarifs indicatifs
 * (masqués sur le site tant que « Afficher les tarifs » est désactivé), activation et ordre d'affichage.
 */
@Injectable()
export class AdminZonesService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private async find(client: Prisma.TransactionClient | PrismaService, id: string): Promise<AdminZoneRecord> {
    const zone = await client.zone.findUnique({ where: { id }, select: adminZoneSelect });
    if (zone === null) throw notFoundException(ADMIN_ZONE_NOT_FOUND);
    return zone;
  }

  /**
   * Demandes des 12 derniers mois dont la ville (clé sans accents de la fiche contact) commence par un quartier de
   * la zone. Les demandes anonymisées, rattachées à la fiche commune sans ville, ne sont pas comptées.
   */
  private async requestsCount(zone: AdminZoneRecord, now: Date): Promise<number> {
    const keys = zone.quarters.map((quarter) => quarter.normalizedName).filter((key) => key !== '');
    if (keys.length === 0) return 0;
    return this.prisma.request.count({
      where: {
        createdAt: { gte: new Date(now.getTime() - 365 * DAY_MS) },
        contact: { OR: keys.map((key) => ({ cityKey: { startsWith: key } })) },
      },
    });
  }

  private async respond(zone: AdminZoneRecord, now: Date): Promise<AdminZone> {
    return toAdminZone(zone, await this.requestsCount(zone, now));
  }

  /** `GET /v1/admin/zones` : zones dans l'ordre du site et option « Afficher les tarifs ». */
  async list(now: Date): Promise<AdminZones> {
    const [zones, setting] = await Promise.all([
      this.prisma.zone.findMany({ orderBy: [{ sortOrder: 'asc' }, { key: 'asc' }], select: adminZoneSelect }),
      this.prisma.setting.findUnique({ where: { key: SETTING_KEYS.zones }, select: { value: true } }),
    ]);
    return {
      zones: await Promise.all(zones.map((zone) => this.respond(zone, now))),
      showFees: asObject(setting?.value)['showFees'] === true,
    };
  }

  /**
   * Remplace les quartiers d'une zone (ordre de la liste). Un quartier déjà présent dans une autre zone y est
   * retiré : un quartier n'appartient qu'à une zone. La traduction anglaise d'un quartier conservé est gardée, même
   * si son texte français change (elle est alors signalée « à revoir » par les empreintes), sauf si le texte
   * français est vidé. Renvoie les quartiers remplacés, par clé.
   */
  private async writeQuarters(
    tx: Prisma.TransactionClient,
    zoneId: string,
    quarters: readonly QuarterInput[],
  ): Promise<Map<string, QuarterTexts>> {
    const keys = quarters.map((quarter) => searchKey(quarter.name));
    const previous = await tx.zoneQuarter.findMany({
      where: { OR: [{ zoneId }, { normalizedName: { in: keys } }] },
      select: { normalizedName: true, detail: true, detailEn: true, mapLabel: true, mapLabelEn: true },
    });
    const byKey = new Map(previous.map((quarter) => [quarter.normalizedName, quarter]));
    await tx.zoneQuarter.deleteMany({ where: { OR: [{ zoneId }, { normalizedName: { in: keys } }] } });
    if (quarters.length === 0) return byKey;
    await tx.zoneQuarter.createMany({
      data: quarters.map((quarter, index) => {
        const normalizedName = keys[index] ?? searchKey(quarter.name);
        const before = byKey.get(normalizedName);
        const detail = quarter.detail ?? null;
        const mapLabel = quarter.mapLabel ?? null;
        return {
          zoneId,
          name: quarter.name,
          normalizedName,
          detail,
          detailEn: detail === null ? null : (before?.detailEn ?? null),
          mapLabel,
          mapLabelEn: mapLabel === null ? null : (before?.mapLabelEn ?? null),
          isBase: quarter.isBase ?? false,
          labelOnSmallMap: quarter.labelOnSmallMap ?? false,
          lat: quarter.coordinates?.lat ?? null,
          lng: quarter.coordinates?.lng ?? null,
          mapX: quarter.position?.x ?? null,
          mapY: quarter.position?.y ?? null,
          sortOrder: index,
        };
      }),
    });
    return byKey;
  }

  /**
   * Empreintes des traductions après une création ou une modification (`translationHashes`) ; `reviewedFields` doit
   * désigner des textes traduits (422 sinon, transaction annulée).
   */
  private async stampTranslations(
    tx: Prisma.TransactionClient,
    id: string,
    before: AdminZoneRecord | null,
    previousQuarters: ReadonlyMap<string, QuarterTexts>,
    reviewed: readonly string[],
  ): Promise<AdminZoneRecord> {
    const after = await this.find(tx, id);
    const errors = reviewedZoneFieldErrors(after, reviewed);
    if (errors.length > 0) throw validationException(errors);
    const translationHashes = nextZoneHashes({ before, after, previousQuarters, reviewed });
    await tx.zone.update({
      where: { id },
      data: { translationHashes },
      select: { id: true },
    });
    return { ...after, translationHashes };
  }

  /** `POST /v1/admin/zones` : à la fin de la liste, inactive sauf mention contraire. */
  async create(input: ZoneInput, actor: AuditActor, now: Date): Promise<AdminZone> {
    const base = slugify(input.name) || 'zone';
    const [taken, last] = await Promise.all([
      this.prisma.zone.findMany({ where: { key: { startsWith: base } }, select: { key: true } }),
      this.prisma.zone.findFirst({ orderBy: [{ sortOrder: 'desc' }], select: { sortOrder: true } }),
    ]);
    const key = uniqueSlug(base, new Set(taken.map((zone) => zone.key)), 'zone');
    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.zone.create({
        data: {
          nameEn: null,
          description: '',
          descriptionEn: null,
          result: 'Intervention possible. Conditions confirmées sur devis.',
          resultEn: null,
          delay: null,
          feeAmount: null,
          feeCurrency: 'XAF',
          feeFrom: false,
          area: Prisma.DbNull,
          isDemo: false,
          ...(scalarData(input) as Prisma.ZoneUncheckedCreateInput),
          key,
          name: input.name,
          tone: input.tone,
          active: input.active ?? false,
          sortOrder: (last?.sortOrder ?? -1) + 1,
        },
        select: { id: true },
      });
      const previousQuarters =
        input.quarters === undefined ? new Map() : await this.writeQuarters(tx, row.id, input.quarters);
      const next = await this.stampTranslations(
        tx,
        row.id,
        null,
        previousQuarters,
        input.reviewedFields ?? [],
      );
      await requestRevalidation(tx, [CACHE_TAGS.zones]);
      await recordAudit(tx, actor, {
        action: 'zone.create',
        entity: 'Zone',
        entityId: row.id,
        label: `A créé la zone « ${input.name} »`,
        after: { key, active: input.active ?? false },
      });
      return next;
    });
    return this.respond(created, now);
  }

  /** `PATCH /v1/admin/zones/{id}` : `quarters` remplace la liste des quartiers. */
  async update(id: string, patch: ZonePatch, actor: AuditActor, now: Date): Promise<AdminZone> {
    const current = await this.find(this.prisma, id);
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.zone.update({ where: { id }, data: scalarData(patch), select: { id: true } });
      // Quartiers inchangés : leurs textes anglais restent ceux d'avant (même clé).
      const previousQuarters =
        patch.quarters === undefined
          ? new Map(current.quarters.map((quarter) => [quarter.normalizedName, quarter]))
          : await this.writeQuarters(tx, id, patch.quarters);
      const next = await this.stampTranslations(
        tx,
        id,
        current,
        previousQuarters,
        patch.reviewedFields ?? [],
      );
      await requestRevalidation(tx, [CACHE_TAGS.zones]);
      await recordAudit(tx, actor, {
        action: 'zone.update',
        entity: 'Zone',
        entityId: id,
        label: `A modifié la zone « ${next.name} »`,
        before: { active: current.active, quarters: current.quarters.length },
        after: { active: next.active, quarters: next.quarters.length },
      });
      return next;
    });
    return this.respond(updated, now);
  }

  /** `DELETE /v1/admin/zones/{id}` : refusé (409) tant que la zone contient des quartiers. */
  async remove(id: string, actor: AuditActor): Promise<void> {
    const zone = await this.find(this.prisma, id);
    if (zone.quarters.length > 0) {
      throw new ProblemException({
        status: HttpStatus.CONFLICT,
        type: 'conflict',
        title: 'Conflit',
        detail: 'Déplacez ou retirez d’abord les quartiers de cette zone.',
      });
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.zone.delete({ where: { id }, select: { id: true } });
      await requestRevalidation(tx, [CACHE_TAGS.zones]);
      await recordAudit(tx, actor, {
        action: 'zone.delete',
        entity: 'Zone',
        entityId: id,
        label: `A supprimé la zone « ${zone.name} »`,
      });
    });
  }

  /** `PATCH /v1/admin/zones/reorder` : ordre de la légende, de la liste et de la recherche du site. */
  async reorder(input: ReorderInput, actor: AuditActor): Promise<void> {
    const found = await this.prisma.zone.findMany({ where: { id: { in: input.ids } }, select: { id: true } });
    if (found.length !== input.ids.length) {
      throw new ProblemException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        type: 'validation-error',
        title: 'Certaines informations sont à corriger',
        detail: 'L’ordre envoyé ne correspond pas aux zones.',
        errors: [{ path: 'ids', code: 'invalid_order', message: 'Zones inconnues.' }],
      });
    }
    await this.prisma.$transaction(async (tx) => {
      for (const [index, id] of input.ids.entries()) {
        await tx.zone.update({ where: { id }, data: { sortOrder: index }, select: { id: true } });
      }
      await requestRevalidation(tx, [CACHE_TAGS.zones]);
      await recordAudit(tx, actor, {
        action: 'zone.reorder',
        entity: 'Zone',
        entityId: null,
        label: 'A réordonné les zones d’intervention',
        after: { ids: input.ids },
      });
    });
  }
}
