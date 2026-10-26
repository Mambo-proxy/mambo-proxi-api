/**
 * Tests e2e des lectures publiques (paramètres, navigation, redirections, pages, zones, plan du site, rubriques,
 * services) sur l'application NestJS complète ; chaque réponse est validée contre le contrat.
 *
 * - « avec des doubles » : `PrismaService` est remplacé par un double en mémoire rempli d'enregistrements construits à
 *   partir des données simulées du site (`test/fixtures/public-content.ts`) ; ces tests tournent partout.
 * - « avec la base réelle » : activés par `E2E_REAL_SERVICES=true` (CI, base migrée et remplie par `pnpm db:seed`).
 */
import type { Server } from 'node:http';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  CONTRACT_WARM_UP_TIMEOUT,
  expectToMatchContract,
  expectToMatchSchema,
  prepareContract,
} from './contract.js';
import { publicContentTables } from './fixtures/public-content.js';
import { createPrismaDouble } from './support/prisma-double.js';

type Body = Record<string, unknown>;

async function createApp(useDouble: boolean): Promise<NestExpressApplication> {
  let builder = Test.createTestingModule({ imports: [AppModule] });
  if (useDouble)
    builder = builder.overrideProvider(PrismaService).useValue(createPrismaDouble(publicContentTables()));
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(app);
  await app.init();
  return app;
}

/** Requête GET validée contre le contrat (statut attendu, en-têtes obligatoires, schéma du corps). */
async function get(app: NestExpressApplication, path: string, status = 200): Promise<request.Response> {
  const server: Server = app.getHttpServer();
  const response = await request(server).get(path);
  expect(response.status, `${path} : ${JSON.stringify(response.body)}`).toBe(status);
  expectToMatchContract('get', path, status, response);
  return response;
}

function slugs(items: unknown): string[] {
  return (items as Body[]).map((item) => String(item['slug']));
}

const SCHEMAS = [
  'SiteSettings',
  'Navigation',
  'Redirect',
  'Page',
  'ServiceAreas',
  'SitemapEntry',
  'CategorySummary',
  'CategoryDetail',
  'ServiceSummary',
  'ServiceDetail',
  'Problem',
];

