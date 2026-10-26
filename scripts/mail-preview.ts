/**
 * Prévisualisation des e-mails : rend chaque gabarit, en français et en anglais, avec les textes par défaut et les
 * données d'exemple (`src/modules/mail/templates/sample-data.ts`), dans `tmp/mail-preview/` (HTML, texte brut et
 * une page d'index). Ni base, ni Redis, ni SMTP.
 *
 *   pnpm mail:preview            (logo servi par le site local, http://localhost:3000)
 *   WEB_URL=https://mamboproxi.com pnpm mail:preview
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { DEFAULT_CONTENTS } from '../src/modules/mail/default-contents.js';
import { MAIL_TEMPLATE_KEYS, type MailLang } from '../src/modules/mail/mail.types.js';
import { renderMail } from '../src/modules/mail/render-mail.js';
import { SAMPLE_DATA, sampleContext } from '../src/modules/mail/templates/sample-data.js';

const OUTPUT_DIR = resolve(import.meta.dirname, '..', 'tmp', 'mail-preview');
const WEB_URL = (process.env['WEB_URL'] ?? 'http://localhost:3000').replace(/\/+$/, '');
const LANGS: readonly MailLang[] = ['fr', 'en'];

function escape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

await mkdir(OUTPUT_DIR, { recursive: true });
const links: string[] = [];
for (const template of MAIL_TEMPLATE_KEYS) {
  for (const lang of LANGS) {
    const rendered = await renderMail({
      template,
      lang,
      data: SAMPLE_DATA[template],
      content: DEFAULT_CONTENTS[lang][template],
      context: { ...sampleContext(lang), webUrl: WEB_URL },
    });
    const base = `${template}.${lang}`;
    await writeFile(join(OUTPUT_DIR, `${base}.html`), rendered.html, 'utf8');
    await writeFile(
      join(OUTPUT_DIR, `${base}.txt`),
      `Objet : ${rendered.subject}\n\n${rendered.text}`,
      'utf8',
    );
    links.push(
      `<li><a href="${base}.html">${base}</a> · <a href="${base}.txt">texte</a> — ${escape(rendered.subject)}</li>`,
    );
  }
}
await writeFile(
  join(OUTPUT_DIR, 'index.html'),
  `<!doctype html><html lang="fr"><meta charset="utf-8"><title>E-mails MAMBO Proxi</title>` +
    `<body style="font-family:sans-serif"><h1>E-mails (${MAIL_TEMPLATE_KEYS.length} gabarits)</h1><ul>${links.join('')}</ul></body></html>`,
  'utf8',
);
console.log(`${links.length} e-mails rendus dans ${OUTPUT_DIR} (ouvrir index.html).`);
