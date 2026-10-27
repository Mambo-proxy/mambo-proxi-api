import { Inject, Injectable } from '@nestjs/common';
import { recordAudit, type AuditActor } from '../../common/audit/audit-log.js';
import { toCsv } from '../../common/csv/csv.js';
import { paginationMeta, pageWindow, type Page } from '../../common/pagination/pagination.js';
import { notFoundException, type ProblemException } from '../../common/problem/problem.js';
import { searchKey } from '../../common/text/search-key.js';
import { DAY_MS, doualaDate } from '../../common/time/agency-day.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import { AdminRequestsService, type CsvExport } from '../requests/admin-requests.service.js';
import {
  REQUEST_STATUS_LABELS,
  REQUEST_TYPE_LABELS,
  eventLabel,
  requestFields,
  requestPayload,
} from '../requests/request.mapper.js';
import {
  ADMIN_CONTACT_LIST_SELECT,
  ADMIN_CONTACT_SELECT,
  SUBSCRIBER_STATUS_LABELS,
  toAdminContact,
  toAdminContactListItem,
  type AdminContact,
  type AdminContactListItem,
  type AdminContactListRow,
  type AdminContactRow,
} from './admin-contact.mapper.js';
import type { ContactFilters, ListContactsQuery } from './contact.schemas.js';

/** Schéma `ContactStats` du contrat. */
export interface ContactStats {
  total: number;
  individuals: number;
  professionals: number;
  newsletterSubscribers: number;
  newThisMonth: number;
  byCountry: Record<string, number>;
  locations: { douala: number; surroundings: number; elsewhere: number };
}

export interface ContactsPage extends Page<AdminContactListItem> {
  stats: ContactStats;
}

export interface ContactActor {
  auth: AuthContext;
  ip: string | null;
}

/** Domaine des adresses factices des fiches effacées (`.invalid` : jamais délivrable). */
const ERASED_DOMAIN = 'mamboproxi.invalid';
export const ERASED_CONTACT_NAME = 'Contact effacé';
export const CONTACT_NOT_FOUND = 'Ce contact n’existe plus.';
const contactNotFound = (): ProblemException => notFoundException(CONTACT_NOT_FOUND);

/** Fiches affichées : ni effacées, ni la fiche commune des demandes anonymisées. */
const VISIBLE_CONTACTS: Prisma.ContactWhereInput = { anonymizedAt: null };

/** Contact situé à Douala : ville « Douala » ou « Quartier, Douala » (clé sans accents ni casse). */
const IN_DOUALA: Prisma.ContactWhereInput = {
  OR: [{ cityKey: 'douala' }, { cityKey: { endsWith: ', douala' } }],
};

const auditActor = (actor: ContactActor): AuditActor => ({ userId: actor.auth.user.id, ip: actor.ip });

function contactsWhere(filters: ContactFilters & { q?: string | undefined }): Prisma.ContactWhereInput {
  const parts: Prisma.ContactWhereInput[] = [VISIBLE_CONTACTS];
  if (filters.profile) parts.push({ profile: filters.profile });
  if (filters.country) parts.push({ country: filters.country });
  if (filters.district) {
    const district = searchKey(filters.district);
    if (district !== '') parts.push({ cityKey: { startsWith: district } });
  }
  if (filters.interest) parts.push({ interests: { some: { category: { slug: filters.interest } } } });
  if (filters.q) {
    const q = searchKey(filters.q);
    if (q !== '') parts.push({ searchText: { contains: q } });
  }
  return { AND: parts };
}

/**
 * Contacts et inscrits du back-office (tag « Admin — Contacts ») : liste filtrée avec indicateurs, export CSV, fiche,
 * export RGPD des données d'une personne et droit à l'effacement. Les fiches effacées disparaissent du back-office.
 */
