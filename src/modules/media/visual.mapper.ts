import type { IllustrationScene, Prisma } from '../../generated/prisma/client.js';
import { isPlainObject } from '../../common/i18n/translations.js';

/** Schéma `MediaImage` du contrat. */
export interface MediaImage {
  id: string;
  url: string;
  width: number;
  height: number;
  alt: string | null;
  focalPoint: { x: number; y: number } | null;
  blurDataUrl: string | null;
  variants: MediaVariant[];
}

export interface MediaVariant {
  url: string;
  width: 480 | 960 | 1600;
  format: 'avif' | 'webp';
}

/** Schéma `Visual` du contrat : illustration de repli, remplacée par l'image si elle est fournie. */
export interface Visual {
  illustration: IllustrationScene;
  image: MediaImage | null;
  alt: string;
}

/** Colonnes d'un média nécessaires à `MediaImage` (à reprendre dans les `select` des relations). */
export const mediaImageSelect = {
  id: true,
  storageKey: true,
  width: true,
  height: true,
  alt: true,
  focalX: true,
  focalY: true,
  blurDataUrl: true,
  variants: true,
  status: true,
} satisfies Prisma.MediaSelect;

export type MediaRecord = Prisma.MediaGetPayload<{ select: typeof mediaImageSelect }>;

const ILLUSTRATIONS: ReadonlySet<string> = new Set<IllustrationScene>([
  'accueil',
  'chef',
  'colis',
  'courses',
  'culture',
  'equipe',
  'evenement',
  'formation',
  'livraison',
  'logement',
  'marche',
  'massage',
  'photo',
  'portrait',
  'voiture',
]);
const VARIANT_WIDTHS: ReadonlySet<unknown> = new Set([480, 960, 1600]);
const VARIANT_FORMATS: ReadonlySet<unknown> = new Set(['avif', 'webp']);

export const DEFAULT_ILLUSTRATION: IllustrationScene = 'accueil';

export function isIllustration(value: unknown): value is IllustrationScene {
  return typeof value === 'string' && ILLUSTRATIONS.has(value);
}

/**
 * Adresse publique d'un fichier : une adresse absolue ou relative au site (médias livrés avec le site, ex.
 * `/photos/chef-2.png`) est reprise telle quelle ; une clé de stockage est préfixée par `MEDIA_PUBLIC_URL`.
 */
