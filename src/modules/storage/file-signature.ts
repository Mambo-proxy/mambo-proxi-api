/**
 * Type réel d'un document reçu, déterminé par sa signature (« octets magiques ») et non par l'extension ou le type
 * annoncé par le navigateur. Formats acceptés pour un CV (contrat, `POST /v1/job-applications`) : PDF, DOC, DOCX.
 */

export interface DocumentType {
  mimeType: string;
  extension: 'pdf' | 'doc' | 'docx';
  label: 'PDF' | 'DOC' | 'DOCX';
}

export const PDF: DocumentType = { mimeType: 'application/pdf', extension: 'pdf', label: 'PDF' };
export const DOC: DocumentType = { mimeType: 'application/msword', extension: 'doc', label: 'DOC' };
export const DOCX: DocumentType = {
  mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  extension: 'docx',
  label: 'DOCX',
};

/** `%PDF-` : le format tolère quelques octets avant l'en-tête (1 024 au plus). */
const PDF_MAGIC = Buffer.from('%PDF-', 'latin1');
const PDF_HEADER_WINDOW = 1024;
/** Fichier composé OLE2 (Word 97-2003, mais aussi Excel, PowerPoint, Outlook…). */
const OLE2_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
/** Flux principal d'un document Word dans un fichier OLE2 (nom en UTF-16LE dans le répertoire du fichier). */
const WORD_STREAM = Buffer.from('WordDocument', 'utf16le');
/** En-tête local d'une archive ZIP (DOCX, mais aussi ODT, XLSX, JAR…). */
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
/** Entrées obligatoires d'un document Word Open XML (noms stockés en clair dans les en-têtes de l'archive). */
const DOCX_CONTENT_TYPES = Buffer.from('[Content_Types].xml', 'latin1');
const DOCX_WORD_PART = Buffer.from('word/', 'latin1');

function startsWith(body: Buffer, magic: Buffer): boolean {
  return body.length >= magic.length && body.subarray(0, magic.length).equals(magic);
}

/** Type du document, ou `null` s'il n'est ni un PDF, ni un document Word (DOC, DOCX). */
export function detectDocumentType(body: Buffer): DocumentType | null {
  if (body.subarray(0, PDF_HEADER_WINDOW).includes(PDF_MAGIC)) return PDF;
  if (startsWith(body, OLE2_MAGIC)) return body.includes(WORD_STREAM) ? DOC : null;
  if (startsWith(body, ZIP_MAGIC))
    return body.includes(DOCX_CONTENT_TYPES) && body.includes(DOCX_WORD_PART) ? DOCX : null;
  return null;
}

/**
 * Images de la médiathèque (contrat, `POST /v1/admin/media`) : JPG, PNG, WebP et SVG. Les autres formats d'image
 * (AVIF, GIF, HEIC, TIFF…) sont refusés à l'envoi ; AVIF et WebP ne sont produits que comme variantes.
 */
export interface ImageType {
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/svg+xml';
  extension: 'jpg' | 'png' | 'webp' | 'svg';
  /** Valeur de l'énumération `MediaMimeType` de la base. */
  kind: 'JPEG' | 'PNG' | 'WEBP' | 'SVG';
  vector: boolean;
}

export const JPEG_IMAGE: ImageType = {
  mimeType: 'image/jpeg',
  extension: 'jpg',
  kind: 'JPEG',
  vector: false,
};
export const PNG_IMAGE: ImageType = { mimeType: 'image/png', extension: 'png', kind: 'PNG', vector: false };
export const WEBP_IMAGE: ImageType = {
  mimeType: 'image/webp',
  extension: 'webp',
  kind: 'WEBP',
  vector: false,
};
export const SVG_IMAGE: ImageType = {
  mimeType: 'image/svg+xml',
  extension: 'svg',
  kind: 'SVG',
  vector: true,
};

const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const RIFF_MAGIC = Buffer.from('RIFF', 'latin1');
const WEBP_MAGIC = Buffer.from('WEBP', 'latin1');
/**
 * Début d'un SVG : BOM (reconnu par `\s`), déclaration XML, commentaires et DOCTYPE (avec ses entités) facultatifs,
 * puis l'élément racine `<svg`. Le DOCTYPE est retiré par l'assainissement (aucune entité n'est développée).
 */
const SVG_START =
  /^\s*(?:<\?xml[^>]{0,200}\?>\s*)?(?:<!--[\s\S]{0,2000}?-->\s*)*(?:<!DOCTYPE[^>[]{0,500}(?:\[[\s\S]{0,8000}?\])?\s*>\s*)?(?:<!--[\s\S]{0,2000}?-->\s*)*<svg[\s>]/i;
/** Les DOCTYPE des logiciels de dessin déclarent parfois des entités : en-tête lu sur 16 Ko. */
const SVG_HEADER_WINDOW = 16 * 1024;

/** Type de l'image, ou `null` si elle n'est ni un JPG, ni un PNG, ni un WebP, ni un SVG. */
export function detectImageType(body: Buffer): ImageType | null {
  if (startsWith(body, JPEG_MAGIC)) return JPEG_IMAGE;
  if (startsWith(body, PNG_MAGIC)) return PNG_IMAGE;
  if (startsWith(body, RIFF_MAGIC) && body.length >= 12 && body.subarray(8, 12).equals(WEBP_MAGIC))
    return WEBP_IMAGE;
  const head = body.subarray(0, SVG_HEADER_WINDOW);
  if (head.includes(0)) return null;
  return SVG_START.test(head.toString('utf8')) ? SVG_IMAGE : null;
}
