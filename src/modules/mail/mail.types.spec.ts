import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { DEFAULT_CONTENTS } from './default-contents.js';
import { isMailTemplateKey, MAIL_TEMPLATE_KEYS } from './mail.types.js';
import { TEMPLATE_DEFINITIONS } from './template-definitions.js';

const CONTRACT = parse(readFileSync(new URL('../../../contracts/openapi.yaml', import.meta.url), 'utf8')) as {
  components: { schemas: Record<string, { enum?: string[] }> };
};
const SEED = JSON.parse(
  readFileSync(new URL('../../../prisma/seed/data/email-templates.json', import.meta.url), 'utf8'),
) as Array<{
  key: string;
  subject: string;
  preheader: string | null;
  title: string;
  paragraphs: string[];
  buttonLabel: string | null;
  enabled: boolean;
}>;

describe('clés des modèles d’e-mails', () => {
  it('couvrent exactement l’énumération EmailTemplateKey du contrat', () => {
    const contractKeys = CONTRACT.components.schemas['EmailTemplateKey']?.enum ?? [];

    expect([...MAIL_TEMPLATE_KEYS].sort()).toEqual([...contractKeys].sort());
    expect(new Set(MAIL_TEMPLATE_KEYS).size).toBe(MAIL_TEMPLATE_KEYS.length);
  });

  it('ont chacune une définition et des textes par défaut dans les deux langues', () => {
    expect(Object.keys(TEMPLATE_DEFINITIONS).sort()).toEqual([...MAIL_TEMPLATE_KEYS].sort());
    for (const lang of ['fr', 'en'] as const) {
      expect(Object.keys(DEFAULT_CONTENTS[lang]).sort()).toEqual([...MAIL_TEMPLATE_KEYS].sort());
    }
  });

  it('reconnaît une clé valide et refuse le reste', () => {
    expect(isMailTemplateKey('quote-ack')).toBe(true);
    expect(isMailTemplateKey('quote')).toBe(false);
    expect(isMailTemplateKey(42)).toBe(false);
  });
});

describe('textes par défaut', () => {
  it('reprennent exactement les modèles du seed en français', () => {
    expect(SEED.map((row) => row.key).sort()).toEqual([...MAIL_TEMPLATE_KEYS].sort());
    for (const row of SEED) {
      const { key, enabled: _enabled, ...fields } = row;
      expect(DEFAULT_CONTENTS.fr[key as keyof typeof DEFAULT_CONTENTS.fr], key).toEqual(fields);
    }
  });

  it('utilisent en anglais les mêmes variables qu’en français', () => {
    const variablesOf = (text: string): string[] =>
      [...text.matchAll(/\{([^}]+)\}/g)].map((m) => m[1] ?? '').sort();
    for (const key of MAIL_TEMPLATE_KEYS) {
      const fr = DEFAULT_CONTENTS.fr[key];
      const en = DEFAULT_CONTENTS.en[key];
      const all = (content: typeof fr): string =>
        [content.subject, content.title, ...content.paragraphs, content.buttonLabel ?? ''].join(' ');
      expect(variablesOf(all(en)), key).toEqual(variablesOf(all(fr)));
      expect(en.buttonLabel === null, key).toBe(fr.buttonLabel === null);
    }
  });
});
