import type { MediaMimeType, MediaStatus, Prisma } from '../../generated/prisma/client.js';
import { FOREIGN_USAGES_SELECT, liveForeignUsages } from './media-usages.js';
import { mediaImageSelect, mediaUrl, toVariants, type MediaImage } from './visual.mapper.js';

/** Usage d'un média (schéma `Media.usages` du contrat). */
export interface AdminMediaUsage {
  kind: string;
  label: string;
  href: string | null;
}

/** Schéma `Media` du contrat (back-office). */
export interface AdminMedia extends MediaImage {
  fileName: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/svg+xml';
  size: number;
  status: MediaStatus;
  usages: AdminMediaUsage[];
  createdAt: string;
}

export const MIME_TYPES: Readonly<Record<MediaMimeType, AdminMedia['mimeType']>> = {
  JPEG: 'image/jpeg',
  PNG: 'image/png',
  WEBP: 'image/webp',
  SVG: 'image/svg+xml',
};

export const ADMIN_MEDIA_SELECT = {
  ...mediaImageSelect,
  fileName: true,
  mimeType: true,
  size: true,
  createdAt: true,
  usages: {
    select: { kind: true, entityId: true, slot: true, label: true, href: true },
    orderBy: [{ kind: 'asc' }, { label: 'asc' }],
  },
  ...FOREIGN_USAGES_SELECT,
} satisfies Prisma.MediaSelect;

export type AdminMediaRecord = Prisma.MediaGetPayload<{ select: typeof ADMIN_MEDIA_SELECT }>;

/**
 * Usages : lignes de `media_usages` (services, rubriques, pages, paramètres, et ce qu'y a déposé le seed) complétées
 * par les relations directes (partenaires, agenda, magazine), une seule fois chacun.
 */
function usagesOf(row: AdminMediaRecord): AdminMediaUsage[] {
  const seen = new Set<string>();
  const usages: AdminMediaUsage[] = [];
  const add = (usage: {
    kind: string;
    entityId: string;
    slot: string;
    label: string;
    href: string | null;
  }) => {
    const entity = `${usage.kind}|${usage.entityId}|${usage.slot}`;
    const shown = `${usage.kind}|${usage.label}`;
    if (seen.has(entity) || seen.has(shown)) return;
    seen.add(entity);
    seen.add(shown);
    usages.push({ kind: usage.kind, label: usage.label, href: usage.href });
  };
  row.usages.forEach(add);
  liveForeignUsages(row.id, row).forEach(add);
  return usages;
}

export function toAdminMedia(row: AdminMediaRecord, publicBaseUrl: string): AdminMedia {
  return {
    id: row.id,
    url: mediaUrl(row.storageKey, publicBaseUrl),
    width: row.width ?? 0,
    height: row.height ?? 0,
    alt: row.alt,
    focalPoint: row.focalX !== null && row.focalY !== null ? { x: row.focalX, y: row.focalY } : null,
    blurDataUrl: row.blurDataUrl,
    variants: toVariants(row.variants, publicBaseUrl),
    fileName: row.fileName,
    mimeType: MIME_TYPES[row.mimeType],
    size: row.size,
    status: row.status,
    usages: usagesOf(row),
    createdAt: row.createdAt.toISOString(),
  };
}
