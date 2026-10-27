import { isPlainObject } from '../../common/i18n/translations.js';
import { CACHE_TAGS } from '../../common/revalidation/revalidation.js';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { SETTING_KEYS } from '../settings/settings.constants.js';
import { collectImageIds } from './visual.mapper.js';

/**
 * Usages des médias (table `media_usages`, `Media.usages` du contrat) : où chaque image de la médiathèque est
 * affichée. Calculés à partir des contenus eux-mêmes (colonnes `…ImageId` et visuels enregistrés dans les JSON :
 * sections de pages, brouillons compris, visuels des rubriques, paramètres), avec les sortes du seed :
 *
 * - `service.cover`, `service.gallery` (identifiant du service), `offer.image` (identifiant de l'offre ; emplacement
 *   `service:<id>` ou `category:<id>` : propriétaire de l'offre) ;
 * - `category.image`, `category.visual` (emplacement : clé du visuel) ;
 * - `page.section` (clé de la page, emplacement : identifiant de la section ; publiée, brouillon, anglais) ;
 * - `settings.<groupe>` (`settings.seo` : image de partage, `settings.navigation` : promotion du méga-menu…).
 *
 * Les partenaires, événements et éditions ou articles du magazine sont lus par leurs clés étrangères (relations de
 * `Media`, `liveForeignUsages`) : la table n'en garde que ce qu'y a mis le seed.
 *
 * La table est réécrite pour un propriétaire après chaque enregistrement (`MediaService.refreshUsages`) et
 * reconstruite entièrement au démarrage du worker de la médiathèque (`rebuildMediaUsages`). La suppression d'un
 * média et la revalidation après sa modification recalculent les usages sur les contenus (`collectAllUsages`),
 * sans dépendre de la table.
 */

export type UsageOwnerKind = 'service' | 'category' | 'page' | 'setting';

export interface UsageOwner {
  kind: UsageOwnerKind;
  /** Identifiant du service ou de la rubrique, clé de la page ou du paramètre. */
  entityId: string;
}

export interface MediaUsageEntry {
  mediaId: string;
  kind: string;
  entityId: string;
  slot: string;
  label: string;
  href: string | null;
  /** Étiquettes du site à revalider quand l'image change (vide pour un contenu non publié). */
  tags: string[];
}

type ReadClient = Pick<Prisma.TransactionClient, 'service' | 'category' | 'page' | 'setting'>;
/** Écriture hors transaction interactive : suppression et insertion envoyées ensemble (`$transaction([…])`). */
type WriteClient = Pick<PrismaClient, 'media' | 'mediaUsage' | '$transaction'>;

const SERVICE_SELECT = {
  id: true,
  name: true,
  shortName: true,
  slug: true,
  status: true,
  coverImageId: true,
  category: { select: { slug: true } },
  gallery: { select: { mediaId: true, sortOrder: true } },
  offers: { select: { id: true, title: true, imageId: true } },
} satisfies Prisma.ServiceSelect;

const CATEGORY_SELECT = {
  id: true,
  name: true,
  slug: true,
  status: true,
  imageId: true,
  visuals: true,
  homeCard: true,
  highlight: true,
  translations: true,
  offerSections: {
    select: { id: true, title: true, offers: { select: { id: true, title: true, imageId: true } } },
  },
} satisfies Prisma.CategorySelect;

const PAGE_SELECT = {
  key: true,
  title: true,
  sections: true,
  draftSections: true,
  translations: true,
  draftTranslations: true,
} satisfies Prisma.PageSelect;

const SETTING_SELECT = { key: true, value: true, translations: true } satisfies Prisma.SettingSelect;

type ServiceRow = Prisma.ServiceGetPayload<{ select: typeof SERVICE_SELECT }>;
type CategoryRow = Prisma.CategoryGetPayload<{ select: typeof CATEGORY_SELECT }>;
type PageRow = Prisma.PageGetPayload<{ select: typeof PAGE_SELECT }>;
type SettingRow = Prisma.SettingGetPayload<{ select: typeof SETTING_SELECT }>;

/** Sortes écrites par l'API (reconstruction de la table). */
const OWNED_KINDS = [
  'service.cover',
  'service.gallery',
  'offer.image',
  'category.image',
  'category.visual',
  'page.section',
];

const CATEGORY_VISUAL_LABELS: Readonly<Record<string, string>> = {
  hero: 'en-tête',
  thumbnail: 'vignette',
  testimonial: 'témoignage',
  homeCard: 'carte de l’accueil',
  homeCardMobile: 'carte de l’accueil, mobile',
  highlight: 'mise en avant',
  en: 'version anglaise',
};

