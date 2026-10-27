import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { recordAudit, type AuditActor } from '../../common/audit/audit-log.js';
import { notFoundException, ProblemException, type ProblemFieldError } from '../../common/problem/problem.js';
import { CACHE_TAGS, requestRevalidation } from '../../common/revalidation/revalidation.js';
import { slugify, uniqueSlug } from '../../common/text/slug.js';
import { validationException } from '../../common/validation/validation-exception.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { unknownMediaErrors, type MediaReference } from '../media/media-refs.js';
import { MediaService } from '../media/media.service.js';
import { recordRedirect } from '../navigation/redirects.js';
import {
  adminCategorySelect,
  TINT_FROM_CONTRACT,
  toAdminCategory,
  type AdminCategory,
  type AdminCategoryRecord,
} from './admin-catalog.mapper.js';
import type {
  CategoryInput,
  CategoryPatch,
  OfferSectionInput,
  ReorderInput,
} from './admin-catalog.schemas.js';
import { offerMediaReferences, replaceOffers, unknownTargetErrors } from './admin-offers.js';
import { categoryHref, serviceHref } from './catalog.mapper.js';

export const ADMIN_CATEGORY_NOT_FOUND = 'Cette rubrique n’existe pas ou a été supprimée.';

type Tx = Prisma.TransactionClient;

function conflict(detail: string, errors: ProblemFieldError[] = []): ProblemException {
  return new ProblemException({
    status: HttpStatus.CONFLICT,
    type: 'conflict',
    title: 'Conflit',
    detail,
    errors,
  });
}

/** Colonnes simples d'une rubrique (la teinte passe du format du contrat à celui de la base). */
function scalarData(fields: CategoryPatch): Prisma.CategoryUncheckedUpdateInput {
  const { offerSections: _sections, tint, homeCard, highlight, ...rest } = fields;
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rest)) if (value !== undefined) data[key] = value;
  if (tint !== undefined) data['tint'] = TINT_FROM_CONTRACT[tint];
  if (homeCard !== undefined) data['homeCard'] = homeCard;
  if (highlight !== undefined) data['highlight'] = highlight ?? Prisma.DbNull;
  return data;
}

/** Valeurs d'une nouvelle rubrique (celles du schéma Prisma, écrites explicitement). */
const CATEGORY_DEFAULTS = {
  slugEn: null,
  eyebrow: null,
  iconColor: null,
  illustration: 'accueil',
  imageId: null,
  visuals: Prisma.DbNull,
  homeCard: Prisma.DbNull,
  audiencesTitle: null,
  audiences: [],
  servicesTitle: null,
  servicesLead: null,
  groups: [],
  highlight: Prisma.DbNull,
  processEyebrow: null,
  processTitle: null,
  processSteps: [],
  testimonialId: null,
  quoteFields: [],
  ctaTitle: null,
  ctaText: null,
  seoTitle: null,
  seoDescription: null,
  translations: Prisma.DbNull,
  isDemo: false,
} satisfies Partial<Prisma.CategoryUncheckedCreateInput>;

/** Étiquettes de cache d'une rubrique visible (ou qui vient de l'être). */
function categoryTags(...slugs: string[]): string[] {
  return [
    CACHE_TAGS.categories,
    CACHE_TAGS.services,
    CACHE_TAGS.navigation,
    CACHE_TAGS.sitemap,
    CACHE_TAGS.page('accueil'),
    ...slugs.map((slug) => CACHE_TAGS.category(slug)),
  ];
}

/**
 * Rubriques du back-office (`/v1/admin/categories*`) : tous statuts, création, modification (contenu de la page
 * rubrique, carrousels d'offres, champs du devis, statut), ordre, suppression d'une rubrique vide.
 */
