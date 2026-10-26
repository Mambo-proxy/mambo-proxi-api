import type { Lang } from '../../common/i18n/lang.js';
import {
  asObject,
  asObjectArray,
  readBoolean,
  readNullableString,
  readString,
  type JsonObject,
} from '../../common/json/json-read.js';
import { asVisual, DEFAULT_ILLUSTRATION, type Visual } from '../media/visual.mapper.js';
import type { PublishedCategory } from '../catalog/catalog.service.js';

/** Schémas `NavLink`, `Link`, `NavItem`, `MegaMenuCategory`, `Navigation` du contrat. */
export interface NavLink {
  label: string;
  href: string;
  description?: string | null;
  icon?: string | null;
}

export interface Link {
  label: string;
  href: string;
  external?: boolean;
  labelMobile?: string | null;
}

export interface NavItem {
  key: string;
  label: string;
  href: string;
  kind: 'link' | 'mega' | 'dropdown';
  placement?: 'all' | 'mobile';
  children?: NavLink[];
}

export interface MegaMenuCategory {
  slug: string;
  name: string;
  tagline: string;
  icon: string;
  tint: string;
  href: string;
  countLabel: string;
  services: { slug: string; name: string; href: string }[];
}

export interface Navigation {
  main: NavItem[];
  megaMenu: {
    categories: MegaMenuCategory[];
    promo: { title: string; text: string; cta: Link; visual: Visual };
  };
  signUp: NavLink[];
  footer: {
    about: string;
    copyright: string;
    newsletter: { eyebrow: string; title: string; text: string };
    columns: { title: string; links: NavLink[] }[];
  };
  legal: NavLink[];
}

const ICON_NAME = /^[A-Z][A-Za-z0-9]*$/;
const NAV_KINDS: ReadonlySet<unknown> = new Set(['link', 'mega', 'dropdown']);

/** Textes de repli tant que le paramètre `navigation` n'est pas renseigné. */
const DEFAULTS: Record<
  Lang,
  {
    promo: { title: string; text: string; cta: Link };
    newsletter: Navigation['footer']['newsletter'];
    copyright: string;
    count: { formula: [string, string]; service: [string, string] };
  }
> = {
  fr: {
    promo: {
      title: 'Un besoin précis ?',
      text: 'Devis gratuit, réponse sous 24 h.',
      cta: { label: 'Devis gratuit', href: '/devis' },
    },
    newsletter: {
      eyebrow: 'La lettre Mambo',
      title: 'Restez au plus près de nos nouveautés',
      text: 'Nouveaux services, magazine et conseils pour votre quotidien au Cameroun. Désinscription en un clic.',
    },
    copyright: 'Mambo Proxi · Douala — Cameroun',
    count: { formula: ['formule', 'formules'], service: ['service', 'services'] },
  },
  en: {
    promo: {
      title: 'Have a specific need?',
      text: 'Free quote, reply within 24 hours.',
      cta: { label: 'Free quote', href: '/devis' },
    },
    newsletter: {
      eyebrow: 'The Mambo letter',
      title: 'Stay close to our latest news',
      text: 'New services, magazine and tips for your daily life in Cameroon. Unsubscribe in one click.',
    },
    copyright: 'Mambo Proxi · Douala — Cameroon',
    count: { formula: ['package', 'packages'], service: ['service', 'services'] },
  },
};

function toIcon(value: unknown): string | null {
  return typeof value === 'string' && ICON_NAME.test(value) ? value : null;
}

export function toNavLinks(value: unknown): NavLink[] {
  return asObjectArray(value).flatMap((item): NavLink[] => {
    const label = readNullableString(item, 'label');
    const href = readNullableString(item, 'href');
    if (label === null || href === null) return [];
    const link: NavLink = { label, href };
    if ('description' in item) link.description = readNullableString(item, 'description');
    if ('icon' in item) link.icon = toIcon(item['icon']);
    return [link];
  });
}