const SECTION_LABELS: Readonly<Record<string, string>> = {
  hero: 'en-tête',
  marquee: 'bandeau',
  steps: 'étapes',
  featureList: 'atouts',
  cardGrid: 'cartes',
  textMedia: 'texte et image',
  quote: 'citation',
  statsGrid: 'chiffres',
  team: 'équipe',
  faq: 'questions',
  richText: 'texte',
  ctaBand: 'appel à l’action',
  dynamic: 'bloc automatique',
};

/** Titre sans le marquage d'accent `==…==` des titres éditoriaux. */
function plain(text: string): string {
  return text.replace(/==/g, '').trim();
}

function serviceUsages(row: ServiceRow): MediaUsageEntry[] {
  const href = `/admin/services/${row.id}`;
  const name = `Service « ${row.shortName ?? row.name} »`;
  const tags =
    row.status === 'PUBLISHED'
      ? [
          CACHE_TAGS.services,
          CACHE_TAGS.service(row.slug),
          CACHE_TAGS.category(row.category.slug),
          CACHE_TAGS.page('accueil'),
        ]
      : [];
  const entries: MediaUsageEntry[] = [];
  const base = { entityId: row.id, href, tags };
  if (row.coverImageId !== null)
    entries.push({
      ...base,
      mediaId: row.coverImageId,
      kind: 'service.cover',
      slot: '',
      label: `${name} (photo principale)`,
    });
  [...row.gallery]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .forEach((item, index) =>
      entries.push({
        ...base,
        mediaId: item.mediaId,
        kind: 'service.gallery',
        slot: String(index),
        label: `${name} (galerie)`,
      }),
    );
  for (const offer of row.offers)
    if (offer.imageId !== null)
      entries.push({
        mediaId: offer.imageId,
        kind: 'offer.image',
        entityId: offer.id,
        slot: `service:${row.id}`,
        label: `${name} (formule « ${plain(offer.title)} »)`,
        href,
        tags,
      });
  return entries;
}

function categoryUsages(row: CategoryRow): MediaUsageEntry[] {
  const href = `/admin/services?rubrique=${encodeURIComponent(row.slug)}`;
  const name = `Rubrique « ${row.name} »`;
  const tags =
    row.status === 'PUBLISHED'
      ? [
          CACHE_TAGS.categories,
          CACHE_TAGS.category(row.slug),
          CACHE_TAGS.navigation,
          CACHE_TAGS.page('accueil'),
        ]
      : [];
  const entries: MediaUsageEntry[] = [];
  const base = { entityId: row.id, href, tags };
  if (row.imageId !== null)
    entries.push({
      ...base,
      mediaId: row.imageId,
      kind: 'category.image',
      slot: '',
      label: `${name} (visuel principal)`,
    });
  const visualSlots: [string, unknown][] = [
    ...(isPlainObject(row.visuals) ? Object.entries(row.visuals) : []),
    ['homeCard', row.homeCard],
    ['highlight', row.highlight],
    ['en', row.translations],
  ];
  for (const [slot, value] of visualSlots)
    for (const mediaId of collectImageIds(value))
      entries.push({
        ...base,
        mediaId,
        kind: 'category.visual',
        slot,
        label: `${name} (${CATEGORY_VISUAL_LABELS[slot] ?? slot})`,
      });
  for (const section of row.offerSections)
    for (const offer of section.offers)
      if (offer.imageId !== null)
        entries.push({
          mediaId: offer.imageId,
          kind: 'offer.image',
          entityId: offer.id,
          slot: `category:${row.id}`,
          label: `${name} (offre « ${plain(offer.title)} », carrousel « ${plain(section.title)} »)`,
          href,
          tags,
        });
  return entries;
}

interface SectionImages {
  position: number;
  type: string | null;
  ids: Set<string>;
}

/** Sections d'une page (publiées ou brouillon, d'une langue) : images par identifiant de section. */
function sectionImages(value: unknown, into: Map<string, SectionImages>): void {
  if (!Array.isArray(value)) return;
  value.forEach((section: unknown, index) => {
    const id = isPlainObject(section) && typeof section['id'] === 'string' ? section['id'] : String(index);
    const ids = collectImageIds(section);
    if (ids.size === 0) return;
    const entry = into.get(id) ?? {
      position: index + 1,
      type: isPlainObject(section) && typeof section['type'] === 'string' ? section['type'] : null,
      ids: new Set<string>(),
    };
    for (const mediaId of ids) entry.ids.add(mediaId);
    into.set(id, entry);
  });
}

function englishSections(translations: Prisma.JsonValue): unknown {
  if (!isPlainObject(translations)) return undefined;
  const en = translations['en'];
  return isPlainObject(en) ? en['sections'] : undefined;
}

