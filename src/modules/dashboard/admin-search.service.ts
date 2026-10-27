import { Inject, Injectable } from '@nestjs/common';
import { searchKey } from '../../common/text/search-key.js';
import type { PublishStatus } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import { REQUEST_STATUS_LABELS, REQUEST_TYPE_LABELS } from '../requests/request.mapper.js';
import { dashboardScope, scopedRequestsWhere } from './dashboard-scope.js';

export type AdminSearchKind = 'requests' | 'contacts' | 'services' | 'jobs' | 'pages';

export interface AdminSearchItem {
  id: string;
  title: string;
  subtitle: string | null;
  href: string;
}

export interface AdminSearchGroup {
  kind: AdminSearchKind;
  label: string;
  items: AdminSearchItem[];
}

const LABELS: Record<AdminSearchKind, string> = {
  requests: 'Demandes',
  contacts: 'Contacts',
  services: 'Services',
  jobs: 'Offres d’emploi',
  pages: 'Pages',
};

const LIMITS: Record<AdminSearchKind, number> = { requests: 6, contacts: 4, services: 4, jobs: 3, pages: 3 };

const STATUS_LABELS: Record<PublishStatus, string> = {
  DRAFT: 'Brouillon',
  PUBLISHED: 'Publié',
  ARCHIVED: 'Archivé',
};

/** Tous les mots cherchés figurent dans le texte (sans accents ni casse). */
function matchesAll(text: string, words: readonly string[]): boolean {
  const key = searchKey(text);
  return words.every((word) => key.includes(word));
}

/**
 * Palette de recherche du back-office (`GET /v1/admin/search`, `⌘K`) : demandes, contacts, services, offres
 * d'emploi et pages, sans tenir compte des accents ni de la casse. Seuls les groupes permis sont cherchés :
 * demandes selon `requests:read` (ou les siennes avec `requests:read-assigned`), contacts selon `contacts:read`,
 * contenus selon `content:read`. Demandes anonymisées et contacts effacés ne sont jamais renvoyés.
 */
@Injectable()
export class AdminSearchService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async search(q: string, auth: AuthContext): Promise<{ groups: AdminSearchGroup[] }> {
    const scope = dashboardScope(auth);
    const needle = searchKey(q);
    const words = needle.split(' ').filter((word) => word !== '');
    if (words.length === 0) return { groups: [] };
    const requestsWhere = scopedRequestsWhere(auth, scope);

    const [requests, contacts, services, jobs, pages] = await Promise.all([
      requestsWhere ? this.requests(requestsWhere, words) : [],
      scope.contacts ? this.contacts(words) : [],
      scope.content ? this.services(words) : [],
      scope.content ? this.jobs(words) : [],
      scope.content ? this.pages(words) : [],
    ]);
    const groups: AdminSearchGroup[] = (
      [
        ['requests', requests],
        ['contacts', contacts],
        ['services', services],
        ['jobs', jobs],
        ['pages', pages],
      ] as const
    )
      .filter(([, items]) => items.length > 0)
      .map(([kind, items]) => ({ kind, label: LABELS[kind], items }));
    return { groups };
  }

  private async requests(
    visible: NonNullable<ReturnType<typeof scopedRequestsWhere>>,
    words: readonly string[],
  ): Promise<AdminSearchItem[]> {
    const rows = await this.prisma.request.findMany({
      where: {
        AND: [
          visible,
          ...words.map((word) => ({
            OR: [{ searchText: { contains: word } }, { contact: { searchText: { contains: word } } }],
          })),
        ],
      },
      select: {
        id: true,
        reference: true,
        type: true,
        status: true,
        subject: true,
        contact: { select: { fullName: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: LIMITS.requests,
    });
    return rows.map((row) => ({
      id: row.id,
      title: `${row.reference} · ${row.contact.fullName}`,
      subtitle: `${row.subject ?? REQUEST_TYPE_LABELS[row.type]} · ${REQUEST_STATUS_LABELS[row.status]}`,
      href: `/admin/demandes?id=${encodeURIComponent(row.id)}`,
    }));
  }

  private async contacts(words: readonly string[]): Promise<AdminSearchItem[]> {
    const rows = await this.prisma.contact.findMany({
      where: { anonymizedAt: null, AND: words.map((word) => ({ searchText: { contains: word } })) },
      select: { id: true, fullName: true, email: true },
      orderBy: [{ lastActivityAt: 'desc' }, { id: 'desc' }],
      take: LIMITS.contacts,
    });
    return rows.map((row) => ({
      id: row.id,
      title: row.fullName,
      subtitle: row.email,
      href: `/admin/contacts?id=${encodeURIComponent(row.id)}`,
    }));
  }

  /** Quelques dizaines de services : filtrés en mémoire (nom, nom court, slug, rubrique), sans accents. */
  private async services(words: readonly string[]): Promise<AdminSearchItem[]> {
    const rows = await this.prisma.service.findMany({
      select: {
        id: true,
        name: true,
        shortName: true,
        slug: true,
        status: true,
        category: { select: { name: true } },
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return rows
      .filter((row) =>
        matchesAll(`${row.name} ${row.shortName ?? ''} ${row.slug} ${row.category.name}`, words),
      )
      .slice(0, LIMITS.services)
      .map((row) => ({
        id: row.id,
        title: row.name,
        subtitle: `${row.category.name} · ${STATUS_LABELS[row.status]}`,
        href: `/admin/services/${encodeURIComponent(row.id)}`,
      }));
  }

  private async jobs(words: readonly string[]): Promise<AdminSearchItem[]> {
    const rows = await this.prisma.jobOffer.findMany({
      select: { id: true, title: true, slug: true, city: true, contractType: true, status: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return rows
      .filter((row) => matchesAll(`${row.title} ${row.slug} ${row.city} ${row.contractType}`, words))
      .slice(0, LIMITS.jobs)
      .map((row) => ({
        id: row.id,
        title: row.title,
        subtitle: `${row.contractType} · ${row.city} · ${STATUS_LABELS[row.status]}`,
        href: `/admin/recrutement/offres/${encodeURIComponent(row.id)}`,
      }));
  }

  private async pages(words: readonly string[]): Promise<AdminSearchItem[]> {
    const rows = await this.prisma.page.findMany({
      select: { key: true, title: true, path: true },
      orderBy: { key: 'asc' },
    });
    return rows
      .filter((row) => matchesAll(`${row.title} ${row.key} ${row.path}`, words))
      .slice(0, LIMITS.pages)
      .map((row) => ({
        id: row.key,
        title: row.title,
        subtitle: row.path,
        href: `/admin/pages?page=${encodeURIComponent(row.key)}`,
      }));
  }
}