function toLink(value: unknown, fallback: Link): Link {
  const item = asObject(value);
  const label = readNullableString(item, 'label');
  const href = readNullableString(item, 'href');
  if (label === null || href === null) return fallback;
  const link: Link = { label, href, external: readBoolean(item, 'external', false) };
  if ('labelMobile' in item) link.labelMobile = readNullableString(item, 'labelMobile');
  return link;
}

function toNavItems(value: unknown): NavItem[] {
  return asObjectArray(value).flatMap((item): NavItem[] => {
    const key = readNullableString(item, 'key');
    const label = readNullableString(item, 'label');
    const href = readNullableString(item, 'href');
    const kind = item['kind'];
    if (key === null || label === null || href === null || !NAV_KINDS.has(kind)) return [];
    const navItem: NavItem = { key, label, href, kind: kind as NavItem['kind'] };
    const placement = item['placement'];
    if (placement === 'mobile' || placement === 'all') navItem.placement = placement;
    if (Array.isArray(item['children'])) navItem.children = toNavLinks(item['children']);
    return [navItem];
  });
}

function plural(count: number, [singular, pluralForm]: [string, string]): string {
  return `${count} ${count > 1 ? pluralForm : singular}`;
}

/** Nombre d'entrées affiché dans le menu mobile (« 4 formules · 2 services », « 5 services »). */
export function countLabel(formulas: number, services: number, lang: Lang): string {
  const { count } = DEFAULTS[lang];
  const parts: string[] = [];
  if (formulas > 0) parts.push(plural(formulas, count.formula));
  if (services > 0 || formulas === 0) parts.push(plural(services, count.service));
  return parts.join(' · ');
}

/** Entrée du méga-menu : rubrique publiée et ses services publiés marqués « dans le menu » (`showInMenu`). */
export function toMegaMenuCategory(category: PublishedCategory, lang: Lang): MegaMenuCategory {
  const entries = category.services.filter((service) => service.showInMenu).map((service) => service.summary);
  const formulas = entries.filter((service) => service.kind === 'formula').length;
  return {
    slug: category.summary.slug,
    name: category.summary.name,
    tagline: category.summary.tagline,
    icon: category.summary.icon,
    tint: category.summary.tint,
    href: category.summary.href,
    countLabel: countLabel(formulas, entries.length - formulas, lang),
    services: entries.map((service) => ({ slug: service.slug, name: service.name, href: service.href })),
  };
}

/**
 * `Navigation` : menus et pied de page du paramètre `navigation` (traduit, visuels résolus), méga-menu généré à
 * partir des rubriques publiées et des services `showInMenu`.
 */
export function toNavigation(
  setting: JsonObject,
  categories: readonly PublishedCategory[],
  lang: Lang,
  year: number,
): Navigation {
  const defaults = DEFAULTS[lang];
  const promo = asObject(setting['megaMenuPromo'] ?? setting['promo']);
  const footer = asObject(setting['footer']);
  const newsletter = asObject(footer['newsletter']);

  return {
    main: toNavItems(setting['main']),
    megaMenu: {
      categories: categories.map((category) => toMegaMenuCategory(category, lang)),
      promo: {
        title: readString(promo, 'title', defaults.promo.title),
        text: readString(promo, 'text', defaults.promo.text),
        cta: toLink(promo['cta'], defaults.promo.cta),
        visual: asVisual(promo['visual']) ?? { illustration: DEFAULT_ILLUSTRATION, image: null, alt: '' },
      },
    },
    signUp: toNavLinks(setting['signUp']),
    footer: {
      about: readString(footer, 'about', ''),
      copyright: readString(footer, 'copyright', `© ${year} ${defaults.copyright}`),
      newsletter: {
        eyebrow: readString(newsletter, 'eyebrow', defaults.newsletter.eyebrow),
        title: readString(newsletter, 'title', defaults.newsletter.title),
        text: readString(newsletter, 'text', defaults.newsletter.text),
      },
      columns: asObjectArray(footer['columns']).flatMap((column) => {
        const title = readNullableString(column, 'title');
        return title === null ? [] : [{ title, links: toNavLinks(column['links']) }];
      }),
    },
    legal: toNavLinks(setting['legal']),
  };
}
