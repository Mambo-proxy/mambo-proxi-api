/**
 * Tests e2e des pages, zones, paramètres et e-mails du back-office (`/v1/admin/pages*`, `/v1/admin/zones*`,
 * `/v1/admin/settings/{group}`, `/v1/admin/system-status`, `/v1/admin/email-templates*`) :
 * - « avec des doubles » : double de Prisma (`test/fixtures/content.ts`) ; permissions par rôle (MANAGER en lecture
 *   seule, groupes réservés aux administrateurs), brouillon et publication relus par les routes publiques, HTML
 *   assaini, aperçu par jeton, quartiers et contours, modèles d'e-mails (variables, aperçu, test) ;
 * - « avec la base réelle » : activés par `E2E_REAL_SERVICES=true` (base migrée et remplie par `pnpm db:seed`).
 * Chaque réponse est validée contre le contrat.
 */
import type { Server } from 'node:http';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PasswordService } from '../src/modules/auth/password.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { CONTRACT_WARM_UP_TIMEOUT, prepareContract } from './contract.js';
import { contentTables, resetContent } from './fixtures/content.js';
import {
  ACCOUNTS,
  MailQueueDouble,
  PASSWORD,
  PROBLEMS,
  ResettableThrottlerStorage,
  createApp,
  expectContract,
  signIn,
  type TestSession,
} from './support/auth.js';
import type { PrismaTables } from './support/prisma-double.js';

type Row = Record<string, unknown>;
type Role = 'admin' | 'manager' | 'agent' | 'editor' | 'writer';

