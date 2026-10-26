/**
 * Variables des modèles d'e-mails : `{prénom}`, `{référence}`, `{service}`… (syntaxe du contrat et du back-office),
 * `{{prenom}}` accepté aussi. Le nom est comparé sans accents ni majuscules (`{Prénom}` = `{prenom}`).
 *
 * Sécurité : les valeurs viennent de formulaires publics. Elles ne sont jamais interprétées comme du HTML :
 * - `interpolate` produit du texte brut, que React échappe au rendu du gabarit (et que la version texte reprend
 *   telle quelle) ; les caractères de contrôle sont retirés ;
 * - `interpolateHtml` (corps HTML d'une campagne) échappe chaque valeur insérée ;
 * - `toHeaderText` ramène l'objet sur une ligne (pas d'injection d'en-tête).
 */

export type MailVariables = Readonly<Record<string, string>>;

const VARIABLE = /\{\{?\s*([\p{L}\p{N}_.-]+)\s*\}?\}/gu;
// Caractères de contrôle (hors tabulation et retour à la ligne) et séparateurs de ligne Unicode.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u2028\u2029]/g;

/** Nom de variable normalisé : minuscules, sans accents (`Référence` → `reference`). */
export function normalizeVariableName(name: string): string {
  return name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

export function sanitizeValue(value: string): string {
  return value.replace(CONTROL_CHARS, '').trim();
}

/** Remplace les variables connues ; une variable inconnue ou sans valeur disparaît. Résultat : texte brut. */
export function interpolate(template: string, variables: MailVariables, lang: 'fr' | 'en' = 'fr'): string {
  const replaced = template.replace(VARIABLE, (_match, name: string) =>
    sanitizeValue(variables[normalizeVariableName(name)] ?? ''),
  );
  return tidy(replaced, lang);
}

/**
 * Nettoie le texte après le remplacement d'une variable vide (« Merci , votre demande… » → « Merci, votre
 * demande… », « {prénom}, ce créneau… » → « Ce créneau… »). En français, l'espace avant `!`, `?`, `:` et `»`
 * (typographie française) est conservé ; en anglais, il est retiré.
 */
function tidy(text: string, lang: 'fr' | 'en'): string {
  let cleaned = text
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +,/g, ',')
    // Préposition restée seule devant la ponctuation (« … à . » quand le quartier est vide).
    .replace(/ (?:à|au|en|du|le|pour|in|at|on|for)(?= ?[.,!?]| ?$)/g, '')
    .replace(/ +\./g, '.')
    .replace(/^[\s,]+/, '')
    .replace(/,\s*([!?.])/g, ' $1')
    .trim();
  if (lang === 'en') cleaned = cleaned.replace(/ +([!?:;])/g, '$1');
  return cleaned.charAt(0).toLocaleUpperCase('fr') + cleaned.slice(1);
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}

/** Remplace les variables dans un fragment HTML (déjà assaini) en échappant chaque valeur insérée. */
export function interpolateHtml(html: string, variables: MailVariables): string {
  return html.replace(VARIABLE, (_match, name: string) =>
    escapeHtml(sanitizeValue(variables[normalizeVariableName(name)] ?? '')),
  );
}

/** Texte d'en-tête (objet) : une seule ligne, espaces resserrés, 200 caractères au plus. */
export function toHeaderText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 200);
}
