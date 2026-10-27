import { Inject, Injectable } from '@nestjs/common';
import type { Lang } from '../../common/i18n/lang.js';
import { isPlainObject, localizeFields, pickLocalized } from '../../common/i18n/translations.js';
import { AppConfigService } from '../../config/app-config.service.js';
import type { IllustrationScene } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { serviceHref } from '../catalog/catalog.mapper.js';
import { visibleServiceWhere } from '../catalog/catalog.selects.js';
import { visibleJobWhere } from '../jobs/job.mapper.js';
import { LATEST_EDITION_ORDER, visibleEditionWhere } from '../magazine/magazine.mapper.js';
import {
  DEFAULT_ILLUSTRATION,
  mediaImageSelect,
  toMediaImage,
  toVisual,
  type MediaRecord,
  type Visual,
} from '../media/visual.mapper.js';
import { localizePage, visibleSections } from '../pages/pages.mapper.js';
import { TRAINING_SELECT, toTraining } from '../trainings/training.mapper.js';
import { SEARCH_RESULT_TYPES, type SearchQuery, type SearchResultType } from './search.schemas.js';
import { excerptAround, matchText, plainText, queryTerms, type TextRange } from './text-match.js';

/** Schéma `SearchResult` du contrat. */
export interface SearchResult {
  type: SearchResultType;
  id: string;
  key: string | null;
  title: string;
  context: string | null;
  excerpt: string;
  titleHighlights: TextRange[];
  highlights: TextRange[];
  href: string;
  visual: Visual | null;
  icon: string | null;
}

export interface SearchGroup {
  type: SearchResultType;
  label: string;
  total: number;
  items: SearchResult[];
}

/** Schéma `SearchResults` du contrat. */
export interface SearchResults {
  query: string;
  lang: Lang;
  total: number;
  groups: SearchGroup[];
}

/** Contenu candidat : textes déjà dans la langue demandée. */
interface Candidate {
  type: SearchResultType;
  id: string;
  key: string | null;
  title: string;
  context: string | null;
  /** Texte de l'extrait (accroche, résumé, contenu), en texte brut. */
  text: string;
  href: string;
  visual: Visual | null;
  icon: string | null;
}

const GROUP_LABELS: Record<Lang, Record<SearchResultType, string>> = {
  fr: {
    service: 'Services',
    category: 'Rubriques',
    page: 'Pages',
    article: 'Magazine',
    job: 'Offres d’emploi',
    training: 'Formations',
  },
  en: {
    service: 'Services',
    category: 'Categories',
    page: 'Pages',
    article: 'Magazine',
    job: 'Jobs',
    training: 'Trainings',
  },
};

/** Pages techniques jamais renvoyées (erreurs, maintenance, confirmations, questionnaire). */
const TECHNICAL_PAGES: ReadonlySet<string> = new Set([
  '404',
  'erreur',
  'maintenance',
  'devis-confirmation',
  'newsletter-confirmation',
  'newsletter-desinscription',
  'questionnaire',
]);

/** Clés des sections dont la valeur n'est pas du texte affiché. */
const NON_TEXT_KEYS: ReadonlySet<string> = new Set([
  'id',
  'type',
  'href',
  'url',
  'icon',
  'iconColor',
  'illustration',
  'image',
  'imageId',
  'tone',
  'variant',
  'source',
  'layout',
  'enabled',
  'alt',
  'mapsUrl',
]);

/** Textes affichés d'une section de page (titres, paragraphes, éléments), en texte brut. */
function sectionText(value: unknown, into: string[] = []): string[] {
  if (typeof value === 'string') {
    const text = plainText(value);
    if (text !== '') into.push(text);
  } else if (Array.isArray(value)) {
    for (const item of value) sectionText(item, into);
  } else if (isPlainObject(value)) {
    for (const [key, item] of Object.entries(value)) if (!NON_TEXT_KEYS.has(key)) sectionText(item, into);
  }
  return into;
}

const MAX_TEXT_LENGTH = 6_000;

const joinText = (...parts: (string | null | undefined)[]): string =>
  parts
    .filter((part): part is string => typeof part === 'string' && part.trim() !== '')
    .map(plainText)
    .join(' ')
    .slice(0, MAX_TEXT_LENGTH);