export function mediaUrl(storageKey: string, publicBaseUrl: string): string {
  if (/^(https?:)?\/\//.test(storageKey) || storageKey.startsWith('/')) return storageKey;
  return `${publicBaseUrl.replace(/\/+$/, '')}/${storageKey.replace(/^\/+/, '')}`;
}

/** Variantes du contrat lues dans la colonne `variants` (`[{ storageKey | url, width, format }]`). */
export function toVariants(value: Prisma.JsonValue, publicBaseUrl: string): MediaVariant[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((variant): MediaVariant[] => {
    if (!isPlainObject(variant) || !VARIANT_WIDTHS.has(variant['width'])) return [];
    if (!VARIANT_FORMATS.has(variant['format'])) return [];
    const source =
      typeof variant['url'] === 'string'
        ? variant['url']
        : typeof variant['storageKey'] === 'string'
          ? variant['storageKey']
          : undefined;
    if (source === undefined) return [];
    return [
      {
        url: mediaUrl(source, publicBaseUrl),
        width: variant['width'] as MediaVariant['width'],
        format: variant['format'] as MediaVariant['format'],
      },
    ];
  });
}

/** `MediaImage` d'un média ; `null` sans média ou si son traitement a échoué (l'illustration reste affichée). */
export function toMediaImage(
  media: MediaRecord | null | undefined,
  publicBaseUrl: string,
): MediaImage | null {
  if (!media || media.status === 'FAILED') return null;
  return {
    id: media.id,
    url: mediaUrl(media.storageKey, publicBaseUrl),
    width: media.width ?? 0,
    height: media.height ?? 0,
    alt: media.alt,
    focalPoint: media.focalX !== null && media.focalY !== null ? { x: media.focalX, y: media.focalY } : null,
    blurDataUrl: media.blurDataUrl,
    variants: toVariants(media.variants, publicBaseUrl),
  };
}

/** `Visual` d'un emplacement photo : `alt` propre à l'emplacement, sinon celui du média, sinon vide (décoratif). */
export function toVisual(
  illustration: IllustrationScene | null | undefined,
  media: MediaRecord | null | undefined,
  publicBaseUrl: string,
  alt?: string | null,
): Visual {
  const image = toMediaImage(media, publicBaseUrl);
  return {
    illustration: illustration ?? DEFAULT_ILLUSTRATION,
    image,
    alt: alt ?? image?.alt ?? '',
  };
}

/**
 * Visuel enregistré dans un JSON par référence au média (`{ illustration, imageId, alt }`, ex. visuels secondaires
 * des rubriques). Un visuel déjà sous la forme du contrat (`{ illustration, image, alt }`) n'en est pas un.
 */
function isVisualReference(
  value: unknown,
): value is { illustration?: unknown; imageId: unknown; alt?: unknown } {
  return isPlainObject(value) && 'imageId' in value && !('image' in value);
}

/**
 * Visuel enregistré sous la forme du contrat avec une image de la médiathèque (`{ illustration, image: { id, … },
 * alt }`, copie d'un média dans un JSON) : identifiant de l'image, relue dans la médiathèque comme une référence, pour
 * renvoyer partout la même forme complète (`MediaImage` à jour : texte alternatif, point focal, variantes).
 */
function inlineImageId(value: unknown): string | null {
  if (!isPlainObject(value) || !('illustration' in value) || !isPlainObject(value['image'])) return null;
  const id = value['image']['id'];
  return typeof id === 'string' ? id : null;
}

/** Identifiants des médias référencés dans un JSON (sections de pages, visuels de rubriques, paramètres). */
export function collectImageIds(value: unknown, into: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectImageIds(item, into);
  } else if (isPlainObject(value)) {
    if (isVisualReference(value) && typeof value.imageId === 'string') into.add(value.imageId);
    const inline = inlineImageId(value);
    if (inline !== null) into.add(inline);
    for (const item of Object.values(value)) collectImageIds(item, into);
  }
  return into;
}

/** Remplace, dans un JSON, chaque référence `{ illustration, imageId, alt }` par le `Visual` du contrat. */
export function resolveJsonVisuals<T>(
  value: T,
  media: ReadonlyMap<string, MediaRecord>,
  publicBaseUrl: string,
): T {
  if (Array.isArray(value)) {
    return value.map((item: unknown) => resolveJsonVisuals(item, media, publicBaseUrl)) as T;
  }
  if (!isPlainObject(value)) return value;
  const inline = inlineImageId(value);
  const inlineMedia = inline === null ? undefined : media.get(inline);
  if (inlineMedia !== undefined) {
    return toVisual(
      isIllustration(value['illustration']) ? value['illustration'] : DEFAULT_ILLUSTRATION,
      inlineMedia,
      publicBaseUrl,
      typeof value['alt'] === 'string' ? value['alt'] : null,
    ) as T;
  }
  if (isVisualReference(value)) {
    const imageId = typeof value.imageId === 'string' ? value.imageId : null;
    const visual = toVisual(
      isIllustration(value.illustration) ? value.illustration : DEFAULT_ILLUSTRATION,
      imageId === null ? null : media.get(imageId),
      publicBaseUrl,
      typeof value.alt === 'string' ? value.alt : null,
    );
    return visual as T;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, resolveJsonVisuals(item, media, publicBaseUrl)]),
  ) as T;
}

/** Visuel d'un JSON (déjà résolu par `resolveJsonVisuals`) s'il est valide, sinon `null`. */
export function asVisual(value: unknown): Visual | null {
  if (!isPlainObject(value) || !isIllustration(value['illustration'])) return null;
  return {
    illustration: value['illustration'],
    image: isPlainObject(value['image']) ? (value['image'] as unknown as MediaImage) : null,
    alt: typeof value['alt'] === 'string' ? value['alt'] : '',
  };
}
