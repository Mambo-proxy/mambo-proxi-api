import { Inject, Injectable } from '@nestjs/common';
import { recordAudit, type AuditActor } from '../../common/audit/audit-log.js';
import { sanitizeRichText } from '../../common/html/rich-text.js';
import {
  PREVIEW_TOKEN_TTL_MS,
  previewUrl,
  signPreviewToken,
  type PreviewToken,
} from '../../common/preview/preview-token.js';
import { notFoundException, type ProblemFieldError } from '../../common/problem/problem.js';
import { CACHE_TAGS, requestRevalidation } from '../../common/revalidation/revalidation.js';
import { searchKey } from '../../common/text/search-key.js';
import { validationException } from '../../common/validation/validation-exception.js';
import { AppConfigService } from '../../config/app-config.service.js';
import { Prisma, type MagazineEditionStatus } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { unknownMediaErrors } from '../media/media-refs.js';
import { MediaService } from '../media/media.service.js';
import {
  conflict,
  EDITION_NOT_FOUND,
  MagazineNewsletterService,
  type MagazineCampaignStats,
} from './magazine-newsletter.service.js';
import {
  displayedDate,
  editionLabel,
  effectiveStatus,
  isOnline,
  MAGAZINE_ARTICLE_SELECT,
  MAGAZINE_EDITION_SELECT,
  toAdminArticle,
  toAdminEdition,
  toAdminSummary,
  type AdminMagazineArticle,
  type AdminMagazineEdition,
  type AdminMagazineEditionSummary,
  type ImageResolver,
  type MagazineEditionRow,
} from './magazine.mapper.js';
import type {
  ArticleInput,
  ArticlePatch,
  EditionInput,
  EditionPatch,
  ListArticlesQuery,
} from './magazine.schemas.js';

export const ARTICLE_NOT_FOUND = 'Cet article n’existe plus.';
const editionNotFound = () => notFoundException(EDITION_NOT_FOUND);
const articleNotFound = () => notFoundException(ARTICLE_NOT_FOUND);

const MAGAZINE_TAG = CACHE_TAGS.page('magazine');

const STATUS_LABELS: Record<MagazineEditionStatus, string> = {
  DRAFT: 'Brouillon',
  SCHEDULED: 'Programmée',
  PUBLISHED: 'Publiée',
  ARCHIVED: 'Archivée',
};

/** Schéma `AdminMagazineOverview`. */
export interface AdminMagazineOverview {
  editions: AdminMagazineEditionSummary[];
  articlesCount: number;
  lastCampaign: MagazineCampaignStats | null;
}

