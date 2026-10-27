import sanitizeHtml from 'sanitize-html';
import { RICH_TEXT_SCHEMES, RICH_TEXT_TAGS } from '../../common/html/rich-text.js';

/**
 * Corps d'une campagne (schéma `EmailHtml` du contrat), assaini côté serveur avant l'enregistrement : balises du
 * texte riche (`Html`), plus `img` (`src` en http(s), `alt`, dimensions) et les boutons d'appel à l'action
 * `<a data-button href="…">`. Liens en `http(s)`, `mailto` ou `tel` (pas de lien relatif : l'e-mail est lu hors du
 * site). La variable `{prénom}` reste dans le texte et est remplacée à l'envoi.
 */
const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [...RICH_TEXT_TAGS, 'img'],
  allowedAttributes: { a: ['href', 'data-button'], img: ['src', 'alt', 'width', 'height'] },
  allowedSchemes: [...RICH_TEXT_SCHEMES],
  allowedSchemesByTag: { img: ['http', 'https'] },
  allowProtocolRelative: false,
  disallowedTagsMode: 'discard',
  nonTextTags: ['script', 'style', 'textarea', 'option', 'noscript', 'iframe', 'object', 'embed', 'template'],
  transformTags: { b: 'strong', i: 'em' },
  exclusiveFilter: (frame) => {
    if (frame.tag === 'a' && !frame.attribs['href']) return 'excludeTag';
    if (frame.tag === 'img' && !frame.attribs['src']) return true;
    return false;
  },
};

export function sanitizeEmailHtml(html: string): string {
  return sanitizeHtml(html, OPTIONS).trim();
}

/** Texte visible d'un corps HTML (contrôle « contenu vide », version texte brut de la campagne). */
export function htmlToText(html: string): string {
  return sanitizeHtml(
    html.replace(/<\/(p|h2|h3|h4|li|blockquote)>/gi, '\n\n').replace(/<br\s*\/?>/gi, '\n'),
    { allowedTags: [], allowedAttributes: {} },
  )
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*/g, '\n\n')
    .trim();
}
