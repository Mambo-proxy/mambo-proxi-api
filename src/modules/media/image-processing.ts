import type { ImageType } from '../storage/file-signature.js';
import { VARIANT_FORMATS, VARIANT_WIDTHS, type VariantFormat, type VariantWidth } from './media-storage.js';

/**
 * Traitement des images avec sharp (libvips), chargé à la première utilisation : ni l'API au démarrage ni les tests
 * qui n'envoient pas d'image ne chargent la bibliothèque native.
 *
 * - À l'envoi (`prepareOriginal`) : décodage complet (fichier illisible → refus), 50 mégapixels au plus, image
 *   redressée selon l'orientation EXIF, réencodée dans son format sans aucune métadonnée (EXIF, GPS, XMP, IPTC ;
 *   seul le profil de couleur est converti en sRGB), miniature floue `blurDataUrl`.
 * - En tâche de fond (`renderVariants`) : AVIF et WebP en 480, 960 et 1600 px de large, sans agrandissement.
 */

/** Plus grande image acceptée (largeur × hauteur) : au-delà, le décodage coûterait trop de mémoire. */
export const MAX_INPUT_PIXELS = 50_000_000;
/** Largeur de la miniature floue (`blurDataUrl`, quelques centaines d'octets). */
const BLUR_WIDTH = 16;

type Sharp = (typeof import('sharp'))['default'];
let sharpModule: Promise<Sharp> | undefined;

async function loadSharp(): Promise<Sharp> {
  sharpModule ??= import('sharp').then((module) => {
    // Machine modeste : un seul fil libvips par opération, cache réduit (les fichiers ne sont lus qu'une fois).
    module.default.cache({ memory: 50, files: 0, items: 50 });
    module.default.concurrency(1);
    return module.default;
  });
  return sharpModule;
}

export class UnreadableImageError extends Error {
  constructor(readonly reason: 'unreadable' | 'too-large') {
    super(reason === 'too-large' ? 'Image trop grande.' : 'Image illisible.');
  }
}

export interface PreparedOriginal {
  /** Fichier publié (`original.<ext>`). */
  body: Buffer;
  width: number;
  height: number;
  blurDataUrl: string;
}

async function blurOf(sharp: Sharp, body: Buffer): Promise<string> {
  const thumbnail = await sharp(body, { limitInputPixels: MAX_INPUT_PIXELS })
    .resize({ width: BLUR_WIDTH, withoutEnlargement: true })
    .webp({ quality: 40 })
    .toBuffer();
  return `data:image/webp;base64,${thumbnail.toString('base64')}`;
}

/** Image envoyée → fichier publié, dimensions (orientation appliquée) et miniature floue. */
export async function prepareOriginal(body: Buffer, type: ImageType): Promise<PreparedOriginal> {
  const sharp = await loadSharp();
  if (type.vector) {
    // SVG déjà assaini : publié tel quel ; dimensions et miniature tirées du rendu (librsvg).
    let metadata;
    try {
      metadata = await sharp(body, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
    } catch {
      throw new UnreadableImageError('unreadable');
    }
    return {
      body,
      width: metadata.width,
      height: metadata.height,
      blurDataUrl: await blurOf(sharp, body),
    };
  }
  let output: { data: Buffer; info: { width: number; height: number } };
  try {
    const metadata = await sharp(body, { limitInputPixels: false }).metadata();
    if (metadata.width * metadata.height > MAX_INPUT_PIXELS) throw new UnreadableImageError('too-large');
    // `failOn: 'error'` : un fichier tronqué ou corrompu est refusé ; `autoOrient` : redressement EXIF. Aucune
    // métadonnée n'est recopiée (comportement par défaut de sharp, sans `keepMetadata`/`withMetadata`).
    const pipeline = sharp(body, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error', autoOrient: true });
    const encoded =
      type.kind === 'JPEG'
        ? pipeline.jpeg({ quality: 88, mozjpeg: true })
        : type.kind === 'PNG'
          ? pipeline.png({ compressionLevel: 9, adaptiveFiltering: true })
          : pipeline.webp({ quality: 88 });
    output = await encoded.toBuffer({ resolveWithObject: true });
  } catch (error) {
    if (error instanceof UnreadableImageError) throw error;
    throw new UnreadableImageError('unreadable');
  }
  return {
    body: output.data,
    width: output.info.width,
    height: output.info.height,
    blurDataUrl: await blurOf(sharp, output.data),
  };
}

export interface RenderedVariant {
  width: VariantWidth;
  format: VariantFormat;
  body: Buffer;
}

/** Largeurs produites pour une image : celles qui ne dépassent pas l'original (aucun agrandissement). */
export function variantWidths(originalWidth: number): VariantWidth[] {
  return VARIANT_WIDTHS.filter((width) => width <= originalWidth);
}

/** Variantes AVIF et WebP de l'original publié (déjà redressé et sans métadonnées). */
export async function renderVariants(original: Buffer, originalWidth: number): Promise<RenderedVariant[]> {
  const sharp = await loadSharp();
  const variants: RenderedVariant[] = [];
  for (const width of variantWidths(originalWidth)) {
    for (const format of VARIANT_FORMATS) {
      const resized = sharp(original, { limitInputPixels: MAX_INPUT_PIXELS }).resize({
        width,
        withoutEnlargement: true,
      });
      const body = await (
        format === 'avif' ? resized.avif({ quality: 50, effort: 4 }) : resized.webp({ quality: 78 })
      ).toBuffer();
      variants.push({ width, format, body });
    }
  }
  return variants;
}
