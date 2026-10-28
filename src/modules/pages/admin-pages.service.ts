import { Inject, Injectable } from '@nestjs/common';
import { recordAudit, type AuditActor } from '../../common/audit/audit-log.js';
import { isPlainObject } from '../../common/i18n/translations.js';
import { asObjectArray, type JsonObject } from '../../common/json/json-read.js';
import {
  PREVIEW_TOKEN_TTL_MS,
  previewUrl,
  signPreviewToken,
  type PreviewToken,
} from '../../common/preview/preview-token.js';
import { notFoundException, type ProblemFieldError } from '../../common/problem/problem.js';
import { CACHE_TAGS, requestRevalidation } from '../../common/revalidation/revalidation.js';
import { validationException } from '../../common/validation/validation-exception.js';
import { frenchErrorMap, issuesToProblemErrors } from '../../common/validation/zod-issues.js';
import { AppConfigService } from '../../config/app-config.service.js';
import { Prisma, type PageGroup } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { unknownMediaErrors, type MediaReference } from '../media/media-refs.js';
import { MediaService } from '../media/media.service.js';
import { toUserRef, USER_REF_SELECT, type UserRef } from '../users/user-ref.js';
import {
  SECTION_TYPES,
  pageSectionSchema,
  type PageDraftInput,
  type PageTranslationInput,
  type SectionType,
} from './page-sections.schemas.js';
import {
  applyEnglishTexts,
  englishSectionErrors,
  englishSections,
  readEnglish,
  sectionTextHash,
  stampLegacyHashes,
  translateSeo,
  translationStatus,
  type TranslationStatus,
} from './page-translations.js';
import { PAGE_KEYS, isPageKey, toSeo, type Page, type PageKey } from './pages.mapper.js';

export const ADMIN_PAGE_NOT_FOUND = 'Cette page n’existe pas.';

/** Types de sections proposés si la page n'en précise aucun (`dynamic` n'est jamais ajouté à la main). */
const DEFAULT_ALLOWED: Record<'legales' | 'autres', readonly SectionType[]> = {
  legales: ['hero', 'richText'],
  autres: SECTION_TYPES.filter((type) => type !== 'dynamic'),
};

const adminPageSelect = {
  key: true,
  title: true,
  path: true,
  group: true,
  sections: true,
  seo: true,
  draftSections: true,
  draftSeo: true,
  translations: true,
  draftTranslations: true,
  allowedSections: true,
  publishedAt: true,
  updatedAt: true,
  updatedBy: { select: USER_REF_SELECT },
} satisfies Prisma.PageSelect;

type AdminPageRecord = Prisma.PageGetPayload<{ select: typeof adminPageSelect }>;

/** Schéma `AdminPageSummary` du contrat. */
export interface AdminPageSummary {
  key: PageKey;
  title: string;
  path: string;
  group: PageGroup;
  hasDraft: boolean;
  publishedAt: string | null;
  updatedAt: string;
  updatedBy: UserRef | null;
}

/** Schéma `PageTranslation` du contrat. */
export interface PageTranslation {
  title: string | null;
  sections: JsonObject[];
  seo: Page['seo'];
}

/** Schéma `AdminPage` du contrat. */
export interface AdminPage extends AdminPageSummary {
  sections: JsonObject[];
  allowedSectionTypes: SectionType[];
  seo: Page['seo'];
  translations: { en: PageTranslation | null };
  translationStatus: { en: TranslationStatus };
}

const SECTION_TYPE_SET: ReadonlySet<unknown> = new Set(SECTION_TYPES);

function allowedTypes(page: Pick<AdminPageRecord, 'allowedSections' | 'group'>): SectionType[] {
  const declared = page.allowedSections.filter((type): type is SectionType => SECTION_TYPE_SET.has(type));
  if (declared.length > 0) return declared;
  return [...DEFAULT_ALLOWED[page.group === 'legales' ? 'legales' : 'autres']];
}

function toSummary(page: AdminPageRecord): AdminPageSummary {
  return {
    key: page.key as PageKey,
    title: page.title,
    path: page.path,
    group: page.group,
    hasDraft: page.draftSections !== null,
    publishedAt: page.publishedAt?.toISOString() ?? null,
    updatedAt: page.updatedAt.toISOString(),
    updatedBy: page.updatedBy === null ? null : toUserRef(page.updatedBy),
  };
}

