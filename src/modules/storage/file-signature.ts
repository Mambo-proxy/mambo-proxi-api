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