/**
 * Recherche globale du site public (`GET /v1/search`) : services, rubriques, pages éditoriales, articles du
 * magazine, offres d'emploi et formations publiés, dans la langue demandée (repli français champ par champ).
 * Quelques centaines de contenus au plus : lus puis comparés en mémoire (sans accents ni casse, mots cherchés en
 * début de mot, pluriels simples), tous les mots devant figurer dans le titre, le contexte ou le texte. Pertinence :
 * titre d'abord, puis nombre d'occurrences.
 */
@Injectable()
export class SiteSearchService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AppConfigService) private readonly config: AppConfigService,
  ) {}

  async search(query: SearchQuery, now: Date): Promise<SearchResults> {
    const text = query.q.replace(/\s+/g, ' ').trim();
    const terms = queryTerms(text);
    const types = query.types ?? [...SEARCH_RESULT_TYPES];
    if (terms.length === 0) return { query: text, lang: query.lang, total: 0, groups: [] };

    const groups: SearchGroup[] = [];
    for (const type of types) {
      const candidates = await this.candidates(type, query.lang, now);
      const ranked = candidates
        .flatMap((candidate) => {
          const title = matchText(candidate.title, terms);
          const rest = matchText(`${candidate.context ?? ''} ${candidate.text}`, terms);
          if (!terms.every((term) => title.matched.has(term) || rest.matched.has(term))) return [];
          const score = title.matched.size * 100 + (title.first === 0 ? 50 : 0) + Math.min(rest.hits, 20);
          return [{ candidate, title, score }];
        })
        .sort((a, b) => b.score - a.score || a.candidate.title.localeCompare(b.candidate.title, query.lang));
      if (ranked.length === 0) continue;
      groups.push({
        type,
        label: GROUP_LABELS[query.lang][type],
        total: ranked.length,
        items: ranked.slice(0, query.limit).map(({ candidate, title }) => {
          const { excerpt, highlights } = excerptAround(candidate.text || candidate.title, terms);
          return {
            type: candidate.type,
            id: candidate.id,
            key: candidate.key,
            title: candidate.title,
            context: candidate.context,
            excerpt,
            titleHighlights: title.ranges,
            highlights,
            href: candidate.href,
            visual: candidate.visual,
            icon: candidate.icon,
          };
        }),
      });
    }
    return {
      query: text,
      lang: query.lang,
      total: groups.reduce((sum, group) => sum + group.total, 0),
      groups,
    };
  }

  private candidates(type: SearchResultType, lang: Lang, now: Date): Promise<Candidate[]> {
    switch (type) {
      case 'service':
        return this.services(lang, now);
      case 'category':
        return this.categories(lang, now);
      case 'page':
        return this.pages(lang);
      case 'article':
        return this.articles(lang, now);
      case 'job':
        return this.jobs(lang, now);
      case 'training':
        return this.trainings(lang);
    }
  }

  private visual(illustration: IllustrationScene | null, media: MediaRecord | null): Visual {
    return toVisual(illustration, media, this.config.get('MEDIA_PUBLIC_URL'));
  }

  private async services(lang: Lang, now: Date): Promise<Candidate[]> {
    const rows = await this.prisma.service.findMany({
      where: visibleServiceWhere(now),
      select: {
        id: true,
        slug: true,
        kind: true,
        name: true,
        tagline: true,
        summary: true,
        seoDescription: true,
        illustration: true,
        translations: true,
        coverImage: { select: mediaImageSelect },
        category: { select: { slug: true, name: true, translations: true } },
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return rows.map((row) => {
      const service = localizeFields(row, row.translations, lang, [
        'name',
        'tagline',
        'summary',
        'seoDescription',
      ]);
      const category = localizeFields(row.category, row.category.translations, lang, ['name']);
      return {
        type: 'service',
        id: row.id,
        key: row.slug,
        title: service.name,
        context: category.name,
        text: joinText(service.tagline, service.summary, service.seoDescription),
        href: serviceHref(row.category.slug, row.slug, row.kind),
        visual: this.visual(row.illustration, row.coverImage),
        icon: null,
      };
    });
  }

  private async categories(lang: Lang, now: Date): Promise<Candidate[]> {
    const rows = await this.prisma.category.findMany({
      where: { status: 'PUBLISHED' },
      select: {
        id: true,
        slug: true,
        name: true,
        tagline: true,
        description: true,
        icon: true,
        illustration: true,
        translations: true,
        image: { select: mediaImageSelect },
        _count: { select: { services: { where: visibleServiceWhere(now) } } },
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return rows.map((row) => {
      const category = localizeFields(row, row.translations, lang, ['name', 'tagline', 'description']);
      const count = row._count.services;
      const services = `${String(count)} service${count > 1 ? 's' : ''}`;
      return {
        type: 'category',
        id: row.id,
        key: row.slug,
        title: category.name,
        context: lang === 'en' ? `Category · ${services}` : `Rubrique · ${services}`,
        text: joinText(category.tagline, category.description),
        href: `/services/${row.slug}`,
        visual: this.visual(row.illustration, row.image),
        icon: row.icon,
      };
    });
  }

  private async pages(lang: Lang): Promise<Candidate[]> {
    const rows = await this.prisma.page.findMany({
      where: { publishedAt: { not: null } },
      select: {
        key: true,
        title: true,
        path: true,
        sections: true,
        seo: true,
        translations: true,
        publishedAt: true,
      },
    });
    return rows
      .filter((row) => !TECHNICAL_PAGES.has(row.key))
      .map((row) => {
        const page = localizePage(row, lang);
        const seo = isPlainObject(page.seo) ? page.seo : {};
        const description = typeof seo['description'] === 'string' ? seo['description'] : null;
        return {
          type: 'page' as const,
          id: row.key,
          key: row.key,
          title: page.title,
          context: null,
          text: joinText(sectionText(visibleSections(page.sections)).join(' '), description),
          href: row.path,
          visual: null,
          icon: null,
        };
      });
  }

  private async articles(lang: Lang, now: Date): Promise<Candidate[]> {
    const [latest, rows] = await Promise.all([
      this.prisma.magazineEdition.findFirst({
        where: visibleEditionWhere(now),
        orderBy: [...LATEST_EDITION_ORDER],
        select: { id: true },
      }),
      this.prisma.magazineArticle.findMany({
        where: {
          edition: { is: visibleEditionWhere(now) },
        },
        select: {
          id: true,
          editionId: true,
          title: true,
          titleEn: true,
          theme: true,
          themeEn: true,
          excerpt: true,
          excerptEn: true,
          body: true,
          bodyEn: true,
          image: { select: mediaImageSelect },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
    ]);
    const baseUrl = this.config.get('MEDIA_PUBLIC_URL');
    return rows.map((row) => {
      const image = toMediaImage(row.image, baseUrl);
      return {
        type: 'article' as const,
        id: row.id,
        key: null,
        title: pickLocalized(row.title, row.titleEn, lang),
        context: pickLocalized(row.theme, row.themeEn, lang),
        text: joinText(
          pickLocalized(row.excerpt, row.excerptEn, lang),
          pickLocalized(row.body, row.bodyEn, lang),
        ),
        // La page sans paramètre affiche la dernière édition : les autres sont désignées par `?edition=`.
        href:
          row.editionId === null || row.editionId === latest?.id
            ? `/magazine#article-${row.id}`
            : `/magazine?edition=${encodeURIComponent(row.editionId)}#article-${row.id}`,
        visual: { illustration: DEFAULT_ILLUSTRATION, image, alt: image?.alt ?? '' },
        icon: null,
      };
    });
  }

  private async jobs(lang: Lang, now: Date): Promise<Candidate[]> {
    const rows = await this.prisma.jobOffer.findMany({
      where: visibleJobWhere(now),
      select: {
        id: true,
        slug: true,
        title: true,
        city: true,
        contractType: true,
        summary: true,
        description: true,
        translations: true,
      },
      orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
    });
    return rows.map((row) => {
      const job = localizeFields(row, row.translations, lang, [
        'title',
        'city',
        'contractType',
        'summary',
        'description',
      ]);
      return {
        type: 'job' as const,
        id: row.id,
        key: row.slug,
        title: job.title,
        context: `${job.contractType} · ${job.city}`,
        text: joinText(job.summary, job.description),
        href: `/recrutement/${row.slug}`,
        visual: null,
        icon: null,
      };
    });
  }

  private async trainings(lang: Lang): Promise<Candidate[]> {
    const rows = await this.prisma.training.findMany({
      where: { status: 'PUBLISHED' },
      select: TRAINING_SELECT,
      orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }],
    });
    return rows.map((row) => {
      const training = toTraining(row, lang);
      return {
        type: 'training' as const,
        id: row.id,
        key: row.slug,
        title: training.title,
        context: training.categoryLabel,
        text: joinText(training.description, training.audienceLabel, training.duration, training.format),
        href: `/formation#${row.slug}`,
        visual: { illustration: 'formation', image: null, alt: '' },
        icon: training.icon,
      };
    });
  }
}
