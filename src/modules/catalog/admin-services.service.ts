import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { recordAudit, type AuditActor } from '../../common/audit/audit-log.js';
import {
  PREVIEW_TOKEN_TTL_MS,
  previewUrl,
  signPreviewToken,
  type PreviewToken,
} from '../../common/preview/preview-token.js';
import { notFoundException, ProblemException, type ProblemFieldError } from '../../common/problem/problem.js';
import { CACHE_TAGS, requestRevalidation } from '../../common/revalidation/revalidation.js';
import { slugify, uniqueSlug } from '../../common/text/slug.js';
import { validationException } from '../../common/validation/validation-exception.js';
import { AppConfigService } from '../../config/app-config.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { unknownMediaErrors, type MediaReference } from '../media/media-refs.js';
import { MediaService } from '../media/media.service.js';
import { recordRedirect } from '../navigation/redirects.js';
import {
  adminServiceSelect,
  parseIfMatch,
  serviceCompleteness,
  servicePath,
  serviceVersion,
  toAdminService,
  toAdminServiceListItem,
  type AdminService,
  type AdminServiceListItem,
  type AdminServiceRecord,
  type Completeness,
} from './admin-catalog.mapper.js';
import type {
  ListAdminServicesQuery,
  OfferInput,
  ReorderInput,
  ServiceInput,
  ServicePatch,
} from './admin-catalog.schemas.js';
import { offerMediaReferences, replaceOffers, unknownTargetErrors } from './admin-offers.js';
import {
  nextCatalogTranslations,
  reviewedCatalogFieldErrors,
  SERVICE_TEXT_FIELDS,
} from './catalog-translations.js';
import { normalizeSearch } from './catalog.service.js';

export const ADMIN_SERVICE_NOT_FOUND = 'Ce service n’existe pas ou a été supprimé.';
const SITE_NAME_SUFFIX = ' | MAMBO Proxi';
const DAY_MS = 86_400_000;

type Tx = Prisma.TransactionClient;

export interface AdminServicesList {
  data: AdminServiceListItem[];
  countsByCategory: Record<string, number>;
}

/** Champs « listes » d'un service, enregistrés dans des tables liées. */
interface ServiceLists {
  galleryImageIds?: string[];
  relatedServiceIds?: string[];
  featuredReviewIds?: string[];
  offers?: OfferInput[];
}

function conflict(detail: string, errors: ProblemFieldError[]): ProblemException {
  return new ProblemException({
    status: HttpStatus.CONFLICT,
    type: 'conflict',
    title: 'Conflit',
    detail,
    errors,
  });
}

const SLUG_TAKEN = (): ProblemException =>
  conflict('Un service utilise déjà cette adresse.', [
    { path: 'slug', code: 'slug_taken', message: 'Cette adresse est déjà utilisée par un autre service.' },
  ]);

/** Titre Google pré-rempli : « Nom | MAMBO Proxi » (60 caractères au plus). */
export function defaultSeoTitle(name: string): string {
  const title = `${name}${SITE_NAME_SUFFIX}`;
  return title.length <= 60 ? title : name.slice(0, 60).trim();
}

/** Description Google pré-remplie : description courte, sinon accroche (160 caractères au plus). */
export function defaultSeoDescription(summary: string | undefined, tagline: string): string | null {
  const text = (summary !== undefined && summary !== '' ? summary : tagline).slice(0, 160).trim();
  return text === '' ? null : text;
}

/** Valeurs d'un nouveau service (celles du schéma Prisma, écrites explicitement). */
const SERVICE_DEFAULTS = {
  shortName: null,
  kind: 'SERVICE',
  summary: '',
  icon: 'Sparkles',
  illustration: 'accueil',
  coverImageId: null,
  cities: [],
  audiences: [],
  steps: [],
  advantages: [],
  faq: [],
  quoteBullets: [],
  offersEyebrow: null,
  offersTitle: null,
  offersLead: null,
  offersLeadMobile: null,
  showInMenu: true,
  featuredOnHome: false,
  showWhatsapp: true,
  reviewsTitle: null,
  relatedTitle: null,
  ctaTitle: null,
  ctaText: null,
  toComplete: false,
  version: 1,
  publishedAt: null,
  isDemo: false,
} satisfies Partial<Prisma.ServiceUncheckedCreateInput>;