describe('lectures publiques (avec des doubles)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    prepareContract(...SCHEMAS);
    app = await createApp(true);
  }, CONTRACT_WARM_UP_TIMEOUT);

  afterAll(async () => {
    await app.close();
  });

  describe('GET /v1/site/settings', () => {
    it('renvoie les paramètres en français, en cache public revalidé', async () => {
      const response = await get(app, '/v1/site/settings');

      expect(response.headers['cache-control']).toBe('public, no-cache');
      expect(response.headers['etag']).toMatch(/^W\/".+"$/);
      expect(response.body).toMatchObject({
        siteName: 'MAMBO Proxi',
        tagline: 'Vos services, au plus près de vous',
        contact: { phoneCameroonDisplay: '+237 6 00 00 00 00', hoursLabel: 'Lun – Sam · 8h – 20h' },
        whatsapp: { message: 'Bonjour Mambo Proxi, je souhaite des informations sur…' },
      });
    });

    it('renvoie les paramètres en anglais, le français à défaut de traduction', async () => {
      const response = await get(app, '/v1/site/settings?lang=en');

      expect(response.body).toMatchObject({
        tagline: 'Your services, close at hand',
        signature: "Mambo, ce n'est pas qu'un service. C'est une expérience pensée pour vous.",
        contact: { hoursLabel: 'Mon – Sat · 8am – 8pm' },
        agency: { name: 'MAMBO Proxi agency', city: 'Douala' },
      });
    });

    it('répond 304 sans corps quand le contenu n’a pas changé (If-None-Match)', async () => {
      const server: Server = app.getHttpServer();
      const first = await request(server).get('/v1/site/settings');
      const etag = String(first.headers['etag']);

      const second = await request(server).get('/v1/site/settings').set('If-None-Match', etag);
      const otherLang = await request(server).get('/v1/site/settings?lang=en').set('If-None-Match', etag);

      // Le contrat ne décrit pas encore la réponse 304 (point signalé) : statut et corps vérifiés ici.
      expect(second.status).toBe(304);
      expect(second.text ?? '').toBe('');
      expect(otherLang.status).toBe(200);
    });

    it('refuse une langue inconnue (400 invalid-query)', async () => {
      const response = await request(app.getHttpServer()).get('/v1/site/settings?lang=de');

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({
        type: 'https://api.mamboproxi.com/problems/invalid-query',
        errors: [{ path: 'lang', code: 'invalid_choice' }],
      });
      expectToMatchSchema('Problem', response.body);
    });
  });

  describe('GET /v1/site/navigation', () => {
    it('génère le méga-menu à partir des rubriques et services publiés « dans le menu »', async () => {
      const response = await get(app, '/v1/site/navigation');
      const body = response.body as { megaMenu: { categories: Body[] }; main: Body[]; footer: Body };

      expect(slugs(body.megaMenu.categories)).toEqual([
        'services-a-domicile',
        'experience',
        'immobilier',
        'services-de-proximite',
        'culture-evenementiel',
      ]);
      const [domicile, experience] = body.megaMenu.categories;
      expect(domicile).toMatchObject({
        countLabel: '1 formule · 1 service',
        services: [
          { slug: 'maison-essentiel', href: '/services/services-a-domicile#formules' },
          { slug: 'entretien-du-logement', href: '/services/services-a-domicile/entretien-du-logement' },
        ],
      });
      // Brouillon, publication programmée et service hors menu (massage) absents.
      expect(slugs(experience?.['services'])).toEqual(['location-voiture', 'photographe', 'chef-prive']);
      expect(experience?.['countLabel']).toBe('3 services');
      expect(body.main.map((item) => item['key'])).toEqual(['accueil', 'services', 'mission', 'zones']);
    });

    it('traduit menus, méga-menu et pied de page', async () => {
      const response = await get(app, '/v1/site/navigation?lang=en');
      const body = response.body as Body & { megaMenu: { categories: Body[]; promo: Body }; main: Body[] };

      expect(body.main[0]).toMatchObject({ label: 'Home', href: '/' });
      expect(body.main[2]).toMatchObject({ label: 'Mission', children: [{ label: 'Our mission' }] });
      expect(body.megaMenu.categories[0]).toMatchObject({
        name: 'Home services',
        countLabel: '1 package · 1 service',
      });
      expect(body.megaMenu.promo).toMatchObject({
        title: 'Have a specific need?',
        visual: { illustration: 'accueil', image: { id: 'photo-accueil', url: '/photos/accueil.png' } },
      });
    });
  });

  it('GET /v1/site/redirects renvoie les redirections', async () => {
    const response = await get(app, '/v1/site/redirects');

    expect(response.body).toEqual([
      {
        from: '/services/experience/chef-a-domicile',
        to: '/services/experience/chef-prive',
        permanent: true,
      },
    ]);
  });

  describe('GET /v1/pages/{key}', () => {
    it('renvoie les sections publiées et visibles, images résolues', async () => {
      const response = await get(app, '/v1/pages/accueil');
      const body = response.body as Body & { sections: Body[] };

      expect(body).toMatchObject({ key: 'accueil', title: 'Accueil', isPreview: false });
      expect(body.sections.map((section) => section['id'])).toEqual(['hero', 'univers', 'bandeau-services']);
      expect(body.sections[0]?.['visual']).toMatchObject({
        illustration: 'accueil',
        image: { id: 'photo-accueil', url: '/photos/accueil.png', width: 1448 },
        alt: 'Une famille sourit dans son salon.',
      });
    });

    it('renvoie la page traduite avec repli sur le français, section par section', async () => {
      const response = await get(app, '/v1/pages/accueil?lang=en');
      const body = response.body as Body & { sections: Body[] };

      expect(body.title).toBe('Home');
      expect(body.sections[0]).toMatchObject({
        title: "Mambo isn't just a service. ==It's an experience designed for you.==",
        lead: 'Nos intervenants de confiance se déplacent chez vous, à Douala et environs.',
      });
      expect(body.sections[1]).toMatchObject({ title: 'Nos univers' });
    });

    it('sert une page non traduite en français', async () => {
      const response = await get(app, '/v1/pages/mission?lang=en');

      expect(response.body).toMatchObject({ key: 'mission', title: 'Notre mission' });
    });

    it.each([
      ['jamais publiée', '/v1/pages/magazine'],
      ['inexistante', '/v1/pages/contact'],
      ['hors contrat', '/v1/pages/home'],
    ])('répond 404 pour une page %s', async (_label, path) => {
      const response = await get(app, path, 404);

      expect(response.body).toEqual({
        type: 'https://api.mamboproxi.com/problems/not-found',
        title: 'Introuvable',
        status: 404,
        detail: "Cette page n'existe pas ou n'est plus disponible.",
      });
    });
  });

  describe('GET /v1/zones', () => {
    it('renvoie les zones actives sans tarif indicatif', async () => {
      const response = await get(app, '/v1/zones');
      const body = response.body as { zones: Body[]; map: Body | null; note: string };

      expect(body.zones.map((zone) => zone['key'])).toEqual(['zone-1', 'zone-speciale']);
      expect(body.zones[1]?.['area']).toBeNull();
      expect(body.map).toMatchObject({ zoom: 12 });
      expect(body.note).toBe(
        'Votre quartier n’apparaît pas ? Contactez-nous : nous étudions chaque demande.',
      );
      expect(JSON.stringify(body)).not.toMatch(/"fee|"delay|"active/);
    });

    it('traduit noms, descriptions et quartiers', async () => {
      const response = await get(app, '/v1/zones?lang=en');
      const body = response.body as { zones: (Body & { quarters: Body[] })[]; note: string };

      expect(body.zones[0]).toMatchObject({
        name: 'Zone 1 — Nearby',
        description: 'Around our Cité SIC base.',
      });
      expect(body.zones[1]).toMatchObject({
        name: 'Special zone',
        description: 'Intervention possible, sur devis.',
      });
      expect(body.zones[1]?.quarters[0]).toMatchObject({
        name: 'Bonabéri',
        detail: 'west bank of the Wouri',
      });
      expect(body.note).toBe('Can’t find your neighbourhood? Contact us: we look at every request.');
    });
  });

  it('GET /v1/sitemap liste les adresses publiques publiées', async () => {
    const response = await get(app, '/v1/sitemap');
    const paths = (response.body as Body[]).map((entry) => entry['path']);

    expect(paths.slice(0, 2)).toEqual(['/', '/mission']);
    expect(paths).toContain('/mentions-legales');
    expect(paths).toContain('/services/experience');
    expect(paths).toContain('/services/experience/chef-prive');
    expect(paths).toContain('/recrutement/chef-cuisinier-a-domicile');
    for (const hidden of [
      '/magazine',
      '/404',
      '/services/ancienne-rubrique',
      '/services/experience/service-brouillon',
      '/services/experience/service-programme',
      '/services/services-a-domicile#formules',
      '/recrutement/offre-expiree',
    ]) {
      expect(paths).not.toContain(hidden);
    }
  });

  describe('GET /v1/categories', () => {
    it('renvoie les rubriques publiées, triées et numérotées', async () => {
      const response = await get(app, '/v1/categories');
      const body = response.body as Body[];

      expect(slugs(body)).toEqual([
        'services-a-domicile',
        'experience',
        'immobilier',
        'services-de-proximite',
        'culture-evenementiel',
      ]);
      expect(body[1]).toMatchObject({
        name: 'Expérience',
        number: '02',
        tint: 'orange-50',
        serviceCount: 4,
        href: '/services/experience',
        visual: { illustration: 'chef', image: { id: 'photo-exp-hero' } },
        homeCard: { visual: { illustration: 'chef', image: { id: 'photo-chef-2' } } },
      });
      expect(body[1]).not.toHaveProperty('services');
    });

    it('inclut les services publiés avec include=services, en anglais', async () => {
      const response = await get(app, '/v1/categories?include=services&lang=en');
      const body = response.body as (Body & { services: Body[] })[];

      expect(body[1]).toMatchObject({ name: 'Experience', tagline: 'Tailor-made moments' });
      expect(slugs(body[1]?.services)).toEqual([
        'location-voiture',
        'photographe',
        'chef-prive',
        'massage-bien-etre',
      ]);
      expect(body[1]?.services[2]).toMatchObject({ name: 'Private chef', category: { name: 'Experience' } });
      expect(body[2]).toMatchObject({ name: 'Immobilier' });
    });
  });

  describe('GET /v1/categories/{slug}', () => {
    it('renvoie la page rubrique complète', async () => {
      const response = await get(app, '/v1/categories/experience');
      const body = response.body as Body & { offerSections: Body[]; otherCategories: Body[]; groups: Body[] };

      expect(body).toMatchObject({
        slug: 'experience',
        heroTitle: 'Des moments sur mesure, ==pensés pour vous.==',
        heroVisual: { image: { id: 'photo-exp-hero' } },
        testimonial: { id: 'rev_jean_marc_chef', initials: 'JT' },
        testimonialVisual: { image: { id: 'photo-offre-tete-a-tete' } },
        cta: { title: 'Envie d’un moment\nsur mesure ?' },
        groups: [{ title: 'À la carte', serviceSlugs: ['chef-prive'] }],
        highlight: null,
      });
      expect(body.offerSections).toEqual([
        expect.objectContaining({
          eyebrow: 'Nos véhicules',
          items: [
            expect.objectContaining({
              id: 'off_berline',
              action: 'BOOKING',
              serviceSlug: 'location-voiture',
            }),
          ],
        }),
      ]);
      expect(slugs(body.otherCategories)).toEqual([
        'services-a-domicile',
        'immobilier',
        'services-de-proximite',
      ]);
    });

    it('renvoie la rubrique en anglais', async () => {
      const response = await get(app, '/v1/categories/experience?lang=en');

      expect(response.body).toMatchObject({
        name: 'Experience',
        heroTitle: 'Tailor-made moments, ==designed for you.==',
        audiences: [{ icon: 'User', title: 'Individuals' }, { title: 'Families on holiday' }],
        offerSections: [{ eyebrow: 'Our vehicles' }],
      });
    });

    it('renvoie la mise en avant (agenda) d’une rubrique', async () => {
      const response = await get(app, '/v1/categories/culture-evenementiel');

      expect(response.body).toMatchObject({ highlight: { kind: 'AGENDA', link: { href: '/evenements' } } });
    });

    it.each(['ancienne-rubrique', 'inconnue', 'Pas_Un_Slug'])('répond 404 pour « %s »', async (slug) => {
      const response = await get(app, `/v1/categories/${slug}`, 404);

      expect(response.body).toMatchObject({
        detail: "Cette rubrique n'existe pas ou n'est plus disponible.",
      });
    });
  });

  describe('GET /v1/services', () => {
    it('renvoie les services publiés, triés par rubrique puis ordre', async () => {
      const response = await get(app, '/v1/services');

      expect(slugs(response.body)).toEqual([
        'maison-essentiel',
        'entretien-du-logement',
        'location-voiture',
        'photographe',
        'chef-prive',
        'massage-bien-etre',
        'recherche-logement',
        'portage-livraison-repas',
        'decouverte-cameroun',
      ]);
    });

    it('filtre par rubrique, mise en avant et recherche', async () => {
      const byCategory = await get(app, '/v1/services?category=services-a-domicile');
      const featured = await get(app, '/v1/services?featured=true');
      const search = await get(app, '/v1/services?q=CHEF%20PRIVE');
      const searchEn = await get(app, '/v1/services?q=private&lang=en');

      expect(slugs(byCategory.body)).toEqual(['maison-essentiel', 'entretien-du-logement']);
      expect((byCategory.body as Body[])[0]).toMatchObject({ kind: 'formula' });
      expect(slugs(featured.body)).toEqual(['location-voiture', 'chef-prive']);
      expect(slugs(search.body)).toEqual(['chef-prive']);
      expect(slugs(searchEn.body)).toEqual(['chef-prive']);
    });
  });

  describe('GET /v1/services/{slug}', () => {
    it('renvoie la fiche avec offres, galerie, services liés et avis publiés', async () => {
      const response = await get(app, '/v1/services/chef-prive');
      const body = response.body as Body & { related: Body[]; reviews: Body[]; offers: { items: Body[] } };

      expect(body).toMatchObject({
        id: 'svc_chef_prive',
        name: 'Chef privé',
        href: '/services/experience/chef-prive',
        cities: ['Douala', 'Yaoundé', 'Kribi'],
        offers: { eyebrow: 'Nos chefs', title: 'Choisissez votre chef et votre formule.' },
        reviewSummary: { total: 2, average: 4.5 },
        updatedAt: '2026-10-19T08:00:00.000Z',
      });
      expect(body.offers.items.map((item) => item['id'])).toEqual(['off_chef_paul', 'off_chef_aicha']);
      expect(slugs(body.related)).toEqual(['location-voiture', 'photographe']);
      expect(body.reviews.map((review) => review['id'])).toEqual(['rev_jean_marc_chef', 'rev_laure_chef']);
    });

    it('renvoie la fiche en anglais, aussi par son slug anglais', async () => {
      const response = await get(app, '/v1/services/chef-prive?lang=en');
      const bySlugEn = await get(app, '/v1/services/private-chef?lang=en');

      expect(response.body).toMatchObject({
        name: 'Private chef',
        reviewsTitle: 'They welcomed a chef at home',
        relatedTitle: 'Pour compléter votre événement',
        category: { slug: 'experience', name: 'Experience' },
      });
      expect(bySlugEn.body).toEqual(response.body);
      await get(app, '/v1/services/private-chef', 404);
    });

    it.each(['service-brouillon', 'service-programme', 'service-rubrique-archivee', 'inconnu'])(
      'répond 404 pour « %s »',
      async (slug) => {
        const response = await get(app, `/v1/services/${slug}`, 404);

        expect(response.body).toEqual({
          type: 'https://api.mamboproxi.com/problems/not-found',
          title: 'Introuvable',
          status: 404,
          detail: "Ce service n'existe pas ou n'est plus disponible.",
        });
      },
    );
  });
});