@Injectable()
export class AdminCategoriesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MediaService) private readonly media: MediaService,
  ) {}

  private async find(client: Tx | PrismaService, id: string): Promise<AdminCategoryRecord> {
    const category = await client.category.findUnique({ where: { id }, select: adminCategorySelect });
    if (category === null) throw notFoundException(ADMIN_CATEGORY_NOT_FOUND);
    return category;
  }

  /** `GET /v1/admin/categories` */
  async list(): Promise<AdminCategory[]> {
    const categories = await this.prisma.category.findMany({
      orderBy: [{ sortOrder: 'asc' }, { slug: 'asc' }],
      select: adminCategorySelect,
    });
    return categories.map((category) => toAdminCategory(category, this.media));
  }

  /** `GET /v1/admin/categories/{id}` */
  async detail(id: string): Promise<AdminCategory> {
    return toAdminCategory(await this.find(this.prisma, id), this.media);
  }

  /** Image, témoignage (avis publié), images et services présélectionnés des carrousels. */
  private async checkReferences(fields: CategoryPatch): Promise<void> {
    const errors: ProblemFieldError[] = [];
    const sections = fields.offerSections ?? [];
    const references: MediaReference[] = [
      ...(fields.imageId === undefined ? [] : [{ path: 'imageId', id: fields.imageId }]),
      ...sections.flatMap((section, index) =>
        offerMediaReferences(`offerSections.${String(index)}.offers`, section.offers),
      ),
    ];
    errors.push(...(await unknownMediaErrors(this.media, references)));

    if (typeof fields.testimonialId === 'string') {
      const review = await this.prisma.review.findFirst({
        where: { id: fields.testimonialId, status: 'PUBLIE' },
        select: { id: true },
      });
      if (review === null)
        errors.push({
          path: 'testimonialId',
          code: 'unpublished_review',
          message: 'Choisissez un avis publié.',
        });
    }

    const targets = sections.flatMap((section) =>
      section.offers.flatMap((offer) => (typeof offer.serviceId === 'string' ? [offer.serviceId] : [])),
    );
    if (targets.length > 0) {
      const found = await this.prisma.service.findMany({
        where: { id: { in: [...new Set(targets)] } },
        select: { id: true },
      });
      const known = new Set(found.map((service) => service.id));
      sections.forEach((section, index) =>
        errors.push(...unknownTargetErrors(`offerSections.${String(index)}.offers`, section.offers, known)),
      );
    }
    if (errors.length > 0) throw validationException(errors);
  }

  private async ensureSlugFree(slug: string, exceptId: string | null): Promise<void> {
    const taken = await this.prisma.category.findFirst({
      where: { slug, ...(exceptId === null ? {} : { id: { not: exceptId } }) },
      select: { id: true },
    });
    if (taken !== null)
      throw conflict('Une rubrique utilise déjà cette adresse.', [
        {
          path: 'slug',
          code: 'slug_taken',
          message: 'Cette adresse est déjà utilisée par une autre rubrique.',
        },
      ]);
  }

  /** Remplace les carrousels d'offres (sections et cartes), en gardant les identifiants connus. */
  private async writeSections(
    tx: Tx,
    categoryId: string,
    sections: readonly OfferSectionInput[],
  ): Promise<void> {
    const existing = await tx.categoryOfferSection.findMany({
      where: { categoryId },
      select: { id: true, offers: { select: { id: true, translations: true } } },
    });
    const offers = new Map(
      existing.flatMap((section) => section.offers.map((offer) => [offer.id, offer.translations])),
    );
    const sectionIds = existing.map((section) => section.id);
    if (sectionIds.length > 0) {
      await tx.serviceOffer.deleteMany({ where: { sectionId: { in: sectionIds } } });
      await tx.categoryOfferSection.deleteMany({ where: { categoryId } });
    }
    for (const [index, section] of sections.entries()) {
      const row = await tx.categoryOfferSection.create({
        data: {
          categoryId,
          eyebrow: section.eyebrow,
          title: section.title,
          titleMobile: section.titleMobile ?? null,
          lead: section.lead ?? null,
          leadMobile: section.leadMobile ?? null,
          sortOrder: index + 1,
        },
        select: { id: true },
      });
      await replaceOffers(tx, { sectionId: row.id }, section.offers, offers);
    }
  }

  /** `POST /v1/admin/categories` : brouillon à la fin de la liste ; slug tiré du nom (`-2`… si besoin). */
  async create(input: CategoryInput, actor: AuditActor): Promise<AdminCategory> {
    await this.checkReferences(input);
    let slug: string;
    if (input.slug !== undefined) {
      await this.ensureSlugFree(input.slug, null);
      slug = input.slug;
    } else {
      const base = slugify(input.name) || 'rubrique';
      const taken = await this.prisma.category.findMany({
        where: { slug: { startsWith: base } },
        select: { slug: true },
      });
      slug = uniqueSlug(base, new Set(taken.map((category) => category.slug)), 'rubrique');
    }
    const last = await this.prisma.category.findFirst({
      orderBy: [{ sortOrder: 'desc' }],
      select: { sortOrder: true },
    });
    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.category.create({
        data: {
          ...CATEGORY_DEFAULTS,
          ...(scalarData(input) as Prisma.CategoryUncheckedCreateInput),
          name: input.name,
          tagline: input.tagline,
          description: input.description,
          icon: input.icon,
          tint: TINT_FROM_CONTRACT[input.tint],
          slug,
          heroTitle: input.heroTitle ?? input.name,
          heroLead: input.heroLead ?? input.description,
          status: input.status ?? 'DRAFT',
          sortOrder: (last?.sortOrder ?? 0) + 1,
        },
        select: { id: true },
      });
      if (input.offerSections !== undefined) await this.writeSections(tx, row.id, input.offerSections);
      if (input.status === 'PUBLISHED') await requestRevalidation(tx, categoryTags(slug));
      await recordAudit(tx, actor, {
        action: 'category.create',
        entity: 'Category',
        entityId: row.id,
        label: `A créé la rubrique « ${input.name} »`,
        after: { status: input.status ?? 'DRAFT', slug },
      });
      return this.find(tx, row.id);
    });
    return toAdminCategory(created, this.media);
  }

  /**
   * `PATCH /v1/admin/categories/{id}` : mise à jour partielle. Rubrique publiée dont le slug change : redirections
   * 301 de la page rubrique et de ses fiches publiées vers les nouvelles adresses.
   */
  async update(id: string, patch: CategoryPatch, actor: AuditActor): Promise<AdminCategory> {
    const current = await this.find(this.prisma, id);
    await this.checkReferences(patch);
    if (patch.slug !== undefined && patch.slug !== current.slug) await this.ensureSlugFree(patch.slug, id);
    const wasVisible = current.status === 'PUBLISHED';
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.category.update({ where: { id }, data: scalarData(patch), select: { id: true } });
      if (patch.offerSections !== undefined) await this.writeSections(tx, id, patch.offerSections);
      const next = await this.find(tx, id);
      let redirected = false;
      if (wasVisible && next.slug !== current.slug) {
        redirected = await recordRedirect(tx, categoryHref(current.slug), categoryHref(next.slug), {
          name: 'Category',
          id,
        });
        const services = await tx.service.findMany({
          where: { categoryId: id, status: 'PUBLISHED', kind: 'SERVICE' },
          select: { id: true, slug: true },
        });
        for (const service of services) {
          await recordRedirect(
            tx,
            serviceHref(current.slug, service.slug, 'SERVICE'),
            serviceHref(next.slug, service.slug, 'SERVICE'),
            { name: 'Service', id: service.id },
          );
        }
      }
      if (wasVisible || next.status === 'PUBLISHED')
        await requestRevalidation(tx, [
          ...categoryTags(current.slug, next.slug),
          ...(redirected ? [CACHE_TAGS.redirects] : []),
        ]);
      await recordAudit(tx, actor, {
        action: 'category.update',
        entity: 'Category',
        entityId: id,
        label: `A modifié la rubrique « ${next.name} »`,
        before: { status: current.status, slug: current.slug },
        after: { status: next.status, slug: next.slug },
      });
      return next;
    });
    return toAdminCategory(updated, this.media);
  }

  /** `DELETE /v1/admin/categories/{id}` : seulement une rubrique sans aucun service (409 sinon). */
  async remove(id: string, actor: AuditActor): Promise<void> {
    const category = await this.find(this.prisma, id);
    if (category._count.services > 0)
      throw conflict('Cette rubrique contient encore des services : déplacez-les ou supprimez-les d’abord.');
    await this.prisma.$transaction(async (tx) => {
      await this.writeSections(tx, id, []);
      await tx.contactInterest.deleteMany({ where: { categoryId: id } });
      await tx.redirect.deleteMany({ where: { entity: 'Category', entityId: id } });
      await tx.category.delete({ where: { id }, select: { id: true } });
      if (category.status === 'PUBLISHED') await requestRevalidation(tx, categoryTags(category.slug));
      await recordAudit(tx, actor, {
        action: 'category.delete',
        entity: 'Category',
        entityId: id,
        label: `A supprimé la rubrique « ${category.name} »`,
        before: { status: category.status, slug: category.slug },
      });
    });
  }

  /** `PATCH /v1/admin/categories/reorder` : ordre des rubriques (site, menus, accueil). */
  async reorder(input: ReorderInput, actor: AuditActor): Promise<void> {
    const found = await this.prisma.category.findMany({
      where: { id: { in: input.ids } },
      select: { id: true },
    });
    if (found.length !== input.ids.length) {
      throw new ProblemException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        type: 'validation-error',
        title: 'Certaines informations sont à corriger',
        detail: 'L’ordre envoyé ne correspond pas aux rubriques.',
        errors: [{ path: 'ids', code: 'invalid_order', message: 'Rubriques inconnues.' }],
      });
    }
    await this.prisma.$transaction(async (tx) => {
      for (const [index, id] of input.ids.entries()) {
        await tx.category.update({ where: { id }, data: { sortOrder: index + 1 }, select: { id: true } });
      }
      await requestRevalidation(tx, categoryTags());
      await recordAudit(tx, actor, {
        action: 'category.reorder',
        entity: 'Category',
        entityId: null,
        label: 'A réordonné les rubriques',
        after: { ids: input.ids },
      });
    });
  }
}