/** Colonnes simples d'un service à partir des champs envoyés (les listes sont traitées à part). */
function scalarData(fields: ServicePatch): Prisma.ServiceUncheckedUpdateInput {
  const {
    galleryImageIds: _gallery,
    relatedServiceIds: _related,
    featuredReviewIds: _featured,
    offers: _offers,
    translations: _translations,
    ...scalars
  } = fields;
  const data: Prisma.ServiceUncheckedUpdateInput = {};
  for (const [key, value] of Object.entries(scalars)) {
    if (value !== undefined) (data as Record<string, unknown>)[key] = value;
  }
  return data;
}

/** Valeur de la colonne JSON `translations` (`null` → SQL NULL). */
function translationsColumn(value: Prisma.JsonObject | null): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return value === null ? Prisma.DbNull : value;
}

/**
 * Colonne `translations` après un enregistrement (`CatalogTranslations`) : `undefined` si ni la version anglaise ni
 * un texte français modifiable n'est envoyé (colonne inchangée). `422` pour un `reviewedFields` sans traduction.
 */
function serviceTranslations(
  current: AdminServiceRecord | null,
  fields: ServicePatch,
  french: object,
): Prisma.InputJsonValue | typeof Prisma.DbNull | undefined {
  const input = fields.translations;
  const touched = SERVICE_TEXT_FIELDS.some((field) => fields[field] !== undefined);
  if (input === undefined && !touched) return undefined;
  if (input !== undefined) {
    const errors = reviewedCatalogFieldErrors(SERVICE_TEXT_FIELDS, french, input);
    if (errors.length > 0) throw validationException(errors);
  }
  return translationsColumn(
    nextCatalogTranslations({
      fields: SERVICE_TEXT_FIELDS,
      previousFrench: current,
      french,
      stored: current?.translations ?? null,
      input,
    }) as Prisma.JsonObject | null,
  );
}

/** Textes français après l'enregistrement : valeurs envoyées, sinon celles du service. */
function frenchAfter(current: object, fields: ServicePatch): object {
  const next: Record<string, unknown> = { ...current };
  for (const field of SERVICE_TEXT_FIELDS) if (fields[field] !== undefined) next[field] = fields[field];
  return next;
}

/** Étiquettes de cache du site concernées par un service publié (ancienne et nouvelle adresse). */
function serviceTags(...services: { slug: string; categorySlug: string }[]): string[] {
  return [
    CACHE_TAGS.services,
    CACHE_TAGS.categories,
    CACHE_TAGS.navigation,
    CACHE_TAGS.sitemap,
    CACHE_TAGS.page('accueil'),
    ...services.flatMap((service) => [
      CACHE_TAGS.service(service.slug),
      CACHE_TAGS.category(service.categorySlug),
    ]),
  ];
}

/**
 * Services du back-office (`/v1/admin/services*`) : liste et compteurs, édition (sauvegarde automatique,
 * verrouillage optimiste `If-Match`), publication, duplication, ordre, complétude, jeton d'aperçu. La publication
 * ne fait que changer le statut : fiche, carte de rubrique, menu, option du devis et plan du site sont tous lus
 * depuis les services publiés.
 */