/** Sections exploitables d'une colonne JSON (identifiant et type connus). */
function validSections(value: unknown): JsonObject[] {
  return asObjectArray(value).filter(
    (section) => typeof section['id'] === 'string' && SECTION_TYPE_SET.has(section['type']),
  );
}

/** Rang d'une page dans la liste (ordre de l'énumération `PageKey` du contrat). */
const PAGE_RANK = new Map<string, number>(PAGE_KEYS.map((key, index) => [key, index]));

/** Images référencées par des visuels (`{ imageId }`), avec leur chemin dans le brouillon. */
function visualReferences(value: unknown, path: string, into: MediaReference[] = []): MediaReference[] {
  if (Array.isArray(value)) {
    value.forEach((item, index) => visualReferences(item, `${path}.${String(index)}`, into));
  } else if (isPlainObject(value)) {
    if (typeof value['imageId'] === 'string') into.push({ path: `${path}.image`, id: value['imageId'] });
    for (const [key, item] of Object.entries(value)) visualReferences(item, `${path}.${key}`, into);
  }
  return into;
}

/**
 * Pages et textes du back-office (`/v1/admin/pages*`) : brouillon enregistré automatiquement à côté de la version
 * publiée, publication (le brouillon devient la version en ligne), abandon du brouillon, jeton d'aperçu.
 */
