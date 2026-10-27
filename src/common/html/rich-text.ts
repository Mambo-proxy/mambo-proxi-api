import sanitizeHtml from 'sanitize-html';

/**
 * Texte riche saisi dans le back-office (pages légales : articles des sections `richText`), assaini côté serveur
 * avant l'enregistrement (OWASP ASVS niveau 2, docs/07 §3). Liste blanche du schéma `Html` du contrat :
 * `p`, `h2`, `h3`, `h4`, `strong`, `em`, `a`, `ul`, `ol`, `li`, `br`, `blockquote` ; `b` et `i` deviennent `strong`
 * et `em`. Seul attribut conservé : `href` des liens, en `http(s)`, `mailto` ou `tel`, ou relatif au site (`/contact`,
 * `#article-2`) ; tout autre lien (`javascript:`, `data:`, `//autre-site`) est retiré. Les autres balises sont
 * supprimées en gardant leur texte, sauf `script`, `style`, `iframe`… dont le contenu disparaît aussi.
 */
export const RICH_TEXT_TAGS = [
  'p',
  'h2',
  'h3',
  'h4',
  'strong',
  'em',
  'a',
  'ul',
  'ol',
  'li',
  'br',
  'blockquote',
] as const;

export const RICH_TEXT_SCHEMES = ['http', 'https', 'mailto', 'tel'] as const;

/** Adresse relative au site : `/chemin` (pas `//hôte`) ou ancre `#…`. */
const RELATIVE_HREF = /^(\/(?!\/)|#)/;

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [...RICH_TEXT_TAGS],
  allowedAttributes: { a: ['href'] },
  allowedSchemes: [...RICH_TEXT_SCHEMES],
  allowedSchemesByTag: {},
  allowProtocolRelative: false,
  disallowedTagsMode: 'discard',
  nonTextTags: ['script', 'style', 'textarea', 'option', 'noscript', 'iframe', 'object', 'embed', 'template'],
  transformTags: {
    b: 'strong',
    i: 'em',
    a: (tagName, attribs): sanitizeHtml.Tag => {
      const href = (attribs['href'] ?? '').trim();
      const absolute = /^[a-z][a-z0-9+.-]*:/i.test(href);
      const allowed = absolute
        ? (RICH_TEXT_SCHEMES as readonly string[]).includes(href.split(':')[0]?.toLowerCase() ?? '')
        : RELATIVE_HREF.test(href);
      const kept: sanitizeHtml.Attributes = allowed ? { href } : {};
      return { tagName, attribs: kept };
    },
  },
  // Lien sans destination autorisée : la balise disparaît, son texte reste.
  exclusiveFilter: (frame) => (frame.tag === 'a' && !frame.attribs['href'] ? 'excludeTag' : false),
};

/** HTML assaini (liste blanche ci-dessus), espaces de début et de fin retirés. */
export function sanitizeRichText(html: string): string {
  return sanitizeHtml(html, OPTIONS).trim();
}