describe('pages, zones, paramètres et e-mails du back-office (avec des doubles)', () => {
  const mail = new MailQueueDouble();
  const throttler = new ResettableThrottlerStorage();
  let app: NestExpressApplication;
  let server: Server;
  let tables: PrismaTables;
  let fresh: PrismaTables;
  const sessions = {} as Record<Role, TestSession>;

  const rows = (name: keyof PrismaTables): Row[] => tables[name] ?? [];
  const write = (role: Role, method: 'post' | 'put' | 'patch' | 'delete', path: string) =>
    sessions[role].agent[method](path).set('X-CSRF-Token', sessions[role].csrf);

  beforeAll(async () => {
    prepareContract('AdminPage', 'AdminZones', 'EmailTemplate', 'SettingsGroupValue', 'Problem');
    const passwordHash = await new PasswordService().hash(PASSWORD);
    const now = new Date();
    fresh = contentTables(passwordHash, now);
    tables = contentTables(passwordHash, now);
    app = await createApp({ mail, throttler, tables });
    server = app.getHttpServer();
    for (const role of ['admin', 'manager', 'agent', 'editor', 'writer'] as const)
      sessions[role] = await signIn(server, mail, ACCOUNTS[role].email);
  }, CONTRACT_WARM_UP_TIMEOUT);

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    resetContent(tables, fresh);
    mail.reset();
    throttler.reset();
  });

  describe('pages', () => {
    it('liste les pages dans l’ordre du contrat, brouillon signalé', async () => {
      const response = await sessions.manager.agent.get('/v1/admin/pages');
      expectContract('get', '/v1/admin/pages', 200, response);
      expect((response.body as Row[]).map((page) => [page['key'], page['hasDraft']])).toEqual([
        ['accueil', false],
        ['mentions-legales', true],
        ['cgu', false],
      ]);
      expect((response.body as Row[])[1]?.['updatedBy']).toEqual({
        id: 'usr_mireille',
        name: 'Mireille Bell',
        initials: 'MB',
      });
      expectContract('get', '/v1/admin/pages', 403, await sessions.agent.agent.get('/v1/admin/pages'));
    });

    it('renvoie le brouillon s’il existe, visuels résolus, types de sections autorisés', async () => {
      const legal = await sessions.writer.agent.get('/v1/admin/pages/mentions-legales');
      expectContract('get', '/v1/admin/pages/{key}', 200, legal);
      expect(legal.body).toMatchObject({
        hasDraft: true,
        allowedSectionTypes: ['hero', 'richText'],
        sections: [{ id: 'hero', title: 'Mentions légales (brouillon)' }],
      });
      const home = await sessions.writer.agent.get('/v1/admin/pages/accueil');
      expect(((home.body as Row)['sections'] as Row[])[0]?.['visual']).toMatchObject({
        image: { id: 'm_hd' },
      });
      expectContract(
        'get',
        '/v1/admin/pages/{key}',
        404,
        await sessions.writer.agent.get('/v1/admin/pages/inconnue'),
      );
    });

    it('enregistre le brouillon (HTML assaini) sans toucher au site, puis le publie', async () => {
      const draft = {
        sections: [
          { id: 'hero', type: 'hero', enabled: true, variant: 'legal', title: 'Mentions légales' },
          {
            id: 'texte',
            type: 'richText',
            enabled: true,
            articles: [
              {
                title: 'Hébergeur',
                html: '<p onclick="x()">Hébergé en <b>France</b>. <a href="javascript:alert(1)">piège</a> <a href="https://exemple.fr">site</a></p><script>alert(1)</script>',
              },
            ],
          },
        ],
        seo: { title: 'Mentions légales | MAMBO Proxi', description: null, ogImageUrl: null, noindex: false },
      };
      const saved = await write('editor', 'put', '/v1/admin/pages/mentions-legales').send(draft);
      expectContract('put', '/v1/admin/pages/{key}', 200, saved);
      const html = '<p>Hébergé en <strong>France</strong>. piège <a href="https://exemple.fr">site</a></p>';
      expect(((saved.body as Row)['sections'] as Row[])[1]).toMatchObject({
        articles: [{ title: 'Hébergeur', html }],
      });
      expect((saved.body as Row)['updatedBy']).toEqual({
        id: ACCOUNTS.editor.id,
        name: 'Équipe Douala',
        initials: 'ED',
      });

      const before = await request(server).get('/v1/pages/mentions-legales');
      expectContract('get', '/v1/pages/{key}', 200, before);
      expect(JSON.stringify(before.body)).not.toContain('Hébergeur');

      const published = await write('editor', 'post', '/v1/admin/pages/mentions-legales/publish');
      expectContract('post', '/v1/admin/pages/{key}/publish', 200, published);
      expect(published.body).toMatchObject({ hasDraft: false });
      const after = await request(server).get('/v1/pages/mentions-legales');
      expectContract('get', '/v1/pages/{key}', 200, after);
      expect(after.body).toMatchObject({ seo: { title: 'Mentions légales | MAMBO Proxi' } });
      expect(((after.body as Row)['sections'] as Row[])[1]).toMatchObject({ articles: [{ html }] });
      expect(after.headers['etag']).not.toBe(before.headers['etag']);
      expect(rows('revalidationRequest').at(-1)?.['tags']).toEqual(['page:mentions-legales', 'sitemap']);
      expect(rows('auditLog').at(-1)).toMatchObject({ action: 'page.publish', entityId: 'mentions-legales' });
    });

    it('enregistre et publie la version anglaise, puis signale les traductions périmées', async () => {
      const hero = { id: 'hero', type: 'hero', enabled: true, variant: 'legal', title: 'Mentions légales' };
      const texte = {
        id: 'texte',
        type: 'richText',
        enabled: true,
        articles: [{ title: 'Éditeur', html: '<p>Société éditrice.</p>' }],
      };
      const initial = (await sessions.editor.agent.get('/v1/admin/pages/mentions-legales')).body as Row;
      expect(initial).toMatchObject({
        translations: { en: null },
        translationStatus: { en: { state: 'MISSING', missingSectionIds: ['hero'] } },
      });

      const rejected = await write('editor', 'put', '/v1/admin/pages/mentions-legales').send({
        sections: [hero, texte],
        translations: { en: { sections: [{ id: 'texte' }, { id: 'hero' }, { id: 'absente' }] } },
      });
      expectContract('put', '/v1/admin/pages/{key}', 422, rejected);
      expect(((rejected.body as Row)['errors'] as Row[]).map((error) => error['path'])).toEqual([
        'translations.en.sections.1.id',
        'translations.en.sections.2.id',
      ]);

      const saved = await write('editor', 'put', '/v1/admin/pages/mentions-legales').send({
        sections: [hero, texte],
        translations: {
          en: {
            title: 'Legal notice',
            sections: [{ ...hero, variant: 'centered', enabled: false, title: 'Legal notice' }],
          },
        },
      });
      expectContract('put', '/v1/admin/pages/{key}', 200, saved);
      expect(saved.body).toMatchObject({
        translations: {
          en: { title: 'Legal notice', sections: [{ id: 'hero', variant: 'legal', enabled: true }] },
        },
        translationStatus: { en: { state: 'MISSING', missingSectionIds: ['texte'], outdatedSectionIds: [] } },
      });

      await write('editor', 'post', '/v1/admin/pages/mentions-legales/publish');
      const english = (await request(server).get('/v1/pages/mentions-legales?lang=en')).body as Row;
      expect(english).toMatchObject({
        title: 'Legal notice',
        sections: [{ title: 'Legal notice' }, { articles: [{ title: 'Éditeur' }] }],
      });

      // Seul un changement des textes français rend la traduction périmée.
      const visual = await write('editor', 'put', '/v1/admin/pages/mentions-legales').send({
        sections: [{ ...hero, enabled: false }, texte],
      });
      expect(visual.body).toMatchObject({ translationStatus: { en: { outdatedSectionIds: [] } } });
      const outdated = await write('editor', 'put', '/v1/admin/pages/mentions-legales').send({
        sections: [{ ...hero, title: 'Informations légales' }, texte],
      });
      expectContract('put', '/v1/admin/pages/{key}', 200, outdated);
      expect(outdated.body).toMatchObject({ translationStatus: { en: { outdatedSectionIds: ['hero'] } } });

      // Traduction toujours juste : marquée revue sans changer ses textes, elle redevient à jour.
      const englishHero = { id: 'hero', title: 'Legal notice' };
      const unknownReviewed = await write('editor', 'put', '/v1/admin/pages/mentions-legales').send({
        sections: [{ ...hero, title: 'Informations légales' }, texte],
        translations: {
          en: { title: 'Legal notice', sections: [englishHero], reviewedSectionIds: ['texte'] },
        },
      });
      expectContract('put', '/v1/admin/pages/{key}', 422, unknownReviewed);
      expect(((unknownReviewed.body as Row)['errors'] as Row[]).map((error) => error['path'])).toEqual([
        'translations.en.reviewedSectionIds.0',
      ]);
      const reviewed = await write('editor', 'put', '/v1/admin/pages/mentions-legales').send({
        sections: [{ ...hero, title: 'Informations légales' }, texte],
        translations: {
          en: { title: 'Legal notice', sections: [englishHero], reviewedSectionIds: ['hero'] },
        },
      });
      expectContract('put', '/v1/admin/pages/{key}', 200, reviewed);
      expect(reviewed.body).toMatchObject({
        translations: { en: { sections: [{ id: 'hero', title: 'Legal notice' }] } },
        translationStatus: { en: { outdatedSectionIds: [] } },
      });
    });

    it('applique les règles du brouillon (types autorisés, sections automatiques, identifiants, images)', async () => {
      const response = await write('editor', 'put', '/v1/admin/pages/accueil').send({
        sections: [
          {
            id: 'hero',
            type: 'hero',
            enabled: true,
            variant: 'home',
            title: 'Titre',
            visual: { illustration: 'accueil', image: { id: 'media_inconnu' }, alt: '' },
          },
          { id: 'univers', type: 'dynamic', enabled: false, source: 'reviews-list' },
          { id: 'nouveau', type: 'dynamic', enabled: true, source: 'zones-map' },
          { id: 'hero', type: 'quote', enabled: true, text: 'Citation' },
          { id: 'stats', type: 'statsGrid', enabled: true, items: [] },
        ],
      });
      expectContract('put', '/v1/admin/pages/{key}', 422, response);
      expect((response.body as Row)['errors']).toEqual([
        {
          path: 'sections.1.source',
          code: 'read_only',
          message:
            'Le contenu de cette section vient d’un autre écran : sa source ne peut pas être modifiée.',
        },
        {
          path: 'sections.2.type',
          code: 'section_not_allowed',
          message: 'Ce type de section n’est pas disponible sur cette page.',
        },
        {
          path: 'sections.3.id',
          code: 'duplicate',
          message: 'Cet identifiant est déjà utilisé dans la page.',
        },
        {
          path: 'sections.3.type',
          code: 'section_not_allowed',
          message: 'Ce type de section n’est pas disponible sur cette page.',
        },
        {
          path: 'sections.4.type',
          code: 'section_not_allowed',
          message: 'Ce type de section n’est pas disponible sur cette page.',
        },
        {
          path: 'sections.0.visual.image',
          code: 'unknown_media',
          message: 'Cette image n’existe pas dans la médiathèque.',
        },
      ]);

      // Section automatique gardée, déplacée et masquée : acceptée.
      const kept = await write('editor', 'put', '/v1/admin/pages/accueil').send({
        sections: [
          {
            id: 'univers',
            type: 'dynamic',
            enabled: false,
            source: 'categories-bento',
            title: 'Nos univers',
          },
          { id: 'hero', type: 'hero', enabled: true, variant: 'home', title: 'Titre' },
        ],
      });
      expectContract('put', '/v1/admin/pages/{key}', 200, kept);

      const invalid = await write('editor', 'put', '/v1/admin/pages/accueil').send({
        sections: [{ id: 'x', type: 'hero', enabled: true }],
      });
      expectContract('put', '/v1/admin/pages/{key}', 422, invalid);
      expect(((invalid.body as Row)['errors'] as Row[]).map((error) => error['path'])).toEqual([
        'sections.0.variant',
      ]);
    });

    it('relit le brouillon tel qu’il a été envoyé (aller-retour), images sous leur forme complète', async () => {
      const page = (await sessions.editor.agent.get('/v1/admin/pages/accueil')).body as Row;
      const hero = (page['sections'] as Row[])[0] ?? {};
      for (const key of ['visual', 'visualSecondary'])
        expect(Object.keys((hero[key] as Row)['image'] as Row).sort()).toEqual([
          'alt',
          'blurDataUrl',
          'focalPoint',
          'height',
          'id',
          'url',
          'variants',
          'width',
        ]);
      const saved = await write('editor', 'put', '/v1/admin/pages/accueil').send({
        sections: page['sections'],
        seo: page['seo'],
      });
      expectContract('put', '/v1/admin/pages/{key}', 200, saved);
      expect((saved.body as Row)['sections']).toEqual(page['sections']);
      // Le site lit la même forme.
      const site = (await request(server).get('/v1/pages/accueil')).body as Row;
      expect(((site['sections'] as Row[])[0] ?? {})['visualSecondary']).toEqual(hero['visualSecondary']);
    });

    it('abandonne le brouillon et délivre un jeton d’aperçu du brouillon', async () => {
      const token = await sessions.manager.agent.get('/v1/admin/pages/mentions-legales/preview-token');
      expectContract('get', '/v1/admin/pages/{key}/preview-token', 200, token);
      const value = String((token.body as Row)['token']);
      const preview = await request(server).get(`/v1/pages/mentions-legales?preview=${value}`);
      expectContract('get', '/v1/pages/{key}', 200, preview);
      expect(preview.body).toMatchObject({
        isPreview: true,
        sections: [{ title: 'Mentions légales (brouillon)' }],
      });
      expect(preview.headers['cache-control']).toBe('private, no-store');
      // Jeton d'une autre page : version publiée.
      expect((await request(server).get(`/v1/pages/accueil?preview=${value}`)).body).toMatchObject({
        isPreview: false,
      });

      const discarded = await write('editor', 'post', '/v1/admin/pages/mentions-legales/discard');
      expectContract('post', '/v1/admin/pages/{key}/discard', 200, discarded);
      expect(discarded.body).toMatchObject({
        hasDraft: false,
        sections: [{ title: 'Mentions légales' }, { id: 'texte' }],
      });
      expectContract(
        'post',
        '/v1/admin/pages/{key}/discard',
        404,
        await write('editor', 'post', '/v1/admin/pages/inconnue/discard'),
      );
      expectContract(
        'get',
        '/v1/admin/pages/{key}/preview-token',
        404,
        await sessions.manager.agent.get('/v1/admin/pages/inconnue/preview-token'),
      );
    });

    it('publie une page jamais publiée et l’ouvre au site ; le MANAGER ne peut rien modifier', async () => {
      expect((await request(server).get('/v1/pages/cgu')).status).toBe(404);
      await write('writer', 'put', '/v1/admin/pages/cgu').send({
        sections: [{ id: 'hero', type: 'hero', enabled: true, variant: 'legal', title: 'CGU' }],
      });
      expectContract(
        'post',
        '/v1/admin/pages/{key}/publish',
        200,
        await write('writer', 'post', '/v1/admin/pages/cgu/publish'),
      );
      expectContract('get', '/v1/pages/{key}', 200, await request(server).get('/v1/pages/cgu'));

      for (const [method, path, url] of [
        ['put', '/v1/admin/pages/{key}', '/v1/admin/pages/accueil'],
        ['post', '/v1/admin/pages/{key}/publish', '/v1/admin/pages/accueil/publish'],
        ['post', '/v1/admin/pages/{key}/discard', '/v1/admin/pages/accueil/discard'],
      ] as const) {
        const response = await write('manager', method, url).send({ sections: [] });
        expectContract(method, path, 403, response);
      }
    });
  });

  describe('zones', () => {
    it('liste les zones avec quartiers, délais, tarifs indicatifs et demandes des 12 derniers mois', async () => {
      const response = await sessions.manager.agent.get('/v1/admin/zones');
      expectContract('get', '/v1/admin/zones', 200, response);
      const body = response.body as { zones: Row[]; showFees: boolean };
      expect(body.showFees).toBe(false);
      expect(
        body.zones.map((zone) => [zone['key'], zone['requestsCount'], (zone['quarters'] as Row[]).length]),
      ).toEqual([
        ['zone-1', 2, 2],
        ['zone-2', 1, 1],
        ['zone-vide', 0, 0],
      ]);
      expect(body.zones[0]).toMatchObject({
        delay: '30–45 min',
        fee: { amount: 1500, currency: 'XAF', from: false },
        quarters: [
          { name: 'Bonapriso', detail: 'sud', coordinates: { lat: 4.03, lng: 9.69 } },
          { name: 'Akwa' },
        ],
      });
    });

    it('crée une zone inactive à la fin, puis déplace un quartier d’une autre zone', async () => {
      const created = await write('editor', 'post', '/v1/admin/zones').send({
        name: 'Zone 3 — Périphérie',
        tone: 'zone3',
      });
      expectContract('post', '/v1/admin/zones', 201, created);
      expect(created.body).toMatchObject({
        key: 'zone-3-peripherie',
        active: false,
        sortOrder: 3,
        quarters: [],
        fee: null,
      });
      const id = String((created.body as Row)['id']);

      const updated = await write('editor', 'patch', `/v1/admin/zones/${id}`).send({
        active: true,
        quarters: [
          { name: 'Bonapriso', detail: 'sud', coordinates: { lat: 4.03, lng: 9.69 } },
          { name: 'Bépanda' },
        ],
        area: {
          type: 'Polygon',
          coordinates: [
            [
              [9.7, 4.0],
              [9.8, 4.0],
              [9.8, 4.1],
              [9.7, 4.0],
            ],
          ],
        },
        fee: { amount: 2500, from: true },
      });
      expectContract('patch', '/v1/admin/zones/{id}', 200, updated);
      expect(updated.body).toMatchObject({
        active: true,
        fee: { amount: 2500, from: true },
        area: { type: 'Polygon' },
      });
      // Bonapriso a quitté la zone 1 (un quartier n'appartient qu'à une zone), avec sa traduction.
      const list = (await sessions.manager.agent.get('/v1/admin/zones')).body as { zones: Row[] };
      expect((list.zones[0]?.['quarters'] as Row[]).map((quarter) => quarter['name'])).toEqual(['Akwa']);
      expect(rows('zoneQuarter').find((quarter) => quarter['name'] === 'Bonapriso')?.['detailEn']).toBe(
        'south',
      );

      const publicZones = await request(server).get('/v1/zones');
      expectContract('get', '/v1/zones', 200, publicZones);
      expect(((publicZones.body as Row)['zones'] as Row[]).map((zone) => zone['key'])).toEqual([
        'zone-1',
        'zone-2',
        'zone-3-peripherie',
      ]);
      expect(rows('revalidationRequest').at(-1)?.['tags']).toEqual(['zones']);
    });

    it('contrôle les coordonnées (Cameroun), le contour et les doublons (422 avec le chemin)', async () => {
      const response = await write('editor', 'patch', '/v1/admin/zones/zon_2').send({
        quarters: [{ name: 'Makèpè', coordinates: { lat: 48.85, lng: 2.35 } }, { name: 'makepe' }],
        area: {
          type: 'Polygon',
          coordinates: [
            [
              [9.7, 4.0],
              [9.8, 4.0],
              [9.8, 4.1],
              [9.75, 4.05],
            ],
          ],
        },
      });
      expectContract('patch', '/v1/admin/zones/{id}', 422, response);
      expect((response.body as Row)['errors']).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: 'quarters.0.coordinates',
            message: 'Ce point est hors du Cameroun : vérifiez la latitude et la longitude.',
          }),
          expect.objectContaining({
            path: 'quarters.1.name',
            message: 'Chaque quartier ne peut figurer qu’une fois.',
          }),
          expect.objectContaining({
            path: 'area.coordinates.0',
            message: 'Chaque anneau doit être fermé (dernier point = premier point).',
          }),
        ]),
      );
    });

    it('supprime une zone vide (204), pas une zone qui a des quartiers (409) ; réordonne', async () => {
      expectContract(
        'delete',
        '/v1/admin/zones/{id}',
        409,
        await write('editor', 'delete', '/v1/admin/zones/zon_1'),
      );
      expectContract(
        'delete',
        '/v1/admin/zones/{id}',
        204,
        await write('editor', 'delete', '/v1/admin/zones/zon_vide'),
      );
      expectContract(
        'patch',
        '/v1/admin/zones/{id}',
        404,
        await write('editor', 'patch', '/v1/admin/zones/zon_vide').send({ active: true }),
      );
      expectContract(
        'patch',
        '/v1/admin/zones/reorder',
        204,
        await write('editor', 'patch', '/v1/admin/zones/reorder').send({ ids: ['zon_2', 'zon_1'] }),
      );
      const zones = ((await request(server).get('/v1/zones')).body as Row)['zones'] as Row[];
      expect(zones.map((zone) => zone['key'])).toEqual(['zone-2', 'zone-1']);
      expectContract(
        'patch',
        '/v1/admin/zones/reorder',
        422,
        await write('editor', 'patch', '/v1/admin/zones/reorder').send({ ids: ['zon_x'] }),
      );
      expectContract(
        'post',
        '/v1/admin/zones',
        403,
        await write('manager', 'post', '/v1/admin/zones').send({ name: 'Z', tone: 'zone1' }),
      );
    });
  });

  describe('paramètres', () => {
    it('lit un groupe (settings:read) ; refuse le WRITER (403) et un groupe inconnu (404)', async () => {
      const response = await sessions.manager.agent.get('/v1/admin/settings/whatsapp');
      expectContract('get', '/v1/admin/settings/{group}', 200, response);
      expect((response.body as Row)['group']).toBe('whatsapp');
      const emails = await sessions.manager.agent.get('/v1/admin/settings/emails');
      expectContract('get', '/v1/admin/settings/{group}', 200, emails);
      expect(emails.body).toMatchObject({ group: 'emails', surveyDelayHours: 24, surveyReminderDays: 3 });
      const rgpd = await sessions.manager.agent.get('/v1/admin/settings/rgpd');
      expect(rgpd.body).toEqual({
        group: 'rgpd',
        inactiveContactsRetentionMonths: 36,
        rejectedApplicationsRetentionMonths: 24,
      });
      expectContract(
        'get',
        '/v1/admin/settings/{group}',
        403,
        await sessions.writer.agent.get('/v1/admin/settings/whatsapp'),
      );
      expectContract(
        'get',
        '/v1/admin/settings/{group}',
        404,
        await sessions.manager.agent.get('/v1/admin/settings/inconnu'),
      );
    });

    it('enregistre un groupe (EDITOR) et le site l’affiche aussitôt ; MANAGER refusé (403)', async () => {
      const body = {
        group: 'whatsapp',
        enabled: true,
        number: '+237699001122',
        message: 'Bonjour MAMBO Proxi !',
      };
      expectContract(
        'put',
        '/v1/admin/settings/{group}',
        403,
        await write('manager', 'put', '/v1/admin/settings/whatsapp').send(body),
      );

      const saved = await write('editor', 'put', '/v1/admin/settings/whatsapp').send(body);
      expectContract('put', '/v1/admin/settings/{group}', 200, saved);
      expect(saved.body).toMatchObject(body);
      // Message français changé, anglais du seed gardé (sans empreinte) : signalé « à revoir ».
      expect((saved.body as Row)['translationStatus']).toEqual({
        en: { state: 'OUTDATED', missingFields: [], outdatedFields: ['message'] },
      });
      const site = await request(server).get('/v1/site/settings');
      expectContract('get', '/v1/site/settings', 200, site);
      expect((site.body as Row)['whatsapp']).toMatchObject({
        number: '+237699001122',
        message: 'Bonjour MAMBO Proxi !',
      });
      expect(((site.body as Row)['whatsapp'] as Row)['numberDisplay']).toBe('+237 6 99 00 11 22');
      expect(rows('auditLog').at(-1)).toMatchObject({
        action: 'settings.update',
        entityId: 'whatsapp',
        after: { fields: ['number', 'message'] },
      });
      expect(rows('revalidationRequest').at(-1)?.['tags']).toEqual(['settings']);
    });

    it('réserve `analytics` et `securite` aux administrateurs ; contrôle le groupe et les valeurs (422)', async () => {
      const securite = { group: 'securite', maintenanceMode: false, trustedDeviceDays: 14 };
      const denied = await write('editor', 'put', '/v1/admin/settings/securite').send(securite);
      expectContract('put', '/v1/admin/settings/{group}', 403, denied);
      expect((denied.body as Row)['detail']).toBe('Ces paramètres sont réservés aux administrateurs.');
      expectContract(
        'put',
        '/v1/admin/settings/{group}',
        200,
        await write('admin', 'put', '/v1/admin/settings/securite').send(securite),
      );

      const mismatch = await write('editor', 'put', '/v1/admin/settings/whatsapp').send({
        group: 'rgpd',
        inactiveContactsRetentionMonths: 36,
        rejectedApplicationsRetentionMonths: 24,
      });
      expectContract('put', '/v1/admin/settings/{group}', 422, mismatch);
      expect((mismatch.body as Row)['errors']).toEqual([
        { path: 'group', code: 'group_mismatch', message: 'Le groupe envoyé ne correspond pas à l’adresse.' },
      ]);
      const invalid = await write('editor', 'put', '/v1/admin/settings/emails').send({
        group: 'emails',
        teamRecipients: [],
        senderName: '',
        surveyDelayHours: 1000,
        surveyReminderDays: null,
        appointmentReminderHour: 9,
      });
      expectContract('put', '/v1/admin/settings/{group}', 422, invalid);
      expect(
        ((invalid.body as Row)['errors'] as Row[]).map((error) => [error['path'], error['message']]),
      ).toEqual([
        ['teamRecipients', 'Indiquez au moins une adresse valide.'],
        ['senderName', 'Indiquez le nom de l’expéditeur.'],
        ['surveyDelayHours', 'Entre 0 et 720 heures.'],
      ]);
    });

    it('donne l’état du système', async () => {
      const response = await sessions.manager.agent.get('/v1/admin/system-status');
      expectContract('get', '/v1/admin/system-status', 200, response);
      expect(response.body).toMatchObject({ https: false, lastBackupAt: null, backupRetentionDays: 30 });
      expectContract(
        'get',
        '/v1/admin/system-status',
        403,
        await sessions.writer.agent.get('/v1/admin/system-status'),
      );
    });
  });

  describe('e-mails automatiques', () => {
    it('liste les 21 modèles avec variables et désactivation possible', async () => {
      const response = await sessions.manager.agent.get('/v1/admin/email-templates');
      expectContract('get', '/v1/admin/email-templates', 200, response);
      const templates = response.body as Row[];
      expect(templates).toHaveLength(21);
      expect(templates[0]).toMatchObject({
        key: 'quote-ack',
        name: 'Accusé de réception du devis',
        audience: 'client',
        canDisable: true,
      });
      expect(templates[0]?.['variables']).toEqual(
        expect.arrayContaining(['{prénom}', '{référence}', '{service}']),
      );
      expect(
        templates.filter((template) => template['canDisable'] === false).map((template) => template['key']),
      ).toEqual(['newsletter-confirm', 'newsletter-campaign', 'user-invite', 'otp-code', 'password-reset']);
      expectContract(
        'get',
        '/v1/admin/email-templates/{key}',
        200,
        await sessions.manager.agent.get('/v1/admin/email-templates/otp-code'),
      );
      expectContract(
        'get',
        '/v1/admin/email-templates/{key}',
        404,
        await sessions.manager.agent.get('/v1/admin/email-templates/inconnu'),
      );
    });

    it('modifie un modèle (variables du modèle seulement, e-mails indispensables toujours actifs)', async () => {
      const saved = await write('editor', 'put', '/v1/admin/email-templates/quote-ack').send({
        subject: 'Demande {référence} bien reçue',
        paragraphs: ['Merci {prénom} !', '  '],
        enabled: false,
      });
      expectContract('put', '/v1/admin/email-templates/{key}', 200, saved);
      expect(saved.body).toMatchObject({
        subject: 'Demande {référence} bien reçue',
        paragraphs: ['Merci {prénom} !'],
        enabled: false,
      });

      const unknown = await write('editor', 'put', '/v1/admin/email-templates/quote-ack').send({
        title: 'Bonjour {lien}',
      });
      expectContract('put', '/v1/admin/email-templates/{key}', 422, unknown);
      expect(((unknown.body as Row)['errors'] as Row[])[0]).toMatchObject({
        path: 'title',
        code: 'unknown_variable',
      });
      const essential = await write('editor', 'put', '/v1/admin/email-templates/otp-code').send({
        enabled: false,
      });
      expectContract('put', '/v1/admin/email-templates/{key}', 422, essential);
      expect(((essential.body as Row)['errors'] as Row[])[0]).toMatchObject({
        path: 'enabled',
        message: 'Cet e-mail est indispensable : il ne peut pas être désactivé.',
      });
      expectContract(
        'put',
        '/v1/admin/email-templates/{key}',
        403,
        await write('manager', 'put', '/v1/admin/email-templates/quote-ack').send({ enabled: true }),
      );

      // Modèle désactivé : pas d'envoi de test.
      const test = await write('editor', 'post', '/v1/admin/email-templates/quote-ack/test').send({
        email: 'test@example.com',
      });
      expectContract('post', '/v1/admin/email-templates/{key}/test', 409, test);
      expect(mail.jobs).toHaveLength(0);
    });

    it('rend un aperçu avec un contenu non enregistré, et met un envoi de test en file', async () => {
      const preview = await write('manager', 'post', '/v1/admin/email-templates/quote-ack/preview').send({
        subject: 'Votre demande {référence}',
        title: 'Merci {prénom}',
      });
      expectContract('post', '/v1/admin/email-templates/{key}/preview', 200, preview);
      const body = preview.body as { subject: string; html: string; text: string };
      expect(body.subject).toBe('Votre demande MP-2026-0142');
      expect(body.html).toContain('Merci Aurélie');
      expect(body.text).toContain('Merci Aurélie');
      expect(rows('emailTemplate').find((row) => row['key'] === 'quote-ack')?.['subject']).toBe(
        'Nous avons bien reçu votre demande {référence}',
      );
      const saved = await write('manager', 'post', '/v1/admin/email-templates/contact-ack/preview');
      expectContract('post', '/v1/admin/email-templates/{key}/preview', 200, saved);

      expectContract(
        'post',
        '/v1/admin/email-templates/{key}/test',
        403,
        await write('manager', 'post', '/v1/admin/email-templates/quote-ack/test').send({
          email: 'x@example.com',
        }),
      );
      const test = await write('editor', 'post', '/v1/admin/email-templates/quote-ack/test').send({
        email: 'test@example.com',
      });
      expectContract('post', '/v1/admin/email-templates/{key}/test', 202, test);
      expect(test.body).toEqual({ message: 'E-mail de test envoyé à test@example.com.' });
      expect(mail.jobs).toEqual([
        expect.objectContaining({ template: 'quote-ack', to: 'test@example.com', lang: 'fr' }),
      ]);
      expect(JSON.stringify(rows('auditLog').at(-1))).not.toContain('test@example.com');
      const invalid = await write('editor', 'post', '/v1/admin/email-templates/quote-ack/test').send({
        email: 'pas-une-adresse',
      });
      expectContract('post', '/v1/admin/email-templates/{key}/test', 422, invalid);
      expect((invalid.body as Row)['type']).toBe(`${PROBLEMS}validation-error`);
    });
  });
});