@Injectable()
export class AdminContactsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AdminRequestsService) private readonly requests: AdminRequestsService,
  ) {}

  /** `GET /v1/admin/contacts` : page triée (`-createdAt` par défaut) et indicateurs sur tous les contacts. */
  async list(query: ListContactsQuery, now: Date): Promise<ContactsPage> {
    const { page, pageSize, sort, ...filters } = query;
    const where = contactsWhere(filters);
    const [rows, total, stats] = await Promise.all([
      this.prisma.contact.findMany({
        where,
        select: ADMIN_CONTACT_LIST_SELECT,
        orderBy: [{ [sort.field]: sort.direction }, { id: sort.direction }],
        ...pageWindow(page, pageSize),
      }) as Promise<AdminContactListRow[]>,
      this.prisma.contact.count({ where }),
      this.stats(now),
    ]);
    return {
      data: rows.map(toAdminContactListItem),
      meta: paginationMeta(page, pageSize, total),
      stats,
    };
  }

  /**
   * Indicateurs de l'écran (indépendants des filtres) : profils, abonnés confirmés, nouveaux contacts des 30 derniers
   * jours, pays, et répartition « Douala et environs » (Douala, reste du Cameroun, ailleurs).
   */
  async stats(now: Date): Promise<ContactStats> {
    const count = (where: Prisma.ContactWhereInput): Promise<number> =>
      this.prisma.contact.count({ where: { AND: [VISIBLE_CONTACTS, where] } });
    const [
      total,
      individuals,
      professionals,
      newsletterSubscribers,
      newThisMonth,
      douala,
      surroundings,
      countries,
    ] = await Promise.all([
      count({}),
      count({ profile: 'PARTICULIER' }),
      count({ profile: 'PROFESSIONNEL' }),
      count({ subscriber: { is: { status: 'CONFIRME' } } }),
      count({ createdAt: { gte: new Date(now.getTime() - 30 * DAY_MS) } }),
      count(IN_DOUALA),
      count({ country: 'CM', NOT: IN_DOUALA }),
      this.prisma.contact.groupBy({
        by: ['country'],
        where: { AND: [VISIBLE_CONTACTS, { country: { not: null } }] },
        _count: { _all: true },
      }),
    ]);
    const byCountry: Record<string, number> = {};
    for (const group of countries) if (group.country) byCountry[group.country] = group._count._all;
    return {
      total,
      individuals,
      professionals,
      newsletterSubscribers,
      newThisMonth,
      byCountry,
      locations: { douala, surroundings, elsewhere: Math.max(0, total - douala - surroundings) },
    };
  }

  /** `GET /v1/admin/contacts/export.csv` : contacts filtrés, du plus récent au plus ancien (colonnes du site). */
  async exportCsv(filters: ContactFilters, actor: ContactActor, now: Date): Promise<CsvExport> {
    const rows = (await this.prisma.contact.findMany({
      where: contactsWhere(filters),
      select: ADMIN_CONTACT_LIST_SELECT,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    })) as AdminContactListRow[];
    const body = toCsv(
      [
        'Nom',
        'Structure',
        'E-mail',
        'Téléphone',
        'Profil',
        'Ville',
        'Pays',
        'Intérêts',
        'Demandes',
        'Newsletter',
        'Créé le',
      ],
      rows.map((row) => {
        const item = toAdminContactListItem(row);
        return [
          item.fullName,
          item.organization,
          item.email,
          item.phone,
          item.profile === 'PROFESSIONNEL' ? 'Professionnel' : 'Particulier',
          item.city,
          item.country,
          item.interests.map((category) => category.name).join(', '),
          item.requestsCount,
          item.newsletterStatus ? SUBSCRIBER_STATUS_LABELS[item.newsletterStatus] : 'Non',
          doualaDate(row.createdAt),
        ];
      }),
    );
    await recordAudit(this.prisma, auditActor(actor), {
      action: 'contact.export',
      entity: 'Contact',
      entityId: null,
      label: `A exporté ${String(rows.length)} contact${rows.length > 1 ? 's' : ''} (CSV)`,
      after: { count: rows.length },
    });
    return { fileName: `contacts-${doualaDate(now)}.csv`, body };
  }

  private async findRow(id: string): Promise<AdminContactRow> {
    const row: AdminContactRow | null = await this.prisma.contact.findFirst({
      where: { id, ...VISIBLE_CONTACTS },
      select: ADMIN_CONTACT_SELECT,
    });
    if (!row) throw contactNotFound();
    return row;
  }

  /** `GET /v1/admin/contacts/{id}` : fiche, demandes (hors anonymisées), rendez-vous, abonnement. */
  async detail(id: string, now: Date): Promise<AdminContact> {
    return toAdminContact(await this.findRow(id), now);
  }

  /**
   * `GET /v1/admin/contacts/{id}/export` : toutes les données de la personne (droit d'accès et à la portabilité) :
   * fiche, demandes avec le contenu des formulaires et la preuve du consentement, historique, pièces jointes
   * (description), questionnaires, rendez-vous et abonnement. Les notes internes de l'équipe n'y figurent pas.
   * L'export est inscrit au journal d'activité.
   */
  async exportData(id: string, actor: ContactActor, now: Date): Promise<Record<string, unknown>> {
    const contact = await this.findRow(id);
    const [profile, requests, subscriber] = await Promise.all([
      this.prisma.contact.findUnique({
        where: { id },
        select: { firstName: true, lastName: true, district: true, language: true, lastActivityAt: true },
      }),
      this.prisma.request.findMany({
        where: { contactId: id, anonymizedAt: null },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: {
          reference: true,
          type: true,
          status: true,
          subject: true,
          organization: true,
          contactPreference: true,
          message: true,
          payload: true,
          language: true,
          consentAt: true,
          ip: true,
          userAgent: true,
          createdAt: true,
          completedAt: true,
          closedAt: true,
          service: { select: { name: true } },
          category: { select: { name: true } },
          history: {
            select: { kind: true, data: true, createdAt: true },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          },
          attachments: { select: { fileName: true, mimeType: true, size: true, createdAt: true } },
          survey: {
            select: {
              status: true,
              sentAt: true,
              completedAt: true,
              answers: true,
              rating: true,
              npsScore: true,
              publishConsent: true,
              displayName: true,
              city: true,
            },
          },
        },
      }),
      this.prisma.subscriber.findFirst({
        where: { OR: [{ contactId: id }, { email: contact.email }] },
        select: { language: true, consentAt: true, confirmedAt: true, unsubscribedAt: true },
      }),
    ]);
    await recordAudit(this.prisma, auditActor(actor), {
      action: 'contact.export-data',
      entity: 'Contact',
      entityId: id,
      label: 'A exporté les données personnelles d’un contact (RGPD)',
    });
    const iso = (value: Date | null): string | null => value?.toISOString() ?? null;
    const detail = toAdminContact(contact, now);
    return {
      exportedAt: now.toISOString(),
      contact: {
        ...detail,
        // Notes internes de l'équipe exclues, comme celles des demandes.
        appointments: detail.appointments.map(({ notes: _notes, ...appointment }) => appointment),
        firstName: profile?.firstName ?? null,
        lastName: profile?.lastName ?? null,
        district: profile?.district ?? null,
        language: profile?.language ?? null,
        lastActivityAt: iso(profile?.lastActivityAt ?? null),
      },
      requests: requests.map((request) => ({
        reference: request.reference,
        type: request.type,
        typeLabel: REQUEST_TYPE_LABELS[request.type],
        status: request.status,
        statusLabel: REQUEST_STATUS_LABELS[request.status],
        subject: request.subject,
        service: request.service?.name ?? null,
        category: request.category?.name ?? null,
        organization: request.organization,
        contactPreference: request.contactPreference,
        message: request.message,
        fields: requestFields(request.payload),
        values: requestPayload(request.payload),
        language: request.language,
        consent: { at: request.consentAt.toISOString(), ip: request.ip, userAgent: request.userAgent },
        createdAt: request.createdAt.toISOString(),
        completedAt: iso(request.completedAt),
        closedAt: iso(request.closedAt),
        history: request.history.map((event) => ({
          kind: event.kind,
          label: eventLabel(event.kind, event.data, new Map()),
          createdAt: event.createdAt.toISOString(),
        })),
        attachments: request.attachments.map((attachment) => ({
          fileName: attachment.fileName,
          mimeType: attachment.mimeType,
          size: attachment.size,
          createdAt: attachment.createdAt.toISOString(),
        })),
        survey: request.survey
          ? {
              status: request.survey.status,
              sentAt: iso(request.survey.sentAt),
              completedAt: iso(request.survey.completedAt),
              answers: request.survey.answers,
              rating: request.survey.rating,
              npsScore: request.survey.npsScore,
              publishConsent: request.survey.publishConsent,
              displayName: request.survey.displayName,
              city: request.survey.city,
            }
          : null,
      })),
      newsletter: subscriber
        ? {
            language: subscriber.language,
            consentAt: subscriber.consentAt.toISOString(),
            confirmedAt: iso(subscriber.confirmedAt),
            unsubscribedAt: iso(subscriber.unsubscribedAt),
          }
        : null,
    };
  }

  /**
   * `DELETE /v1/admin/contacts/{id}` : droit à l'effacement. La fiche est vidée (nom « Contact effacé », adresse
   * factice, coordonnées, structure et centres d'intérêt retirés), ses demandes sont anonymisées, le message et les
   * notes de ses rendez-vous effacés, son abonnement anonymisé et désinscrit (les statistiques des campagnes
   * restent justes). La fiche reste pour l'intégrité des statistiques, sans plus apparaître dans le back-office.
   */
  async erase(id: string, actor: ContactActor, now: Date): Promise<void> {
    const contact = await this.prisma.contact.findFirst({
      where: { id, ...VISIBLE_CONTACTS },
      select: { id: true, email: true },
    });
    if (!contact) throw contactNotFound();
    const storageKeys = await this.prisma.$transaction(async (tx) => {
      const { keys, anonymizedRequests } = await this.eraseInTx(tx, contact, actor.auth.user.id, now);
      await recordAudit(tx, auditActor(actor), {
        action: 'contact.erase',
        entity: 'Contact',
        entityId: id,
        label: 'A effacé les données d’un contact (droit à l’effacement)',
        after: { anonymizedRequests },
      });
      return keys;
    });
    // Fichiers (CV, pièces jointes) supprimés du stockage une fois l'effacement enregistré.
    await this.requests.purgeFiles(storageKeys);
  }

  /**
   * Effacement automatique d'un contact inactif depuis la durée de conservation (nettoyage RGPD quotidien) : même
   * effacement que le droit à l'effacement, sans auteur. Renvoie `false` si le contact est déjà effacé.
   */
  async eraseInactive(id: string, now: Date): Promise<boolean> {
    const contact = await this.prisma.contact.findFirst({
      where: { id, ...VISIBLE_CONTACTS },
      select: { id: true, email: true },
    });
    if (!contact) return false;
    const { keys } = await this.prisma.$transaction((tx) => this.eraseInTx(tx, contact, null, now));
    await this.requests.purgeFiles(keys);
    return true;
  }

  /** Effacement d'un contact dans une transaction : renvoie les fichiers à supprimer et le nombre de demandes. */
  private async eraseInTx(
    tx: Prisma.TransactionClient,
    contact: { id: string; email: string },
    actorId: string | null,
    now: Date,
  ): Promise<{ keys: string[]; anonymizedRequests: number }> {
    const id = contact.id;
    const requests = await tx.request.findMany({
      where: { contactId: id, anonymizedAt: null },
      select: { id: true },
    });
    const keys = await this.requests.anonymizeInTx(
      tx,
      requests.map((request) => request.id),
      actorId,
      now,
    );
    await tx.appointment.updateMany({ where: { contactId: id }, data: { message: null, notes: null } });
    await tx.contactInterest.deleteMany({ where: { contactId: id } });
    const subscribers = await tx.subscriber.findMany({
      where: { OR: [{ contactId: id }, { email: contact.email }] },
      select: { id: true, unsubscribedAt: true },
    });
    for (const subscriber of subscribers)
      await tx.subscriber.update({
        where: { id: subscriber.id },
        data: {
          email: `efface-${subscriber.id}@${ERASED_DOMAIN}`,
          name: null,
          phone: null,
          country: null,
          tags: [],
          status: 'DESINSCRIT',
          unsubscribedAt: subscriber.unsubscribedAt ?? now,
          confirmTokenHash: null,
          confirmTokenExpires: null,
        },
        select: { id: true },
      });
    await tx.contact.update({
      where: { id },
      data: {
        email: `efface-${id}@${ERASED_DOMAIN}`,
        fullName: ERASED_CONTACT_NAME,
        firstName: null,
        lastName: null,
        phone: null,
        country: null,
        city: null,
        district: null,
        organization: null,
        activity: null,
        preferredChannel: null,
        searchText: '',
        cityKey: null,
        anonymizedAt: now,
      },
      select: { id: true },
    });
    return { keys, anonymizedRequests: requests.length };
  }
}
