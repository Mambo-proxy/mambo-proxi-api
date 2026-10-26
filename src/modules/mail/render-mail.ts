import { render } from '@react-email/render';
import { createElement } from 'react';
import type { MailContent } from './default-contents.js';
import { interpolate, interpolateHtml, toHeaderText } from './interpolate.js';
import { readText, safeUrl } from './mail-format.js';
import type { MailAudience, MailContext, MailLink, MailView, SummaryRow } from './mail-view.js';
import type { MailLang, MailTemplateKey } from './mail.types.js';
import { MailDocument } from './templates/mail-document.js';
import { LOGO_PATH } from './templates/theme.js';
import {
  buildVariables,
  label,
  missingData,
  normalizeData,
  TEMPLATE_DEFINITIONS,
} from './template-definitions.js';

/** Données d'une tâche insuffisantes pour composer l'e-mail : inutile de réessayer. */
export class MailDataError extends Error {
  constructor(
    readonly template: MailTemplateKey,
    readonly missing: string[],
  ) {
    super(`Données manquantes pour l'e-mail « ${template} » : ${missing.join(', ')}.`);
    this.name = 'MailDataError';
  }
}

export interface RenderMailInput {
  template: MailTemplateKey;
  lang: MailLang;
  data: Record<string, unknown>;
  content: MailContent;
  context: MailContext;
}

export interface RenderedMail {
  subject: string;
  html: string;
  text: string;
  view: MailView;
}

const SIGNATURE = {
  fr: (siteName: string) => `L’équipe ${siteName}`,
  en: (siteName: string) => `The ${siteName} team`,
} as const;

const NOTICES: Record<
  Exclude<MailAudience, 'newsletter'>,
  Record<MailLang, (domain: string, siteName: string) => string>
> = {
  client: {
    fr: (domain) => `Vous recevez cet e-mail suite à votre demande sur ${domain}.`,
    en: (domain) => `You are receiving this e-mail following your request on ${domain}.`,
  },
  equipe: {
    fr: (_domain, siteName) => `E-mail automatique destiné à l’équipe ${siteName}.`,
    en: (_domain, siteName) => `Automatic e-mail for the ${siteName} team.`,
  },
  utilisateur: {
    fr: (_domain, siteName) =>
      `E-mail de sécurité du back-office ${siteName}. Si vous n’êtes pas à l’origine de cette demande, ignorez-le.`,
    en: (_domain, siteName) =>
      `Security e-mail from the ${siteName} back office. If you did not make this request, please ignore it.`,
  },
};

const FOOTER_LABELS = {
  fr: { phone: 'Téléphone', whatsapp: 'WhatsApp', unsubscribe: 'Se désinscrire' },
  en: { phone: 'Phone', whatsapp: 'WhatsApp', unsubscribe: 'Unsubscribe' },
} as const;

/** Domaine affiché dans le pied de page (`mamboproxi.com`). */
function displayDomain(webUrl: string): string {
  return new URL(webUrl).host.replace(/^www\./, '');
}

function footerLines(context: MailContext, lang: MailLang): string[] {
  const labels = FOOTER_LABELS[lang];
  const contact = [
    context.phoneDisplay && `${labels.phone} ${context.phoneDisplay}`,
    context.whatsappDisplay && `${labels.whatsapp} ${context.whatsappDisplay}`,
  ].filter(Boolean);
  const identity = [context.email, context.tagline].filter(Boolean);
  return [contact.join(' · '), identity.join(' · ')].filter((line) => line !== '');
}