describe.runIf(process.env['E2E_REAL_SERVICES'] === 'true')(
  'pages, zones, paramètres et e-mails du back-office (avec la base réelle)',
  () => {
    const mail = new MailQueueDouble();
    const throttler = new ResettableThrottlerStorage();
    const adminEmail = `admin-contenus-${Date.now().toString(36)}@mamboproxi.invalid`;
    let app: NestExpressApplication;
    let server: Server;
    let prisma: PrismaService;
    let admin: TestSession;
    let adminId = '';

    beforeAll(async () => {
      prepareContract('AdminPage', 'AdminZones', 'EmailTemplate', 'Problem');
      app = await createApp({ mail, throttler });
      server = app.getHttpServer();
      prisma = app.get(PrismaService);
      const now = new Date();
      const user = await prisma.user.create({
        data: {
          email: adminEmail,
          name: 'Admin Contenus',
          role: 'ADMIN',
          passwordHash: await new PasswordService().hash(PASSWORD),
          activatedAt: now,
          invitedAt: now,
        },
        select: { id: true },
      });
      adminId = user.id;
      admin = await signIn(server, mail, adminEmail);
    }, CONTRACT_WARM_UP_TIMEOUT);

    afterAll(async () => {
      await prisma.page.updateMany({ where: { updatedById: adminId }, data: { updatedById: null } });
      await prisma.auditLog.deleteMany({ where: { actorId: adminId } });
      await prisma.user.deleteMany({ where: { id: adminId } });
      await app.close();
    });

    it('lit les pages, zones, paramètres et modèles du seed', async () => {
      const pages = await admin.agent.get('/v1/admin/pages');
      expectContract('get', '/v1/admin/pages', 200, pages);
      expect((pages.body as Row[]).length).toBeGreaterThanOrEqual(16);
      expectContract('get', '/v1/admin/pages/{key}', 200, await admin.agent.get('/v1/admin/pages/accueil'));
      expectContract('get', '/v1/admin/zones', 200, await admin.agent.get('/v1/admin/zones'));
      for (const group of [
        'coordonnees',
        'whatsapp',
        'reseaux',
        'emails',
        'seo',
        'analytics',
        'chiffres',
        'rgpd',
        'securite',
      ]) {
        expectContract(
          'get',
          '/v1/admin/settings/{group}',
          200,
          await admin.agent.get(`/v1/admin/settings/${group}`),
        );
      }
      expectContract('get', '/v1/admin/system-status', 200, await admin.agent.get('/v1/admin/system-status'));
      const templates = await admin.agent.get('/v1/admin/email-templates');
      expectContract('get', '/v1/admin/email-templates', 200, templates);
      expect(templates.body).toHaveLength(21);
    });

    it('enregistre un brouillon de la page d’accueil tel que relu (aller-retour), puis l’abandonne', async () => {
      const page = (await admin.agent.get('/v1/admin/pages/accueil')).body as Row;
      const saved = await admin.agent
        .put('/v1/admin/pages/accueil')
        .set('X-CSRF-Token', admin.csrf)
        .send({ sections: page['sections'], seo: page['seo'] });
      expectContract('put', '/v1/admin/pages/{key}', 200, saved);
      expect((saved.body as Row)['sections']).toEqual(page['sections']);
      const discarded = await admin.agent
        .post('/v1/admin/pages/accueil/discard')
        .set('X-CSRF-Token', admin.csrf);
      expectContract('post', '/v1/admin/pages/{key}/discard', 200, discarded);
      expect((discarded.body as Row)['hasDraft']).toBe(false);
    });

    it('rend l’aperçu de chaque modèle d’e-mail', async () => {
      for (const key of ['quote-ack', 'team-new-request', 'otp-code', 'newsletter-campaign']) {
        const preview = await admin.agent
          .post(`/v1/admin/email-templates/${key}/preview`)
          .set('X-CSRF-Token', admin.csrf);
        expectContract('post', '/v1/admin/email-templates/{key}/preview', 200, preview);
      }
    });
  },
);