describe.runIf(process.env['E2E_REAL_SERVICES'] === 'true')(
  'lectures publiques (avec la base réelle)',
  () => {
    let app: NestExpressApplication;

    beforeAll(async () => {
      prepareContract(...SCHEMAS);
      app = await createApp(false);
    }, CONTRACT_WARM_UP_TIMEOUT);

    afterAll(async () => {
      await app.close();
    });

    it.each([
      '/v1/site/settings',
      '/v1/site/navigation',
      '/v1/site/redirects',
      '/v1/zones',
      '/v1/sitemap',
      '/v1/categories',
      '/v1/categories?include=services',
      '/v1/services',
      '/v1/services?featured=true',
    ])('%s est conforme au contrat en français et en anglais', async (path) => {
      await get(app, path);
      await get(app, `${path}${path.includes('?') ? '&' : '?'}lang=en`);
    });

    it('les rubriques et services publiés du seed ont des pages conformes au contrat', async () => {
      const categories = (await get(app, '/v1/categories?include=services')).body as (Body & {
        services: Body[];
      })[];
      expect(slugs(categories)).toEqual(
        expect.arrayContaining(['services-a-domicile', 'experience', 'immobilier', 'services-de-proximite']),
      );

      for (const category of categories) {
        await get(app, `/v1/categories/${String(category['slug'])}`);
        await get(app, `/v1/categories/${String(category['slug'])}?lang=en`);
      }
      const services = categories
        .flatMap((category) => category.services)
        .filter((item) => item['kind'] !== 'formula');
      expect(slugs(services)).toContain('chef-prive');
      for (const service of services) {
        await get(app, `/v1/services/${String(service['slug'])}`);
      }
      await get(app, '/v1/services/chef-prive?lang=en');
    });

    it.each(['accueil', 'mission', 'qui-sommes-nous'])(
      'la page « %s » est conforme au contrat',
      async (key) => {
        const response = await get(app, `/v1/pages/${key}`);
        await get(app, `/v1/pages/${key}?lang=en`);

        expect((response.body as Body)['key']).toBe(key);
      },
    );

    it('répond 404 au format Problem pour un contenu inexistant', async () => {
      await get(app, '/v1/services/service-inexistant', 404);
      await get(app, '/v1/categories/rubrique-inexistante', 404);
    });
  },
);