function pageUsages(row: PageRow): MediaUsageEntry[] {
  const bySection = new Map<string, SectionImages>();
  sectionImages(row.sections, bySection);
  sectionImages(row.draftSections, bySection);
  sectionImages(englishSections(row.translations), bySection);
  sectionImages(englishSections(row.draftTranslations), bySection);
  const entries: MediaUsageEntry[] = [];
  for (const [sectionId, section] of bySection) {
    const type = section.type === null ? '' : ` : ${SECTION_LABELS[section.type] ?? section.type}`;
    for (const mediaId of section.ids)
      entries.push({
        mediaId,
        kind: 'page.section',
        entityId: row.key,
        slot: sectionId,
        label: `Page « ${row.title} » (section ${String(section.position)}${type})`,
        href: '/admin/pages',
        tags: [CACHE_TAGS.page(row.key)],
      });
  }
  return entries;
}

function settingUsages(row: SettingRow): MediaUsageEntry[] {
  const kind = `settings.${row.key}`;
  const navigation = row.key === SETTING_KEYS.navigation;
  const tags = navigation ? [CACHE_TAGS.settings, CACHE_TAGS.navigation] : [CACHE_TAGS.settings];
  const base = { kind, entityId: row.key, tags };
  const entries: MediaUsageEntry[] = [];
  if (row.key === SETTING_KEYS.seo && isPlainObject(row.value) && typeof row.value['ogImageId'] === 'string')
    entries.push({
      ...base,
      mediaId: row.value['ogImageId'],
      slot: 'ogImage',
      label: 'Paramètres — image de partage',
      href: '/admin/parametres',
    });
  const slots: [string, unknown][] = [
    ...(isPlainObject(row.value) ? Object.entries(row.value) : []),
    ['en', row.translations],
  ];
  for (const [slot, value] of slots)
    for (const mediaId of collectImageIds(value))
      entries.push({
        ...base,
        mediaId,
        slot,
        label: navigation
          ? `Méga-menu (${slot === 'megaMenuPromo' ? 'promotion' : slot})`
          : `Paramètres (${row.key})`,
        href: navigation ? '/admin/pages' : '/admin/parametres',
      });
  return entries;
}

/** Une ligne par (média, sorte, entité, emplacement) : contrainte d'unicité de la table. */
function dedupe(entries: MediaUsageEntry[]): MediaUsageEntry[] {
  const seen = new Map<string, MediaUsageEntry>();
  for (const entry of entries) {
    const key = `${entry.mediaId}|${entry.kind}|${entry.entityId}|${entry.slot}`;
    if (!seen.has(key)) seen.set(key, entry);
  }
  return [...seen.values()];
}

/** Lignes de la table appartenant à un propriétaire (réécrites ensemble). */
function ownerWhere(owner: UsageOwner): Prisma.MediaUsageWhereInput {
  switch (owner.kind) {
    case 'service':
      return {
        OR: [
          { kind: { in: ['service.cover', 'service.gallery'] }, entityId: owner.entityId },
          { kind: 'offer.image', slot: `service:${owner.entityId}` },
        ],
      };
    case 'category':
      return {
        OR: [
          { kind: { in: ['category.image', 'category.visual'] }, entityId: owner.entityId },
          { kind: 'offer.image', slot: `category:${owner.entityId}` },
        ],
      };
    case 'page':
      return { kind: 'page.section', entityId: owner.entityId };
    case 'setting':
      return { kind: `settings.${owner.entityId}`, entityId: owner.entityId };
  }
}

/** Usages d'un propriétaire, relus sur le contenu (aucun s'il a été supprimé). */
export async function collectOwnerUsages(client: ReadClient, owner: UsageOwner): Promise<MediaUsageEntry[]> {
  switch (owner.kind) {
    case 'service': {
      const row = await client.service.findUnique({ where: { id: owner.entityId }, select: SERVICE_SELECT });
      return row === null ? [] : dedupe(serviceUsages(row));
    }
    case 'category': {
      const row = await client.category.findUnique({
        where: { id: owner.entityId },
        select: CATEGORY_SELECT,
      });
      return row === null ? [] : dedupe(categoryUsages(row));
    }
    case 'page': {
      const row = await client.page.findUnique({ where: { key: owner.entityId }, select: PAGE_SELECT });
      return row === null ? [] : dedupe(pageUsages(row));
    }
    case 'setting': {
      const row = await client.setting.findUnique({ where: { key: owner.entityId }, select: SETTING_SELECT });
      return row === null ? [] : dedupe(settingUsages(row));
    }
  }
}