function numberTaken(number: number): ReturnType<typeof conflict> {
  return conflict(`Le numéro ${String(number)} est déjà utilisé par une autre édition.`);
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/** Texte riche facultatif assaini (`null` s'il ne reste rien). */
function richText(value: string | null | undefined): string | null | undefined {
  if (value === undefined || value === null) return value;
  const clean = sanitizeRichText(value);
  return clean === '' ? null : clean;
}

/**
 * Magazine du back-office (tag « Admin — Magazine ») : éditions (brouillon, publication immédiate ou programmée,
 * dépublication, suppression d'une édition non publiée), articles (ordre de lecture dans leur édition, articles sans
 * édition), jeton d'aperçu, envoi par la newsletter (`MagazineNewsletterService`). Textes riches (édito, articles)
 * assainis ; images : médias de la médiathèque (422 `unknown_media`), usages lus par clés étrangères. Toute
 * modification d'une édition publiée ou programmée demande la revalidation de `page:magazine`.
 */
@Injectable()
export class AdminMagazineService {
  private readonly image: ImageResolver;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MediaService) private readonly media: MediaService,
    @Inject(MagazineNewsletterService) private readonly newsletter: MagazineNewsletterService,
    @Inject(AppConfigService) private readonly config: AppConfigService,
  ) {
    this.image = (record) => this.media.image(record);
  }

  private async find(id: string): Promise<MagazineEditionRow> {
    const row = await this.prisma.magazineEdition.findUnique({
      where: { id },
      select: MAGAZINE_EDITION_SELECT,
    });
    if (!row) throw editionNotFound();
    return row;
  }

  // ─────────────────────────── Éditions ───────────────────────────

  /** `GET /v1/admin/magazine` : éditions de la plus récente à la plus ancienne. */
  async overview(now: Date): Promise<AdminMagazineOverview> {
    const rows = await this.prisma.magazineEdition.findMany({ select: MAGAZINE_EDITION_SELECT });
    const date = (row: MagazineEditionRow): number => (displayedDate(row) ?? row.createdAt).getTime();
    rows.sort((a, b) => date(b) - date(a) || (b.number ?? 0) - (a.number ?? 0) || a.id.localeCompare(b.id));
    const [readers, articlesCount, lastCampaign] = await Promise.all([
      this.newsletter.readers(rows.map((row) => row.id)),
      this.prisma.magazineArticle.count(),
      this.newsletter.lastCampaign(),
    ]);
    return {
      editions: rows.map((row) => toAdminSummary(row, this.image, readers.get(row.id) ?? 0, now)),
      articlesCount,
      lastCampaign,
    };
  }

  /** `GET /v1/admin/magazine/editions/{id}` */
  async detail(id: string, now: Date): Promise<AdminMagazineEdition> {
    return this.toAdmin(await this.find(id), now);
  }

  private async toAdmin(row: MagazineEditionRow, now: Date): Promise<AdminMagazineEdition> {
    const [readers, newsletter] = await Promise.all([
      this.newsletter.readers([row.id]),
      this.newsletter.state(row),
    ]);
    return toAdminEdition(row, this.image, readers.get(row.id) ?? 0, newsletter, now);
  }

  private async mediaErrors(references: { path: string; id: string | null | undefined }[]) {
    return unknownMediaErrors(this.media, references);
  }

  /** `POST /v1/admin/magazine/editions` : brouillon ; numéro suivant si `number` est absent (`null` : hors-série). */
  async create(input: EditionInput, actor: AuditActor, now: Date): Promise<AdminMagazineEdition> {
    const errors = await this.mediaErrors([{ path: 'coverId', id: input.coverId }]);
    if (errors.length > 0) throw validationException(errors);
    let number = input.number;
    if (number === undefined) {
      const last = await this.prisma.magazineEdition.aggregate({ _max: { number: true } });
      number = (last._max.number ?? 0) + 1;
    } else if (number !== null) {
      const taken = await this.prisma.magazineEdition.findUnique({ where: { number }, select: { id: true } });
      if (taken) throw numberTaken(number);
    }
    try {
      const id = await this.prisma.$transaction(async (tx) => {
        const created = await tx.magazineEdition.create({
          data: {
            number,
            title: input.title,
            titleEn: input.titleEn ?? null,
            subtitle: input.subtitle ?? null,
            subtitleEn: input.subtitleEn ?? null,
            themes: input.themes ?? null,
            publishAt: input.publishAt ? new Date(input.publishAt) : null,
            coverId: input.coverId ?? null,
            editorial: richText(input.editorial) ?? null,
            editorialEn: richText(input.editorialEn) ?? null,
            signature: input.signature ?? null,
            signatureEn: input.signatureEn ?? null,
            status: 'DRAFT',
          },
          select: { id: true, title: true, number: true },
        });
        await recordAudit(tx, actor, {
          action: 'magazine.create',
          entity: 'MagazineEdition',
          entityId: created.id,
          label: `A créé l’édition « ${created.title} » (${editionLabel(created.number)}) du magazine`,
        });
        return created.id;
      });
      return await this.detail(id, now);
    } catch (error) {
      if (isUniqueViolation(error) && number !== null) throw numberTaken(number);
      throw error;
    }
  }

  /**
   * `PATCH /v1/admin/magazine/editions/{id}` : champs fournis seulement. Une édition programmée dont la date est
   * retirée ou passée est publiée ; une date future la garde programmée.
   */
  async update(id: string, patch: EditionPatch, actor: AuditActor, now: Date): Promise<AdminMagazineEdition> {
    const current = await this.find(id);
    const errors = await this.mediaErrors([{ path: 'coverId', id: patch.coverId }]);
    if (errors.length > 0) throw validationException(errors);
    if (patch.number !== undefined && patch.number !== null && patch.number !== current.number) {
      const taken = await this.prisma.magazineEdition.findUnique({
        where: { number: patch.number },
        select: { id: true },
      });
      if (taken && taken.id !== id) throw numberTaken(patch.number);
    }

    const data: Prisma.MagazineEditionUpdateInput = {};
    if (patch.number !== undefined) data.number = patch.number;
    if (patch.title !== undefined) data.title = patch.title;
    if (patch.titleEn !== undefined) data.titleEn = patch.titleEn;
    if (patch.subtitle !== undefined) data.subtitle = patch.subtitle;
    if (patch.subtitleEn !== undefined) data.subtitleEn = patch.subtitleEn;
    if (patch.themes !== undefined) data.themes = patch.themes;
    if (patch.coverId !== undefined)
      data.cover = patch.coverId === null ? { disconnect: true } : { connect: { id: patch.coverId } };
    if (patch.editorial !== undefined) data.editorial = richText(patch.editorial) ?? null;
    if (patch.editorialEn !== undefined) data.editorialEn = richText(patch.editorialEn) ?? null;
    if (patch.signature !== undefined) data.signature = patch.signature;
    if (patch.signatureEn !== undefined) data.signatureEn = patch.signatureEn;
    if (patch.publishAt !== undefined) {
      const publishAt = patch.publishAt === null ? null : new Date(patch.publishAt);
      data.publishAt = publishAt;
      if (current.status === 'SCHEDULED' && (publishAt === null || publishAt.getTime() <= now.getTime())) {
        data.status = 'PUBLISHED';
        data.publishedAt = now;
        if (publishAt === null) data.publishAt = now;
      }
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        const updated = await tx.magazineEdition.update({
          where: { id },
          data,
          select: { id: true, title: true, number: true, status: true },
        });
        if (isOnline(current) || isOnline(updated)) await requestRevalidation(tx, [MAGAZINE_TAG]);
        await recordAudit(tx, actor, {
          action: 'magazine.update',
          entity: 'MagazineEdition',
          entityId: id,
          label: `A modifié l’édition « ${updated.title} » (${editionLabel(updated.number)}) du magazine`,
          before: { number: current.number, status: current.status },
          after: { number: updated.number, status: updated.status, fields: Object.keys(patch) },
        });
      });
    } catch (error) {
      if (isUniqueViolation(error) && patch.number) throw numberTaken(patch.number);
      throw error;
    }
    await this.newsletter.refresh(id);
    return this.detail(id, now);
  }

  /**
   * `DELETE /v1/admin/magazine/editions/{id}` : édition non publiée seulement (409) ; ses articles restent, sans
   * édition ; ses campagnes non parties sont supprimées (les campagnes parties restent, sans édition).
   */
  async remove(id: string, actor: AuditActor, now: Date): Promise<void> {
    const current = await this.find(id);
    if (effectiveStatus(current, now) === 'PUBLISHED')
      throw conflict('Repassez d’abord l’édition en brouillon pour la supprimer.');
    await this.prisma.$transaction(async (tx) => {
      await tx.campaign.deleteMany({
        where: { magazineEditionId: id, status: { in: ['BROUILLON', 'PROGRAMMEE'] } },
      });
      await tx.magazineArticle.updateMany({
        where: { editionId: id },
        data: { editionId: null, sortOrder: 0 },
      });
      await tx.magazineEdition.delete({ where: { id }, select: { id: true } });
      if (isOnline(current)) await requestRevalidation(tx, [MAGAZINE_TAG]);
      await recordAudit(tx, actor, {
        action: 'magazine.delete',
        entity: 'MagazineEdition',
        entityId: id,
        label: `A supprimé l’édition « ${current.title} » (${editionLabel(current.number)}) du magazine`,
        before: { number: current.number, status: current.status, articles: current.articles.length },
      });
    });
  }

  /**
   * `POST /v1/admin/magazine/editions/{id}/publish` : sans date (ou date passée), publication immédiate ; date
   * future : programmée (`SCHEDULED`), publiée à sa date.
   */
  async publish(
    id: string,
    publishAt: string | null,
    actor: AuditActor,
    now: Date,
  ): Promise<AdminMagazineEdition> {
    const current = await this.find(id);
    const date = publishAt === null ? now : new Date(publishAt);
    const status: MagazineEditionStatus = date.getTime() > now.getTime() ? 'SCHEDULED' : 'PUBLISHED';
    await this.prisma.$transaction(async (tx) => {
      await tx.magazineEdition.update({
        where: { id },
        data: {
          status,
          publishAt: date,
          publishedAt: status === 'PUBLISHED' ? (current.publishedAt ?? now) : null,
        },
        select: { id: true },
      });
      await requestRevalidation(tx, [MAGAZINE_TAG]);
      await recordAudit(tx, actor, {
        action: 'magazine.publish',
        entity: 'MagazineEdition',
        entityId: id,
        label:
          status === 'PUBLISHED'
            ? `A publié l’édition « ${current.title} » (${editionLabel(current.number)}) du magazine`
            : `A programmé la publication de l’édition « ${current.title} » (${editionLabel(current.number)}) du magazine`,
        before: { status: current.status },
        after: { status, publishAt: date.toISOString() },
      });
    });
    return this.detail(id, now);
  }

  /** `POST /v1/admin/magazine/editions/{id}/unpublish` : brouillon ; l'envoi programmé par la newsletter est annulé. */
  async unpublish(id: string, actor: AuditActor, now: Date): Promise<AdminMagazineEdition> {
    const current = await this.find(id);
    await this.prisma.$transaction(async (tx) => {
      await tx.magazineEdition.update({ where: { id }, data: { status: 'DRAFT' }, select: { id: true } });
      const cancelled = await this.newsletter.cancelScheduled(tx, id);
      if (isOnline(current)) await requestRevalidation(tx, [MAGAZINE_TAG]);
      await recordAudit(tx, actor, {
        action: 'magazine.unpublish',
        entity: 'MagazineEdition',
        entityId: id,
        label: `A repassé l’édition « ${current.title} » (${editionLabel(current.number)}) de « ${STATUS_LABELS[effectiveStatus(current, now)]} » à « Brouillon »`,
        before: { status: current.status },
        after: { status: 'DRAFT', cancelledCampaigns: cancelled },
      });
    });
    return this.detail(id, now);
  }

  /**
   * `PUT /v1/admin/magazine/editions/{id}/articles` : remplace la liste dans l'ordre donné ; un article ajouté quitte
   * son édition précédente, un article retiré reste disponible sans édition. Article inconnu → 422.
   */
  async setArticles(id: string, ids: string[], actor: AuditActor, now: Date): Promise<AdminMagazineEdition> {
    const current = await this.find(id);
    const found = await this.prisma.magazineArticle.findMany({
      where: { id: { in: ids } },
      select: { id: true, editionId: true, edition: { select: { status: true } } },
    });
    const known = new Map(found.map((article) => [article.id, article]));
    const errors: ProblemFieldError[] = ids
      .map((articleId, index) => ({ articleId, index }))
      .filter(({ articleId }) => !known.has(articleId))
      .map(({ index }) => ({
        path: `ids.${String(index)}`,
        code: 'unknown_article',
        message: ARTICLE_NOT_FOUND,
      }));
    if (errors.length > 0) throw validationException(errors);
    const previousEditions = new Set(
      found
        .map((article) => article.editionId)
        .filter((editionId): editionId is string => editionId !== null && editionId !== id),
    );
    const onlineElsewhere = found.some(
      (article) => article.editionId !== id && article.edition !== null && isOnline(article.edition),
    );

    await this.prisma.$transaction(async (tx) => {
      await tx.magazineArticle.updateMany({
        where: { editionId: id, id: { notIn: ids } },
        data: { editionId: null, sortOrder: 0 },
      });
      for (const [index, articleId] of ids.entries())
        await tx.magazineArticle.update({
          where: { id: articleId },
          data: { editionId: id, sortOrder: index },
          select: { id: true },
        });
      await tx.magazineEdition.update({ where: { id }, data: { updatedAt: now }, select: { id: true } });
      if (isOnline(current) || onlineElsewhere) await requestRevalidation(tx, [MAGAZINE_TAG]);
      await recordAudit(tx, actor, {
        action: 'magazine.articles',
        entity: 'MagazineEdition',
        entityId: id,
        label: `A modifié les articles de l’édition « ${current.title} » (${editionLabel(current.number)})`,
        before: { articles: current.articles.map((article) => article.id) },
        after: { articles: ids },
      });
    });
    await this.newsletter.refresh(id, ...previousEditions);
    return this.detail(id, now);
  }

  /** `GET /v1/admin/magazine/editions/{id}/preview-token` : édition sur la page Magazine du site (30 min). */
  async previewToken(id: string, now: Date): Promise<PreviewToken> {
    const edition = await this.prisma.magazineEdition.findUnique({ where: { id }, select: { id: true } });
    if (!edition) throw editionNotFound();
    const expiresAt = new Date(now.getTime() + PREVIEW_TOKEN_TTL_MS);
    const token = signPreviewToken(this.config.get('TOKEN_SIGNING_SECRET'), {
      kind: 'magazine',
      id: edition.id,
      expiresAt,
    });
    return {
      token,
      url: previewUrl(this.config.get('WEB_URL'), '/magazine', token),
      expiresAt: expiresAt.toISOString(),
    };
  }

  // ─────────────────────────── Articles ───────────────────────────

  /** `GET /v1/admin/magazine/articles` : les plus récemment modifiés en premier. */
  async listArticles(query: ListArticlesQuery): Promise<AdminMagazineArticle[]> {
    const where: Prisma.MagazineArticleWhereInput =
      query.edition === undefined ? {} : { editionId: query.edition === 'none' ? null : query.edition };
    const rows = await this.prisma.magazineArticle.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      select: MAGAZINE_ARTICLE_SELECT,
    });
    const q = query.q ? searchKey(query.q) : '';
    return rows
      .filter((row) => q === '' || searchKey(row.title, row.titleEn, row.theme, row.themeEn).includes(q))
      .map((row) => toAdminArticle(row, this.image));
  }

  private async articleErrors(input: {
    imageId?: string | null | undefined;
    editionId?: string | null | undefined;
  }): Promise<ProblemFieldError[]> {
    const errors = await this.mediaErrors([{ path: 'imageId', id: input.imageId }]);
    if (typeof input.editionId === 'string') {
      const edition = await this.prisma.magazineEdition.findUnique({
        where: { id: input.editionId },
        select: { id: true },
      });
      if (!edition) errors.push({ path: 'editionId', code: 'unknown_edition', message: EDITION_NOT_FOUND });
    }
    return errors;
  }

  /** Ordre de lecture d'un article ajouté à la fin d'une édition. */
  private async nextSortOrder(tx: Prisma.TransactionClient, editionId: string): Promise<number> {
    const last = await tx.magazineArticle.aggregate({ where: { editionId }, _max: { sortOrder: true } });
    return (last._max.sortOrder ?? -1) + 1;
  }

  private async editionOnline(
    client: Prisma.TransactionClient,
    editionId: string | null | undefined,
  ): Promise<boolean> {
    if (!editionId) return false;
    const edition = await client.magazineEdition.findUnique({
      where: { id: editionId },
      select: { status: true },
    });
    return edition !== null && isOnline(edition);
  }

  /** `POST /v1/admin/magazine/articles` : ajouté à la fin de son édition, le cas échéant. */
  async createArticle(input: ArticleInput, actor: AuditActor): Promise<AdminMagazineArticle> {
    const errors = await this.articleErrors(input);
    if (errors.length > 0) throw validationException(errors);
    const editionId = input.editionId ?? null;
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.magazineArticle.create({
        data: {
          editionId,
          sortOrder: editionId === null ? 0 : await this.nextSortOrder(tx, editionId),
          title: input.title,
          titleEn: input.titleEn ?? null,
          theme: input.theme,
          themeEn: input.themeEn ?? null,
          excerpt: input.excerpt ?? null,
          excerptEn: input.excerptEn ?? null,
          body: richText(input.body) ?? null,
          bodyEn: richText(input.bodyEn) ?? null,
          imageId: input.imageId ?? null,
        },
        select: MAGAZINE_ARTICLE_SELECT,
      });
      if (await this.editionOnline(tx, editionId)) await requestRevalidation(tx, [MAGAZINE_TAG]);
      await recordAudit(tx, actor, {
        action: 'magazine.article-create',
        entity: 'MagazineArticle',
        entityId: created.id,
        label: `A créé l’article « ${created.title} » du magazine`,
        after: { editionId },
      });
      return created;
    });
    await this.newsletter.refresh(editionId);
    return toAdminArticle(row, this.image);
  }

  /** `PATCH /v1/admin/magazine/articles/{id}` : un changement d'édition le place à la fin de la nouvelle. */
  async updateArticle(id: string, patch: ArticlePatch, actor: AuditActor): Promise<AdminMagazineArticle> {
    const current = await this.prisma.magazineArticle.findUnique({
      where: { id },
      select: { id: true, title: true, editionId: true },
    });
    if (!current) throw articleNotFound();
    const errors = await this.articleErrors(patch);
    if (errors.length > 0) throw validationException(errors);

    const row = await this.prisma.$transaction(async (tx) => {
      const data: Prisma.MagazineArticleUncheckedUpdateInput = {};
      if (patch.title !== undefined) data.title = patch.title;
      if (patch.titleEn !== undefined) data.titleEn = patch.titleEn;
      if (patch.theme !== undefined) data.theme = patch.theme;
      if (patch.themeEn !== undefined) data.themeEn = patch.themeEn;
      if (patch.excerpt !== undefined) data.excerpt = patch.excerpt;
      if (patch.excerptEn !== undefined) data.excerptEn = patch.excerptEn;
      if (patch.body !== undefined) data.body = richText(patch.body) ?? null;
      if (patch.bodyEn !== undefined) data.bodyEn = richText(patch.bodyEn) ?? null;
      if (patch.imageId !== undefined) data.imageId = patch.imageId;
      if (patch.editionId !== undefined && patch.editionId !== current.editionId) {
        data.editionId = patch.editionId;
        data.sortOrder = patch.editionId === null ? 0 : await this.nextSortOrder(tx, patch.editionId);
      }
      const updated = await tx.magazineArticle.update({
        where: { id },
        data,
        select: MAGAZINE_ARTICLE_SELECT,
      });
      const online =
        (await this.editionOnline(tx, current.editionId)) ||
        (await this.editionOnline(tx, updated.editionId));
      if (online) await requestRevalidation(tx, [MAGAZINE_TAG]);
      await recordAudit(tx, actor, {
        action: 'magazine.article-update',
        entity: 'MagazineArticle',
        entityId: id,
        label: `A modifié l’article « ${updated.title} » du magazine`,
        before: { editionId: current.editionId },
        after: { editionId: updated.editionId, fields: Object.keys(patch) },
      });
      return updated;
    });
    await this.newsletter.refresh(current.editionId, row.editionId);
    return toAdminArticle(row, this.image);
  }

  /** `DELETE /v1/admin/magazine/articles/{id}` */
  async removeArticle(id: string, actor: AuditActor): Promise<void> {
    const current = await this.prisma.magazineArticle.findUnique({
      where: { id },
      select: { id: true, title: true, editionId: true },
    });
    if (!current) throw articleNotFound();
    await this.prisma.$transaction(async (tx) => {
      await tx.magazineArticle.delete({ where: { id }, select: { id: true } });
      if (await this.editionOnline(tx, current.editionId)) await requestRevalidation(tx, [MAGAZINE_TAG]);
      await recordAudit(tx, actor, {
        action: 'magazine.article-delete',
        entity: 'MagazineArticle',
        entityId: id,
        label: `A supprimé l’article « ${current.title} » du magazine`,
        before: { editionId: current.editionId },
      });
    });
    await this.newsletter.refresh(current.editionId);
  }
}