@Injectable()
export class AdminPagesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MediaService) private readonly media: MediaService,
    @Inject(AppConfigService) private readonly config: AppConfigService,
  ) {}

  private async find(
    client: Prisma.TransactionClient | PrismaService,
    key: string,
  ): Promise<AdminPageRecord> {
    if (!isPageKey(key)) throw notFoundException(ADMIN_PAGE_NOT_FOUND);
    const page = await client.page.findUnique({ where: { key }, select: adminPageSelect });
    if (page === null) throw notFoundException(ADMIN_PAGE_NOT_FOUND);
    return page;
  }

  /**
   * Brouillon s'il existe, sinon version publiée ; toutes les sections, masquées comprises, visuels résolus. Version
   * anglaise (brouillon anglais s'il existe, sinon publiée) recomposée sur les sections françaises affichées, et état
   * de la traduction.
   */
  private async toAdminPage(page: AdminPageRecord): Promise<AdminPage> {
    const sections = validSections(page.draftSections ?? page.sections);
    const seo = page.draftSections === null ? page.seo : (page.draftSeo ?? page.seo);
    const english = readEnglish(page.draftTranslations ?? page.translations);
    const translated = english === null ? [] : englishSections(sections, english.sections);
    const [[resolved], [resolvedEnglish]] = await Promise.all([
      this.media.resolveVisuals(sections),
      this.media.resolveVisuals(translated),
    ]);
    return {
      ...toSummary(page),
      sections: resolved,
      allowedSectionTypes: allowedTypes(page),
      seo: toSeo(seo),
      translations: {
        en:
          english === null
            ? null
            : { title: english.title, sections: resolvedEnglish, seo: toSeo(translateSeo(seo, english.seo)) },
      },
      translationStatus: {
        en: translationStatus(sections, english, validSections(page.sections)),
      },
    };
  }

  /** `GET /v1/admin/pages` : pages éditables dans l'ordre du contrat. */
  async list(): Promise<AdminPageSummary[]> {
    const pages = await this.prisma.page.findMany({ select: adminPageSelect });
    return pages
      .filter((page) => isPageKey(page.key))
      .sort((a, b) => (PAGE_RANK.get(a.key) ?? 0) - (PAGE_RANK.get(b.key) ?? 0))
      .map(toSummary);
  }

  /** `GET /v1/admin/pages/{key}` */
  async detail(key: string): Promise<AdminPage> {
    return this.toAdminPage(await this.find(this.prisma, key));
  }

  /**
   * Règles du brouillon au-delà du schéma : identifiants uniques ; type de section autorisé pour la page (une
   * section existante d'un autre type, comme les sections automatiques `dynamic`, peut être gardée, déplacée ou
   * masquée, mais pas changée de source) ; images connues de la médiathèque.
   */
  private async checkDraft(page: AdminPageRecord, draft: PageDraftInput): Promise<void> {
    const errors: ProblemFieldError[] = [];
    const allowed = new Set<string>(allowedTypes(page));
    const existing = new Map<string, JsonObject>();
    for (const section of [...asObjectArray(page.sections), ...asObjectArray(page.draftSections)]) {
      if (typeof section['id'] === 'string')
        existing.set(`${section['id']}:${String(section['type'])}`, section);
    }
    const seen = new Set<string>();
    draft.sections.forEach((section, index) => {
      const path = `sections.${String(index)}`;
      if (seen.has(section.id))
        errors.push({
          path: `${path}.id`,
          code: 'duplicate',
          message: 'Cet identifiant est déjà utilisé dans la page.',
        });
      seen.add(section.id);
      const previous = existing.get(`${section.id}:${section.type}`);
      if (!allowed.has(section.type) && previous === undefined) {
        errors.push({
          path: `${path}.type`,
          code: 'section_not_allowed',
          message: 'Ce type de section n’est pas disponible sur cette page.',
        });
      }
      if (section.type === 'dynamic' && previous !== undefined && previous['source'] !== section.source) {
        errors.push({
          path: `${path}.source`,
          code: 'read_only',
          message:
            'Le contenu de cette section vient d’un autre écran : sa source ne peut pas être modifiée.',
        });
      }
    });
    errors.push(...(await unknownMediaErrors(this.media, visualReferences(draft.sections, 'sections'))));
    if (errors.length > 0) throw validationException(errors);
  }

  /**
   * Version anglaise du brouillon (`translations.en`) : `id` alignés sur les sections françaises de l'envoi, textes
   * anglais posés sur la section française puis validés comme elle (limites, HTML assaini). Empreinte des textes
   * français mémorisée par section : recalculée si les textes anglais de la section changent (ou si elle est
   * nouvelle), sinon gardée (une traduction inchangée reste périmée si le français a changé ; une traduction
   * antérieure au suivi prend l'empreinte du français publié).
   */
  private englishDraft(
    page: AdminPageRecord,
    draft: PageDraftInput,
    english: PageTranslationInput,
  ): { value: JsonObject; errors: ProblemFieldError[] } {
    const basePath = 'translations.en.sections';
    const errors = englishSectionErrors(draft.sections, english.sections, basePath);
    const french = new Map<string, JsonObject>(draft.sections.map((section) => [section.id, section]));
    const current = page.draftTranslations ?? page.translations;
    const previous = readEnglish(current);
    const previousById = new Map(previous?.sections.map((section) => [section['id'], section]));
    const published = new Map(validSections(page.sections).map((section) => [section['id'], section]));
    const sections: JsonObject[] = [];
    const sourceHashes: Record<string, string> = {};
    english.sections.forEach((input, index) => {
      const prefix = `${basePath}.${String(index)}.`;
      const source = french.get(input.id);
      if (source === undefined || errors.some((error) => error.path.startsWith(prefix))) return;
      const parsed = pageSectionSchema.safeParse(applyEnglishTexts(source, input), {
        error: frenchErrorMap,
        reportInput: true,
      });
      if (!parsed.success) {
        errors.push(
          ...issuesToProblemErrors(
            parsed.error.issues.map((issue) => ({
              ...issue,
              path: ['translations', 'en', 'sections', index, ...issue.path],
            })),
          ),
        );
        return;
      }
      const section = parsed.data as JsonObject;
      sections.push(section);
      const before = previousById.get(input.id);
      const unchanged =
        before !== undefined &&
        sectionTextHash(applyEnglishTexts(source, before)) === sectionTextHash(section);
      const publishedSource = published.get(input.id);
      const hash = unchanged
        ? (previous?.sourceHashes[input.id] ??
          (publishedSource === undefined ? null : sectionTextHash(publishedSource)) ??
          sectionTextHash(source))
        : sectionTextHash(source);
      if (hash !== null) sourceHashes[input.id] = hash;
    });
    const seo = english.seo ?? previous?.seo ?? {};
    return {
      value: {
        ...(isPlainObject(current) ? current : {}),
        en: {
          title: english.title ?? null,
          sections,
          seo: { title: seo['title'] ?? null, description: seo['description'] ?? null },
          sourceHashes,
        },
      },
      errors,
    };
  }

  /** `PUT /v1/admin/pages/{key}` : enregistre le brouillon (sauvegarde automatique), sans toucher au site. */
  async saveDraft(key: string, draft: PageDraftInput, actor: AuditActor, now: Date): Promise<AdminPage> {
    const page = await this.find(this.prisma, key);
    await this.checkDraft(page, draft);
    const english = draft.translations?.en;
    let draftTranslations: Prisma.InputJsonValue | undefined;
    if (english !== undefined) {
      const { value, errors } = this.englishDraft(page, draft, english);
      if (errors.length > 0) throw validationException(errors);
      draftTranslations = value as Prisma.InputJsonValue;
    }
    const seo = draft.seo ?? (page.draftSeo as Prisma.InputJsonValue | null) ?? page.seo;
    await this.prisma.page.update({
      where: { key },
      data: {
        draftSections: draft.sections,
        draftSeo: seo ?? {},
        ...(draftTranslations === undefined ? {} : { draftTranslations }),
        draftUpdatedAt: now,
        updatedById: actor.userId,
      },
      select: { key: true },
    });
    await this.media.refreshUsages({ kind: 'page', entityId: key });
    return this.detail(key);
  }

  /**
   * `POST /v1/admin/pages/{key}/publish` : le brouillon devient la version en ligne (sections, SEO, traduction du
   * brouillon le cas échéant). Sans brouillon, une page déjà publiée est renvoyée telle quelle.
   */
  async publish(key: string, actor: AuditActor, now: Date): Promise<AdminPage> {
    const page = await this.find(this.prisma, key);
    if (page.draftSections === null && page.publishedAt !== null) return this.toAdminPage(page);
    // Traductions antérieures au suivi : empreinte du français publié jusqu'ici, avant qu'il soit remplacé.
    const translations = page.draftTranslations ?? page.translations;
    const stamped = stampLegacyHashes(translations, validSections(page.sections)) ?? translations;
    await this.prisma.$transaction(async (tx) => {
      await tx.page.update({
        where: { key },
        data: {
          ...(page.draftSections === null ? {} : { sections: page.draftSections }),
          ...(page.draftSeo === null ? {} : { seo: page.draftSeo }),
          ...(stamped === null ? {} : { translations: stamped as Prisma.InputJsonValue }),
          draftSections: Prisma.DbNull,
          draftSeo: Prisma.DbNull,
          draftTranslations: Prisma.DbNull,
          draftUpdatedAt: null,
          publishedAt: now,
          publishedById: actor.userId,
          updatedById: actor.userId,
        },
        select: { key: true },
      });
      await requestRevalidation(tx, [CACHE_TAGS.page(key), CACHE_TAGS.sitemap]);
      await recordAudit(tx, actor, {
        action: 'page.publish',
        entity: 'Page',
        entityId: key,
        label: `A publié la page « ${page.title} »`,
      });
    });
    await this.media.refreshUsages({ kind: 'page', entityId: key });
    return this.detail(key);
  }

  /** `POST /v1/admin/pages/{key}/discard` : abandonne le brouillon, la version publiée est rétablie. */
  async discard(key: string, actor: AuditActor): Promise<AdminPage> {
    const page = await this.find(this.prisma, key);
    if (page.draftSections === null) return this.toAdminPage(page);
    await this.prisma.$transaction(async (tx) => {
      await tx.page.update({
        where: { key },
        data: {
          draftSections: Prisma.DbNull,
          draftSeo: Prisma.DbNull,
          draftTranslations: Prisma.DbNull,
          draftUpdatedAt: null,
        },
        select: { key: true },
      });
      await recordAudit(tx, actor, {
        action: 'page.discard',
        entity: 'Page',
        entityId: key,
        label: `A abandonné le brouillon de la page « ${page.title} »`,
      });
    });
    await this.media.refreshUsages({ kind: 'page', entityId: key });
    return this.detail(key);
  }

  /** `GET /v1/admin/pages/{key}/preview-token` : aperçu du brouillon sur le site (30 min). */
  async previewToken(key: string, now: Date): Promise<PreviewToken> {
    const page = await this.find(this.prisma, key);
    const expiresAt = new Date(now.getTime() + PREVIEW_TOKEN_TTL_MS);
    const token = signPreviewToken(this.config.get('TOKEN_SIGNING_SECRET'), {
      kind: 'page',
      id: page.key,
      expiresAt,
    });
    return {
      token,
      url: previewUrl(this.config.get('WEB_URL'), page.path, token),
      expiresAt: expiresAt.toISOString(),
    };
  }
}
