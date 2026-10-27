import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { categoryPatchSchema, servicePatchSchema } from './modules/catalog/admin-catalog.schemas.js';
import { emailTemplateInputSchema } from './modules/mail/admin-email-templates.service.js';
import { pageDraftSchema } from './modules/pages/page-sections.schemas.js';
import { isSettingsGroup, settingsGroupSchema } from './modules/settings/admin-settings.schemas.js';
import { zonePatchSchema } from './modules/zones/admin-zones.schemas.js';

/**
 * Données de départ (`prisma/seed/data`) contre les limites du contrat : celles que le back-office applique à
 * l'enregistrement (schémas des corps `CategoryPatch`, `ServicePatch`, `PageDraftInput`, `ZonePatch`), en français et
 * dans chaque traduction. Le seed n'est relu que par les tests sur la base réelle : sans ce contrôle, un texte trop
 * long (titre Google de 69 caractères pour 60) ne se voit qu'en CI, et le back-office refuserait ensuite d'enregistrer
 * la fiche telle quelle.
 */

type Row = Record<string, unknown>;

function seed(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`../prisma/seed/data/${name}.json`, import.meta.url), 'utf8'));
}

const TINTS: Record<string, string> = {
  ORANGE_50: 'orange-50',
  NEUTRAL_100: 'neutral-100',
  VERT_50: 'vert-50',
  NEUTRAL_900: 'neutral-900',
};

/** Erreurs d'un enregistrement, en français puis dans chaque traduction (`translations.<langue>`). */
function problems(label: string, schema: z.ZodType, row: Row, toInput: (row: Row) => Row): string[] {
  const variants: [string, Row][] = [['fr', row]];
  const translations = (row['translations'] ?? {}) as Record<string, Row>;
  for (const [lang, translated] of Object.entries(translations))
    variants.push([lang, { ...row, ...translated }]);
  return variants.flatMap(([lang, value]) => {
    const result = schema.safeParse(toInput(value));
    return result.success
      ? []
      : result.error.issues.map((issue) => `${label} (${lang}) ${issue.path.join('.')} : ${issue.message}`);
  });
}

describe('données de départ et limites du contrat', () => {
  const catalogue = seed('catalogue') as { categories: Row[]; services: Row[] };

  it('rubriques', () => {
    const errors = catalogue.categories.flatMap((category) =>
      problems(String(category['slug']), categoryPatchSchema, category, (value) => {
        const { id: _id, tint, visuals: _visuals, translations: _translations, homeCard, ...fields } = value;
        // `homeCard` absent (null en base) : renvoyé `{}` par le back-office.
        return { ...fields, ...(homeCard === null ? {} : { homeCard }), tint: TINTS[String(tint)] ?? tint };
      }),
    );
    expect(errors).toEqual([]);
  });

  it('services', () => {
    const errors = catalogue.services.flatMap((service) =>
      problems(String(service['slug']), servicePatchSchema, service, (value) => {
        const {
          id: _id,
          gallery: _gallery,
          relatedIds,
          translations: _translations,
          offers,
          ...fields
        } = value;
        return {
          ...fields,
          relatedServiceIds: relatedIds,
          offers: ((offers ?? []) as Row[]).map((offer) => ({ ...offer, id: null, serviceId: null })),
        };
      }),
    );
    expect(errors).toEqual([]);
  });

  it('pages (sections et SEO)', () => {
    const pages = seed('pages') as Row[];
    const errors = pages.flatMap((page) =>
      problems(String(page['key']), pageDraftSchema, page, (value) => ({
        sections: value['sections'],
        seo: value['seo'] ?? undefined,
      })),
    );
    expect(errors).toEqual([]);
  });

  it('zones et quartiers', () => {
    const data = seed('zones') as Row[] | { zones: Row[] };
    const zones = Array.isArray(data) ? data : data.zones;
    const errors = zones.flatMap((zone) =>
      problems(String(zone['key']), zonePatchSchema, { ...zone, translations: undefined }, (value) => ({
        name: value['name'],
        nameEn: value['nameEn'],
        tone: value['tone'],
        description: value['description'],
        descriptionEn: value['descriptionEn'],
        result: value['result'],
        resultEn: value['resultEn'],
        delay: value['delay'],
        area: value['area'],
        quarters: ((value['quarters'] ?? []) as Row[]).map((quarter) => ({
          name: quarter['name'],
          detail: quarter['detail'],
          mapLabel: quarter['mapLabel'],
          coordinates:
            typeof quarter['lat'] === 'number' && typeof quarter['lng'] === 'number'
              ? { lat: quarter['lat'], lng: quarter['lng'] }
              : null,
        })),
      })),
    );
    expect(errors).toEqual([]);
  });

  it('paramètres (groupes du contrat)', () => {
    const settings = seed('settings') as Row[];
    const errors = settings
      .filter((row) => isSettingsGroup(String(row['key'])))
      .flatMap((row) =>
        problems(
          String(row['key']),
          settingsGroupSchema,
          { ...(row['value'] as Row), translations: row['translations'] },
          (value) => {
            const { translations: _translations, ...fields } = value;
            return { group: row['key'], ...fields };
          },
        ),
      );
    expect(errors).toEqual([]);
  });

  it('modèles d’e-mails', () => {
    const templates = seed('email-templates') as Row[];
    const errors = templates.flatMap((template) =>
      problems(String(template['key']), emailTemplateInputSchema, template, (value) => {
        const { key: _key, translations: _translations, ...fields } = value;
        return fields;
      }),
    );
    expect(errors).toEqual([]);
  });
});
