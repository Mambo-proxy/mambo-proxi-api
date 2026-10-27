import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TEMPLATE_CATALOG, TEMPLATE_ENTRIES } from './email-template-catalog.js';
import { normalizeVariableName, variablesIn } from './interpolate.js';
import { MAIL_TEMPLATE_KEYS } from './mail.types.js';

interface SeedTemplate {
  key: string;
  subject: string;
  preheader: string | null;
  title: string;
  paragraphs: string[];
  buttonLabel: string | null;
}

const SEED = JSON.parse(
  readFileSync(new URL('../../../prisma/seed/data/email-templates.json', import.meta.url), 'utf8'),
) as SeedTemplate[];

describe('fiches des e-mails automatiques', () => {
  it('décrivent les 21 modèles du contrat, dans l’ordre', () => {
    expect(TEMPLATE_CATALOG.map((entry) => entry.key)).toEqual([...MAIL_TEMPLATE_KEYS]);
    expect(TEMPLATE_CATALOG.every((entry) => entry.name !== '' && entry.description !== '')).toBe(true);
  });

  it('marquent les modèles indispensables comme non désactivables', () => {
    expect(TEMPLATE_CATALOG.filter((entry) => !entry.canDisable).map((entry) => entry.key)).toEqual([
      'newsletter-confirm',
      'newsletter-campaign',
      'user-invite',
      'otp-code',
      'password-reset',
    ]);
  });

  it('autorisent toutes les variables des textes du seed', () => {
    for (const template of SEED) {
      const entry = TEMPLATE_ENTRIES.get(template.key as (typeof MAIL_TEMPLATE_KEYS)[number]);
      const texts = [
        template.subject,
        template.title,
        template.preheader ?? '',
        template.buttonLabel ?? '',
        ...template.paragraphs,
      ];
      const unknown = texts
        .flatMap((text) => variablesIn(text))
        .filter((name) => !entry?.allowed.has(normalizeVariableName(name)));
      expect(unknown, template.key).toEqual([]);
    }
    expect(TEMPLATE_ENTRIES.get('otp-code')?.variables).toEqual(['{code}']);
    expect(TEMPLATE_ENTRIES.get('quote-ack')?.variables).toEqual(
      expect.arrayContaining(['{prénom}', '{référence}', '{service}']),
    );
  });
});
