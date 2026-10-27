import type { Lang } from '../../common/i18n/lang.js';
import type { PartnerCategory, Prisma } from '../../generated/prisma/client.js';
import type { MediaService } from '../media/media.service.js';
import { mediaImageSelect, type MediaImage } from '../media/visual.mapper.js';

/** Libellés des catégories (`categoryLabel`), dans la langue du site. */
export const PARTNER_CATEGORY_LABELS: Record<Lang, Record<PartnerCategory, string>> = {
  fr: {
    EXPERIENCE: 'Prestataires Expérience',
    IMMOBILIER: 'Immobilier',
    ENTREPRISES: 'Entreprises & prestataires',
  },
  en: {
    EXPERIENCE: 'Experience providers',
    IMMOBILIER: 'Real estate',
    ENTREPRISES: 'Businesses & providers',
  },
};

export const PARTNER_SELECT = {
  id: true,
  name: true,
  category: true,
  url: true,
  visible: true,
  sortOrder: true,
  isDemo: true,
  logoImage: { select: mediaImageSelect },
} as const satisfies Prisma.PartnerSelect;

export type PartnerRow = Prisma.PartnerGetPayload<{ select: typeof PARTNER_SELECT }>;

/** Schéma `Partner` du contrat. */
export interface Partner {
  id: string;
  name: string;
  category: PartnerCategory;
  categoryLabel: string;
  logo: MediaImage | null;
  url: string | null;
}

/** Schéma `AdminPartner` du contrat. */
export interface AdminPartner extends Partner {
  visible: boolean;
  sortOrder: number;
  isDemo: boolean;
}

/** Ordre d'affichage : catégorie, rang enregistré, puis nom. */
export const PARTNER_ORDER = [
  { category: 'asc' },
  { sortOrder: 'asc' },
  { name: 'asc' },
] as const satisfies Prisma.PartnerOrderByWithRelationInput[];

export function toPartner(row: PartnerRow, media: MediaService, lang: Lang): Partner {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    categoryLabel: PARTNER_CATEGORY_LABELS[lang][row.category],
    logo: media.image(row.logoImage),
    url: row.url,
  };
}

export function toAdminPartner(row: PartnerRow, media: MediaService): AdminPartner {
  return {
    ...toPartner(row, media, 'fr'),
    visible: row.visible,
    sortOrder: row.sortOrder,
    isDemo: row.isDemo,
  };
}