/** Compose le contenu affiché d'un e-mail (textes du modèle + données de la tâche + coordonnées). */
export function buildMailView(input: RenderMailInput): MailView {
  const { template, lang, content, context } = input;
  const data = normalizeData(template, input.data);
  const definition = TEMPLATE_DEFINITIONS[template];
  const missing = missingData(definition, data);
  if (missing.length > 0) throw new MailDataError(template, missing);

  const variables = buildVariables(data, lang);
  const fill = (text: string): string => interpolate(text, variables, lang);
  const definitionInput = { data, lang, context };

  const summary: SummaryRow[] = [];
  for (const [key, value] of definition.summary?.(definitionInput) ?? []) {
    if (value !== undefined && value !== '') {
      summary.push({ label: typeof key === 'string' ? label(key, lang) : key.text, value });
    }
  }

  const actionUrl = safeUrl(readText(data, 'actionUrl')) ?? definition.defaultButtonUrl?.(definitionInput);
  const buttonLabel = content.buttonLabel === null ? '' : fill(content.buttonLabel);
  const button: MailLink | null =
    buttonLabel !== '' && actionUrl !== undefined ? { label: buttonLabel, url: actionUrl } : null;

  const paragraphs = content.paragraphs.map(fill).filter((paragraph) => paragraph !== '');
  const domain = displayDomain(context.webUrl);

  let title: string | null = fill(content.title);
  let bodyHtml: string | null = null;
  let bodyText: string | null = null;
  let notice: string;
  let unsubscribe: MailLink | null = null;
  let visibleParagraphs = paragraphs;

  if (definition.campaign === true) {
    // Campagne : le corps (HTML assaini par l'éditeur du back-office) remplace titre et paragraphes ; les
    // paragraphes du modèle deviennent la mention du pied de page, suivie du lien de désinscription.
    title = null;
    bodyHtml = interpolateHtml(readText(data, 'html') ?? '', variables);
    bodyText = readText(data, 'text') ?? null;
    notice = paragraphs.join(' ');
    visibleParagraphs = [];
    unsubscribe = {
      label: FOOTER_LABELS[lang].unsubscribe,
      url: safeUrl(readText(data, 'unsubscribeUrl')) as string,
    };
  } else {
    notice =
      definition.notice?.(lang, domain) ??
      NOTICES[definition.audience === 'newsletter' ? 'client' : definition.audience][lang](
        domain,
        context.siteName,
      );
  }

  const preheader = fill(readText(data, 'preheader') ?? content.preheader ?? '') || (paragraphs[0] ?? '');

  return {
    lang,
    audience: definition.audience,
    preheader,
    title,
    paragraphs: visibleParagraphs,
    summary,
    code: definition.code === true ? (readText(data, 'code') ?? null) : null,
    ratingUrl: definition.rating === true && actionUrl !== undefined ? actionUrl : null,
    button,
    bodyHtml,
    bodyText,
    signature: SIGNATURE[lang](context.siteName),
    logoUrl: `${context.webUrl}${LOGO_PATH}`,
    logoAlt: context.siteName,
    webUrl: context.webUrl,
    footerLines: footerLines(context, lang),
    notice,
    unsubscribe,
  };
}

/** Version texte brut, envoyée systématiquement avec le HTML. */
export function renderMailText(view: MailView): string {
  // « Libellé : valeur » en français, « Label: value » en anglais.
  const colon = view.lang === 'fr' ? ' : ' : ': ';
  const blocks: string[] = [];
  if (view.title !== null) blocks.push(view.title);
  if (view.bodyText !== null) blocks.push(view.bodyText);
  else if (view.bodyHtml !== null) blocks.push(htmlToText(view.bodyHtml));
  blocks.push(...view.paragraphs);
  if (view.code !== null) blocks.push(view.code);
  if (view.summary.length > 0)
    blocks.push(view.summary.map((row) => `${row.label} : ${row.value}`).join('\n'));
  if (view.button !== null) blocks.push(`${view.button.label}${colon}${view.button.url}`);
  else if (view.ratingUrl !== null) blocks.push(view.ratingUrl);
  blocks.push(view.signature);
  blocks.push(
    [
      '—',
      ...view.footerLines,
      view.notice,
      view.unsubscribe && `${view.unsubscribe.label}${colon}${view.unsubscribe.url}`,
    ]
      .filter(Boolean)
      .join('\n'),
  );
  return `${blocks.join('\n\n')}\n`;
}

/** Texte d'un fragment HTML de campagne (sans dépendance : balises retirées, entités courantes décodées). */
function htmlToText(html: string): string {
  return html
    .replace(/<\s*(br|\/p|\/h[1-6]|\/li|\/div)\s*\/?>/gi, '\n')
    .replace(/<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '$2 ($1)')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Rendu complet : objet, HTML (React Email) et texte brut. */
export async function renderMail(input: RenderMailInput): Promise<RenderedMail> {
  const view = buildMailView(input);
  const variables = buildVariables(normalizeData(input.template, input.data), input.lang);
  const subject = toHeaderText(interpolate(input.content.subject, variables, input.lang));
  const html = await render(createElement(MailDocument, { view }));
  return { subject, html, text: renderMailText(view), view };
}
