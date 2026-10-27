import sanitizeHtml from 'sanitize-html';

/**
 * Assainissement des SVG envoyés à la médiathèque (servis publiquement, affichés par `<img>` sur le site mais
 * ouvrables directement) : liste blanche d'éléments graphiques, aucun script ni gestionnaire d'événement, aucun
 * `foreignObject` (HTML incorporé), aucune animation (`set`/`animate` peuvent réécrire un lien), aucune feuille de
 * style (`<style>`, `@import`), aucune référence externe : seuls les liens internes (`#id`) et les images
 * matricielles incorporées (`data:image/png|jpeg|webp|gif;base64`) sont gardés. Déclaration XML et DOCTYPE (entités)
 * retirées avant l'analyse.
 */

const SVG_TAGS = [
  'svg',
  'g',
  'defs',
  'symbol',
  'use',
  'title',
  'desc',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'textPath',
  'image',
  'switch',
  'marker',
  'linearGradient',
  'radialGradient',
  'stop',
  'clipPath',
  'mask',
  'pattern',
  'filter',
  'feBlend',
  'feColorMatrix',
  'feComponentTransfer',
  'feComposite',
  'feConvolveMatrix',
  'feDiffuseLighting',
  'feDisplacementMap',
  'feDistantLight',
  'feDropShadow',
  'feFlood',
  'feFuncA',
  'feFuncB',
  'feFuncG',
  'feFuncR',
  'feGaussianBlur',
  'feMerge',
  'feMergeNode',
  'feMorphology',
  'feOffset',
  'fePointLight',
  'feSpecularLighting',
  'feSpotLight',
  'feTile',
  'feTurbulence',
];

/** Éléments supprimés avec leur contenu texte. */
const DROPPED_WITH_CONTENT = ['script', 'style', 'foreignObject', 'foreignobject', 'iframe', 'noscript'];

const LINK_ATTRIBUTES = new Set(['href', 'xlink:href']);
const INTERNAL_LINK = /^#[\w.:-]+$/;
const EMBEDDED_RASTER = /^data:image\/(?:png|jpeg|webp|gif);base64,[a-z0-9+/=\s]+$/i;
/** Valeur dangereuse dans un attribut ou un style : référence externe (`url(` hors `#id`), script, CSS ancien. */
const UNSAFE_VALUE =
  /url\s*\(\s*['"]?\s*(?!#)|expression\s*\(|javascript:|vbscript:|@import|behavior\s*:|-moz-binding/i;
/** Attributs gardés : noms simples ou préfixés `xlink:`, `xml:`, `xmlns` (aucun autre espace de noms). */
const ATTRIBUTE_NAME = /^(?:xmlns(?::xlink)?|xlink:href|xml:space|xml:lang|[a-zA-Z][a-zA-Z0-9-]*)$/;

function safeAttributes(tagName: string, attribs: Record<string, string>): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const [name, value] of Object.entries(attribs)) {
    const lower = name.toLowerCase();
    if (lower.startsWith('on') || !ATTRIBUTE_NAME.test(name)) continue;
    if (LINK_ATTRIBUTES.has(lower)) {
      const target = value.trim();
      if (INTERNAL_LINK.test(target) || (tagName === 'image' && EMBEDDED_RASTER.test(target)))
        kept[name] = target;
      continue;
    }
    if (lower === 'xmlns' && value !== 'http://www.w3.org/2000/svg') continue;
    if (lower === 'xmlns:xlink' && value !== 'http://www.w3.org/1999/xlink') continue;
    if (UNSAFE_VALUE.test(value)) continue;
    kept[name] = value;
  }
  return kept;
}

/** Texte d'un SVG assaini (UTF-8), ou `null` si le fichier n'a plus d'élément racine `<svg>` exploitable. */
export function sanitizeSvg(body: Buffer): Buffer | null {
  const source = body
    .toString('utf8')
    .replace(/^\s+/, '') // BOM compris (`\s` le reconnaît).
    .replace(/<\?xml[\s\S]*?\?>/gi, '')
    .replace(/<!DOCTYPE[^>[]*(?:\[[\s\S]*?\])?\s*>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  const cleaned = sanitizeHtml(source, {
    allowedTags: SVG_TAGS,
    allowedAttributes: false,
    allowedSchemes: ['data'],
    allowedSchemesAppliedToAttributes: [],
    allowProtocolRelative: false,
    nonTextTags: DROPPED_WITH_CONTENT,
    disallowedTagsMode: 'discard',
    parser: { xmlMode: true, lowerCaseTags: false, lowerCaseAttributeNames: false },
    transformTags: {
      '*': (tagName, attribs) => ({ tagName, attribs: safeAttributes(tagName, attribs) }),
    },
  }).trim();
  if (!/^<svg[\s>]/.test(cleaned) || !cleaned.endsWith('</svg>')) return null;
  const withNamespace = /^<svg[^>]*\sxmlns=/.test(cleaned)
    ? cleaned
    : cleaned.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
  return Buffer.from(withNamespace, 'utf8');
}