/** Tous les usages, relus sur les contenus (quelques dizaines de lignes : services, rubriques, pages, paramètres). */
export async function collectAllUsages(client: ReadClient): Promise<MediaUsageEntry[]> {
  const [services, categories, pages, settings] = await Promise.all([
    client.service.findMany({ select: SERVICE_SELECT }),
    client.category.findMany({ select: CATEGORY_SELECT }),
    client.page.findMany({ select: PAGE_SELECT }),
    client.setting.findMany({ select: SETTING_SELECT }),
  ]);
  return dedupe([
    ...services.flatMap(serviceUsages),
    ...categories.flatMap(categoryUsages),
    ...pages.flatMap(pageUsages),
    ...settings.flatMap(settingUsages),
  ]);
}

/** Relations directes d'un média vers les contenus qui ne passent pas par la table (partenaires, agenda, magazine). */
export const FOREIGN_USAGES_SELECT = {
  partners: { select: { id: true, name: true } },
  events: { select: { id: true, title: true, status: true } },
  magazineCovers: { select: { id: true, title: true } },
  magazineArticles: { select: { id: true, title: true, editionId: true } },
} satisfies Prisma.MediaSelect;

export type ForeignUsagesRow = Prisma.MediaGetPayload<{ select: typeof FOREIGN_USAGES_SELECT }>;

export function liveForeignUsages(mediaId: string, row: ForeignUsagesRow): MediaUsageEntry[] {
  return [
    ...row.partners.map((partner) => ({
      mediaId,
      kind: 'partner.logo',
      entityId: partner.id,
      slot: '',
      label: `Partenaire « ${partner.name} » (logo)`,
      href: '/admin/partenaires',
      tags: ['partners'],
    })),
    ...row.events.map((event) => ({
      mediaId,
      kind: 'event.image',
      entityId: event.id,
      slot: '',
      label: `Événement « ${event.title} »`,
      href: '/admin/agenda',
      tags: event.status === 'PUBLISHED' ? ['events'] : [],
    })),
    ...row.magazineCovers.map((edition) => ({
      mediaId,
      kind: 'magazine.cover',
      entityId: edition.id,
      slot: '',
      label: `Magazine « ${edition.title} » (couverture)`,
      href: `/admin/magazine/${edition.id}`,
      tags: [],
    })),
    ...row.magazineArticles.map((article) => ({
      mediaId,
      kind: 'magazine.article',
      entityId: article.id,
      slot: '',
      label: `Article « ${article.title} »`,
      href: article.editionId === null ? '/admin/magazine' : `/admin/magazine/${article.editionId}`,
      tags: [],
    })),
  ];
}

function toRows(entries: readonly MediaUsageEntry[]): Prisma.MediaUsageCreateManyInput[] {
  return entries.map(({ mediaId, kind, entityId, slot, label, href }) => ({
    mediaId,
    kind,
    entityId,
    slot,
    label: label.slice(0, 200),
    href,
  }));
}

async function knownMedia(client: WriteClient, entries: readonly MediaUsageEntry[]): Promise<Set<string>> {
  const ids = [...new Set(entries.map((entry) => entry.mediaId))];
  if (ids.length === 0) return new Set();
  const found = await client.media.findMany({ where: { id: { in: ids } }, select: { id: true } });
  return new Set(found.map((item) => item.id));
}

/**
 * Réécrit les usages d'un propriétaire. Les identifiants inconnus de la médiathèque sont ignorés (les contenus
 * sont validés à l'enregistrement ; une image du seed absente ne doit pas faire échouer l'écriture).
 */
export async function writeOwnerUsages(
  client: WriteClient,
  owner: UsageOwner,
  entries: readonly MediaUsageEntry[],
): Promise<void> {
  const known = await knownMedia(client, entries);
  const rows = toRows(entries.filter((entry) => known.has(entry.mediaId)));
  await client.$transaction([
    client.mediaUsage.deleteMany({ where: ownerWhere(owner) }),
    ...(rows.length > 0 ? [client.mediaUsage.createMany({ data: rows, skipDuplicates: true })] : []),
  ]);
}

/** Reconstruit la table `media_usages` pour les sortes tenues par l'API ; renvoie le nombre de lignes. */
export async function rebuildMediaUsages(client: ReadClient & WriteClient): Promise<number> {
  const entries = await collectAllUsages(client);
  const known = await knownMedia(client, entries);
  const rows = toRows(entries.filter((entry) => known.has(entry.mediaId)));
  await client.$transaction([
    client.mediaUsage.deleteMany({
      where: { OR: [{ kind: { in: OWNED_KINDS } }, { kind: { startsWith: 'settings.' } }] },
    }),
    ...(rows.length > 0 ? [client.mediaUsage.createMany({ data: rows, skipDuplicates: true })] : []),
  ]);
  return rows.length;
}