@Injectable()
export class AdminServicesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MediaService) private readonly media: MediaService,
    @Inject(AppConfigService) private readonly config: AppConfigService,
  ) {}

  private async find(client: Tx | PrismaService, id: string): Promise<AdminServiceRecord> {
    const service = await client.service.findUnique({ where: { id }, select: adminServiceSelect });
    if (service === null) throw notFoundException(ADMIN_SERVICE_NOT_FOUND);
    return service;
  }

  /** Demandes des 30 derniers jours par service (une requête). */
  private async requests30d(serviceIds: string[], now: Date): Promise<Map<string, number>> {
    if (serviceIds.length === 0) return new Map();
    const groups = await this.prisma.request.groupBy({
      by: ['serviceId'],
      where: { serviceId: { in: serviceIds }, createdAt: { gte: new Date(now.getTime() - 30 * DAY_MS) } },
      _count: { _all: true },
    });
    return new Map(
      groups.flatMap((group) => (group.serviceId === null ? [] : [[group.serviceId, group._count._all]])),
    );
  }

  private async respond(service: AdminServiceRecord, now: Date): Promise<AdminService> {
    const counts = await this.requests30d([service.id], now);
    return toAdminService(service, this.media, counts.get(service.id) ?? 0);
  }

  /** `GET /v1/admin/services` : services triés par rubrique puis ordre, compteurs par rubrique (sans ce filtre). */
  async list(query: ListAdminServicesQuery, now: Date): Promise<AdminServicesList> {
    const [services, categories] = await Promise.all([
      this.prisma.service.findMany({
        where: query.status === undefined ? {} : { status: query.status },
        orderBy: [{ category: { sortOrder: 'asc' } }, { sortOrder: 'asc' }, { slug: 'asc' }],
        select: adminServiceSelect,
      }),
      this.prisma.category.findMany({
        orderBy: [{ sortOrder: 'asc' }, { slug: 'asc' }],
        select: { slug: true },
      }),
    ]);
    const needle = query.q === undefined ? '' : normalizeSearch(query.q);
    const matching = services.filter(
      (service) =>
        needle === '' || normalizeSearch(`${service.name} ${servicePath(service)}`).includes(needle),
    );
    const countsByCategory = Object.fromEntries(categories.map((category) => [category.slug, 0]));
    for (const service of matching) {
      countsByCategory[service.category.slug] = (countsByCategory[service.category.slug] ?? 0) + 1;
    }
    const listed = matching.filter(
      (service) => query.category === undefined || service.category.slug === query.category,
    );
    const counts = await this.requests30d(
      listed.map((service) => service.id),
      now,
    );
    return {
      data: listed.map((service) => toAdminServiceListItem(service, this.media, counts.get(service.id) ?? 0)),
      countsByCategory,
    };
  }

  /** `GET /v1/admin/services/{id}` */
  async detail(id: string, now: Date): Promise<AdminService> {
    return this.respond(await this.find(this.prisma, id), now);
  }

  /** `GET /v1/admin/services/{id}/completeness` */
  async completeness(id: string): Promise<Completeness> {
    return serviceCompleteness(await this.find(this.prisma, id));
  }

  /**
   * Références d'un enregistrement : rubrique, images de la médiathèque, services liés et présélectionnés, avis
   * publiés. Toutes les erreurs sont renvoyées ensemble (422).
   */
  private async checkReferences(
    serviceId: string | null,
    fields: ServicePatch,
  ): Promise<{ categorySlug?: string }> {
    const errors: ProblemFieldError[] = [];
    let categorySlug: string | undefined;
    if (fields.categoryId !== undefined) {
      const category = await this.prisma.category.findUnique({
        where: { id: fields.categoryId },
        select: { slug: true },
      });
      if (category === null)
        errors.push({
          path: 'categoryId',
          code: 'unknown_category',
          message: 'Cette rubrique n’existe pas.',
        });
      else categorySlug = category.slug;
    }

    const mediaReferences: MediaReference[] = [
      ...(fields.coverImageId === undefined ? [] : [{ path: 'coverImageId', id: fields.coverImageId }]),
      ...(fields.galleryImageIds ?? []).map((id, index) => ({
        path: `galleryImageIds.${String(index)}`,
        id,
      })),
      ...offerMediaReferences('offers', fields.offers ?? []),
    ];
    errors.push(...(await unknownMediaErrors(this.media, mediaReferences)));

    const serviceIds = [
      ...(fields.relatedServiceIds ?? []),
      ...(fields.offers ?? []).flatMap((offer) =>
        typeof offer.serviceId === 'string' ? [offer.serviceId] : [],
      ),
    ];
    if (serviceIds.length > 0) {
      const found = await this.prisma.service.findMany({
        where: { id: { in: [...new Set(serviceIds)] } },
        select: { id: true },
      });
      const known = new Set(found.map((service) => service.id));
      (fields.relatedServiceIds ?? []).forEach((id, index) => {
        const path = `relatedServiceIds.${String(index)}`;
        if (id === serviceId)
          errors.push({
            path,
            code: 'self_reference',
            message: 'Un service ne peut pas être lié à lui-même.',
          });
        else if (!known.has(id))
          errors.push({ path, code: 'unknown_service', message: 'Ce service n’existe pas.' });
      });
      errors.push(...unknownTargetErrors('offers', fields.offers ?? [], known));
    }

    if ((fields.featuredReviewIds ?? []).length > 0) {
      const published = await this.prisma.review.findMany({
        where: { id: { in: fields.featuredReviewIds }, status: 'PUBLIE' },
        select: { id: true },
      });
      const known = new Set(published.map((review) => review.id));
      (fields.featuredReviewIds ?? []).forEach((id, index) => {
        if (!known.has(id))
          errors.push({
            path: `featuredReviewIds.${String(index)}`,
            code: 'unpublished_review',
            message: 'Choisissez un avis publié.',
          });
      });
    }

    if (errors.length > 0) throw validationException(errors);
    return categorySlug === undefined ? {} : { categorySlug };
  }

  /** Slug libre (adresse unique de la fiche) : 409 pour un slug choisi déjà pris par un autre service. */
  private async ensureSlugFree(slug: string, exceptId: string | null): Promise<void> {
    const taken = await this.prisma.service.findFirst({
      where: { slug, ...(exceptId === null ? {} : { id: { not: exceptId } }) },
      select: { id: true },
    });
    if (taken !== null) throw SLUG_TAKEN();
  }

  /** Slug libre tiré d'un nom (`-2`, `-3`… si besoin). */
  private async freeSlug(base: string): Promise<string> {
    const root = base === '' ? 'service' : base;
    const taken = await this.prisma.service.findMany({
      where: { slug: { startsWith: root } },
      select: { slug: true },
    });
    return uniqueSlug(root, new Set(taken.map((service) => service.slug)), 'service');
  }

  /** Rang suivant dans une rubrique (le service s'ajoute à la fin). */
  private async nextSortOrder(client: Tx | PrismaService, categoryId: string): Promise<number> {
    const last = await client.service.findFirst({
      where: { categoryId },
      orderBy: [{ sortOrder: 'desc' }],
      select: { sortOrder: true },
    });
    return (last?.sortOrder ?? 0) + 1;
  }

  /** Remplace les listes envoyées (galerie, services liés, avis mis en avant, offres). */
  private async writeLists(
    tx: Tx,
    service: Pick<AdminServiceRecord, 'id'> & { offers: { id: string }[] },
    lists: ServiceLists,
  ): Promise<void> {
    const serviceId = service.id;
    if (lists.galleryImageIds !== undefined) {
      await tx.serviceGalleryImage.deleteMany({ where: { serviceId } });
      if (lists.galleryImageIds.length > 0)
        await tx.serviceGalleryImage.createMany({
          data: lists.galleryImageIds.map((mediaId, index) => ({ serviceId, mediaId, sortOrder: index + 1 })),
        });
    }
    if (lists.relatedServiceIds !== undefined) {
      await tx.serviceRelation.deleteMany({ where: { serviceId } });
      if (lists.relatedServiceIds.length > 0)
        await tx.serviceRelation.createMany({
          data: lists.relatedServiceIds.map((relatedServiceId, index) => ({
            serviceId,
            relatedServiceId,
            sortOrder: index + 1,
          })),
        });
    }
    if (lists.featuredReviewIds !== undefined) {
      await tx.serviceFeaturedReview.deleteMany({ where: { serviceId } });
      if (lists.featuredReviewIds.length > 0)
        await tx.serviceFeaturedReview.createMany({
          data: lists.featuredReviewIds.map((reviewId, index) => ({
            serviceId,
            reviewId,
            sortOrder: index + 1,
          })),
        });
    }
    if (lists.offers !== undefined) {
      const existing = await tx.serviceOffer.findMany({
        where: { serviceId },
        select: { id: true, translations: true },
      });
      await replaceOffers(
        tx,
        { serviceId },
        lists.offers,
        new Map(existing.map((offer) => [offer.id, offer.translations])),
      );
    }
  }

  /** `POST /v1/admin/services` : brouillon, à la fin de sa rubrique, slug et SEO pré-remplis. */
  async create(input: ServiceInput, actor: AuditActor, now: Date): Promise<AdminService> {
    await this.checkReferences(null, input);
    let slug: string;
    if (input.slug !== undefined) {
      await this.ensureSlugFree(input.slug, null);
      slug = input.slug;
    } else {
      slug = await this.freeSlug(slugify(input.name));
    }
    const { galleryImageIds, relatedServiceIds, featuredReviewIds, offers } = input;
    const seoTitle = input.seoTitle === undefined ? defaultSeoTitle(input.name) : input.seoTitle;
    const seoDescription =
      input.seoDescription === undefined
        ? defaultSeoDescription(input.summary, input.tagline)
        : input.seoDescription;
    const translations =
      input.translations === undefined
        ? undefined
        : serviceTranslations(
            null,
            { translations: input.translations },
            frenchAfter({ ...SERVICE_DEFAULTS, seoTitle, seoDescription }, input),
          );
    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.service.create({
        data: {
          ...SERVICE_DEFAULTS,
          ...(scalarData(input) as Prisma.ServiceUncheckedCreateInput),
          name: input.name,
          categoryId: input.categoryId,
          tagline: input.tagline,
          slug,
          seoTitle,
          seoDescription,
          ...(translations === undefined ? {} : { translations }),
          status: 'DRAFT',
          sortOrder: await this.nextSortOrder(tx, input.categoryId),
        },
        select: { id: true },
      });
      await this.writeLists(
        tx,
        { id: row.id, offers: [] },
        { galleryImageIds, relatedServiceIds, featuredReviewIds, offers },
      );
      await recordAudit(tx, actor, {
        action: 'service.create',
        entity: 'Service',
        entityId: row.id,
        label: `A créé le service « ${input.name} »`,
        after: { status: 'DRAFT', slug },
      });
      return this.find(tx, row.id);
    });
    await this.media.refreshUsages({ kind: 'service', entityId: created.id });
    return this.respond(created, now);
  }

  /**
   * `PATCH /v1/admin/services/{id}` : enregistrement partiel (sauvegarde automatique). `If-Match` différent de la
   * version actuelle → 412. Service publié : nom et accroche restent obligatoires, la modification est en ligne
   * aussitôt (revalidation), et un changement d'adresse (slug ou rubrique) crée une redirection 301.
   */
  async update(
    id: string,
    patch: ServicePatch,
    ifMatch: string | undefined,
    actor: AuditActor,
    now: Date,
  ): Promise<AdminService> {
    const current = await this.find(this.prisma, id);
    const expected = parseIfMatch(ifMatch);
    if (expected !== undefined && expected !== serviceVersion(current.version)) {
      throw new ProblemException({
        status: HttpStatus.PRECONDITION_FAILED,
        type: 'precondition-failed',
        title: 'Version obsolète',
        detail:
          'Ce service a été modifié ailleurs entre-temps. Rechargez la page pour voir la dernière version.',
      });
    }
    if (current.status === 'PUBLISHED') {
      const errors: ProblemFieldError[] = [];
      if (patch.tagline !== undefined && patch.tagline === '')
        errors.push({ path: 'tagline', code: 'required', message: 'Écrivez une phrase d’accroche.' });
      if (errors.length > 0) throw validationException(errors);
    }
    const { categorySlug } = await this.checkReferences(id, patch);
    if (patch.slug !== undefined && patch.slug !== current.slug) await this.ensureSlugFree(patch.slug, id);
    const translations = serviceTranslations(current, patch, frenchAfter(current, patch));

    const movesCategory = patch.categoryId !== undefined && patch.categoryId !== current.categoryId;
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.service.update({
        where: { id },
        data: {
          ...scalarData(patch),
          ...(translations === undefined ? {} : { translations }),
          ...(movesCategory && patch.categoryId !== undefined
            ? { sortOrder: await this.nextSortOrder(tx, patch.categoryId) }
            : {}),
          version: { increment: 1 },
        },
        select: { id: true },
      });
      await this.writeLists(tx, current, patch);
      const next = await this.find(tx, id);
      if (current.status === 'PUBLISHED') {
        const before = servicePath(current);
        const after = servicePath(next);
        const redirected = await recordRedirect(tx, before, after, { name: 'Service', id });
        await requestRevalidation(tx, [
          ...serviceTags(
            { slug: current.slug, categorySlug: current.category.slug },
            { slug: next.slug, categorySlug: categorySlug ?? next.category.slug },
          ),
          ...(redirected ? [CACHE_TAGS.redirects] : []),
        ]);
        await recordAudit(tx, actor, {
          action: 'service.update',
          entity: 'Service',
          entityId: id,
          label: `A modifié le service en ligne « ${next.name} »`,
          before: { slug: current.slug, path: before },
          after: { slug: next.slug, path: after },
        });
      }
      return next;
    });
    await this.media.refreshUsages({ kind: 'service', entityId: id });
    return this.respond(updated, now);
  }

  /** `DELETE /v1/admin/services/{id}` : brouillon ou archivé seulement (409 s'il est publié). */
  async remove(id: string, actor: AuditActor): Promise<void> {
    const service = await this.find(this.prisma, id);
    if (service.status === 'PUBLISHED') {
      throw conflict('Ce service est publié : dépubliez-le avant de le supprimer.', []);
    }
    await this.prisma.$transaction(async (tx) => {
      // Listes liées supprimées explicitement (cascade de la base) ; demandes et avis gardent leur historique.
      await tx.serviceGalleryImage.deleteMany({ where: { serviceId: id } });
      await tx.serviceRelation.deleteMany({ where: { OR: [{ serviceId: id }, { relatedServiceId: id }] } });
      await tx.serviceFeaturedReview.deleteMany({ where: { serviceId: id } });
      await tx.serviceOffer.deleteMany({ where: { serviceId: id } });
      await tx.serviceOffer.updateMany({ where: { targetServiceId: id }, data: { targetServiceId: null } });
      await tx.redirect.deleteMany({ where: { entity: 'Service', entityId: id } });
      await tx.service.delete({ where: { id }, select: { id: true } });
      await recordAudit(tx, actor, {
        action: 'service.delete',
        entity: 'Service',
        entityId: id,
        label: `A supprimé le service « ${service.name} »`,
        before: { status: service.status, slug: service.slug },
      });
    });
    await this.media.refreshUsages({ kind: 'service', entityId: id });
  }

  /** Champs exigés pour publier : nom, rubrique et accroche. */
  private publishErrors(service: AdminServiceRecord): ProblemFieldError[] {
    const errors: ProblemFieldError[] = [];
    if (service.name.trim().length < 2)
      errors.push({ path: 'name', code: 'required', message: 'Indiquez le nom du service.' });
    if (service.tagline.trim() === '')
      errors.push({ path: 'tagline', code: 'required', message: 'Écrivez une phrase d’accroche.' });
    return errors;
  }

  /**
   * `POST /v1/admin/services/{id}/publish` : la fiche, la carte de rubrique, l'entrée de menu (`showInMenu`),
   * l'option du devis et l'entrée du plan du site apparaissent (toutes lues depuis les services publiés). La date
   * de publication est celle de la première publication, ou maintenant si elle était programmée plus tard.
   */
  async publish(id: string, actor: AuditActor, now: Date): Promise<AdminService> {
    const service = await this.find(this.prisma, id);
    const errors = this.publishErrors(service);
    if (errors.length > 0) {
      throw new ProblemException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        type: 'validation-error',
        title: 'Certaines informations sont à corriger',
        detail: 'Complétez le nom, la rubrique et la phrase d’accroche avant de publier.',
        errors,
      });
    }
    const publishedAt =
      service.publishedAt !== null && service.publishedAt <= now ? service.publishedAt : now;
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.service.update({
        where: { id },
        data: { status: 'PUBLISHED', publishedAt, version: { increment: 1 } },
        select: { id: true },
      });
      await requestRevalidation(tx, serviceTags({ slug: service.slug, categorySlug: service.category.slug }));
      await recordAudit(tx, actor, {
        action: 'service.publish',
        entity: 'Service',
        entityId: id,
        label: `A publié le service « ${service.name} »`,
        before: { status: service.status },
        after: { status: 'PUBLISHED' },
      });
      return this.find(tx, id);
    });
    return this.respond(updated, now);
  }

  /** `POST /v1/admin/services/{id}/unpublish` : repasse en brouillon (retiré du site, du menu, du devis). */
  async unpublish(id: string, actor: AuditActor, now: Date): Promise<AdminService> {
    const service = await this.find(this.prisma, id);
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.service.update({
        where: { id },
        data: { status: 'DRAFT', version: { increment: 1 } },
        select: { id: true },
      });
      if (service.status === 'PUBLISHED')
        await requestRevalidation(
          tx,
          serviceTags({ slug: service.slug, categorySlug: service.category.slug }),
        );
      await recordAudit(tx, actor, {
        action: 'service.unpublish',
        entity: 'Service',
        entityId: id,
        label: `A dépublié le service « ${service.name} »`,
        before: { status: service.status },
        after: { status: 'DRAFT' },
      });
      return this.find(tx, id);
    });
    return this.respond(updated, now);
  }

  /**
   * `POST /v1/admin/services/{id}/duplicate` : copie en brouillon, « (copie) » ajouté au nom, slug `…-copie`,
   * hors menu et hors accueil, à la fin de la rubrique ; galerie, services liés, avis et offres recopiés.
   */
  async duplicate(id: string, actor: AuditActor, now: Date): Promise<AdminService> {
    const source = await this.find(this.prisma, id);
    const name = `${source.name} (copie)`.slice(0, 120);
    const slug = await this.freeSlug(slugify(`${source.slug}-copie`));
    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.service.create({
        data: {
          ...SERVICE_DEFAULTS,
          slug,
          name,
          shortName: source.shortName,
          categoryId: source.categoryId,
          kind: source.kind,
          tagline: source.tagline,
          summary: source.summary,
          icon: source.icon,
          illustration: source.illustration,
          coverImageId: source.coverImageId,
          cities: source.cities,
          audiences: source.audiences,
          steps: source.steps as Prisma.InputJsonValue,
          advantages: source.advantages as Prisma.InputJsonValue,
          faq: source.faq as Prisma.InputJsonValue,
          quoteBullets: source.quoteBullets,
          offersEyebrow: source.offersEyebrow,
          offersTitle: source.offersTitle,
          offersLead: source.offersLead,
          offersLeadMobile: source.offersLeadMobile,
          showInMenu: false,
          featuredOnHome: false,
          showWhatsapp: source.showWhatsapp,
          reviewsTitle: source.reviewsTitle,
          relatedTitle: source.relatedTitle,
          ctaTitle: source.ctaTitle,
          ctaText: source.ctaText,
          seoTitle: source.seoTitle,
          seoDescription: source.seoDescription,
          toComplete: source.toComplete,
          // Version anglaise recopiée avec son suivi : le nom (« (copie) ») devient « à revoir ».
          ...(source.translations === null ? {} : { translations: source.translations }),
          status: 'DRAFT',
          sortOrder: await this.nextSortOrder(tx, source.categoryId),
        },
        select: { id: true },
      });
      await this.writeLists(
        tx,
        { id: row.id, offers: [] },
        {
          galleryImageIds: source.gallery.map((item) => item.mediaId),
          relatedServiceIds: source.related.map((item) => item.relatedServiceId),
          featuredReviewIds: source.featuredReviews.map((item) => item.reviewId),
          offers: source.offers.map((offer) => ({
            id: null,
            title: offer.title,
            titleMobile: offer.titleMobile,
            text: offer.text,
            textMobile: offer.textMobile,
            icon: offer.icon,
            illustration: offer.illustration,
            imageId: offer.imageId,
            action: offer.action,
            actionLabel: offer.actionLabel,
            actionLabelMobile: offer.actionLabelMobile,
            serviceId: offer.targetServiceId,
          })),
        },
      );
      await this.copyOfferTranslations(tx, row.id, source.offers);
      await recordAudit(tx, actor, {
        action: 'service.duplicate',
        entity: 'Service',
        entityId: row.id,
        label: `A dupliqué le service « ${source.name} »`,
        after: { sourceId: id, slug },
      });
      return this.find(tx, row.id);
    });
    await this.media.refreshUsages({ kind: 'service', entityId: created.id });
    return this.respond(created, now);
  }

  /** Traduction anglaise des offres recopiées (cartes recréées dans l'ordre de celles de la source). */
  private async copyOfferTranslations(
    tx: Tx,
    serviceId: string,
    sourceOffers: AdminServiceRecord['offers'],
  ): Promise<void> {
    if (sourceOffers.every((offer) => offer.translations === null)) return;
    const copies = await tx.serviceOffer.findMany({
      where: { serviceId },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });
    for (const [index, copy] of copies.entries()) {
      const translations = sourceOffers[index]?.translations ?? null;
      if (translations !== null)
        await tx.serviceOffer.update({
          where: { id: copy.id },
          data: { translations: translations },
          select: { id: true },
        });
    }
  }

  /**
   * `PATCH /v1/admin/services/reorder` : ordre d'affichage dans une rubrique (`scope` : slug de la rubrique).
   * Tous les services listés doivent appartenir à la même rubrique ; ceux qui ne sont pas listés gardent leur rang.
   */
  async reorder(input: ReorderInput, actor: AuditActor): Promise<void> {
    const services = await this.prisma.service.findMany({
      where: { id: { in: input.ids } },
      select: { id: true, slug: true, status: true, category: { select: { slug: true } } },
    });
    const scopes = new Set(services.map((service) => service.category.slug));
    const scope = input.scope ?? undefined;
    if (
      services.length !== input.ids.length ||
      scopes.size !== 1 ||
      (scope !== undefined && !scopes.has(scope))
    ) {
      throw new ProblemException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        type: 'validation-error',
        title: 'Certaines informations sont à corriger',
        detail: 'L’ordre envoyé ne correspond pas aux services de la rubrique.',
        errors: [
          { path: 'ids', code: 'invalid_order', message: 'Services inconnus ou d’une autre rubrique.' },
        ],
      });
    }
    const [categorySlug = ''] = [...scopes];
    await this.prisma.$transaction(async (tx) => {
      for (const [index, id] of input.ids.entries()) {
        await tx.service.update({ where: { id }, data: { sortOrder: index + 1 }, select: { id: true } });
      }
      if (services.some((service) => service.status === 'PUBLISHED'))
        await requestRevalidation(tx, [
          CACHE_TAGS.services,
          CACHE_TAGS.categories,
          CACHE_TAGS.navigation,
          CACHE_TAGS.category(categorySlug),
        ]);
      await recordAudit(tx, actor, {
        action: 'service.reorder',
        entity: 'Category',
        entityId: null,
        label: `A réordonné les services de la rubrique « ${categorySlug} »`,
        after: { ids: input.ids },
      });
    });
  }

  /** `GET /v1/admin/services/{id}/preview-token` : aperçu de la fiche complète (30 min), quel que soit le statut. */
  async previewToken(id: string, now: Date): Promise<PreviewToken> {
    const service = await this.find(this.prisma, id);
    const expiresAt = new Date(now.getTime() + PREVIEW_TOKEN_TTL_MS);
    const token = signPreviewToken(this.config.get('TOKEN_SIGNING_SECRET'), {
      kind: 'service',
      id: service.id,
      expiresAt,
    });
    return {
      token,
      url: previewUrl(this.config.get('WEB_URL'), servicePath(service), token),
      expiresAt: expiresAt.toISOString(),
    };
  }
}
