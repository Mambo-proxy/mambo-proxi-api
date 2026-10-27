/**
 * Tests e2e des services et rubriques du back-office (`/v1/admin/services*`, `/v1/admin/categories*`) :
 * - « avec des doubles » : double de Prisma (`test/fixtures/content.ts`) ; permissions par rôle (MANAGER en lecture
 *   seule, AGENT sans accès), CSRF, création, sauvegarde automatique (`If-Match`), publication relue par les routes
 *   publiques, redirections, duplication, ordre, suppression, aperçu par jeton ;
 * - « avec la base réelle » : activés par `E2E_REAL_SERVICES=true` (base migrée et remplie par `pnpm db:seed`) ; une
 *   rubrique et un service de test sont créés, publiés, relus sur le site puis supprimés.
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

const slugsOf = (body: { data: Row[] }): unknown[] => body.data.map((item) => item['slug']);

describe('services et rubriques du back-office (avec des doubles)', () => {
  const mail = new MailQueueDouble();
  const throttler = new ResettableThrottlerStorage();
  let app: NestExpressApplication;
  let server: Server;
  let tables: PrismaTables;
  let fresh: PrismaTables;
  const sessions = {} as Record<Role, TestSession>;

  const rows = (name: keyof PrismaTables): Row[] => tables[name] ?? [];
  const find = (name: keyof PrismaTables, id: string): Row | undefined =>
    rows(name).find((row) => row['id'] === id);
  const write = (role: Role, method: 'post' | 'patch' | 'delete', path: string) =>
    sessions[role].agent[method](path).set('X-CSRF-Token', sessions[role].csrf);

  beforeAll(async () => {
    prepareContract('AdminService', 'AdminServiceListItem', 'AdminCategory', 'Completeness', 'Problem');
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

  describe('permissions', () => {
    it('ouvre la lecture aux rôles `content:read` et la refuse à l’AGENT (403)', async () => {
      for (const role of ['admin', 'manager', 'editor', 'writer'] as const) {
        expectContract(
          'get',
          '/v1/admin/services',
          200,
          await sessions[role].agent.get('/v1/admin/services'),
        );
      }
      const denied = await sessions.agent.agent.get('/v1/admin/services');
      expectContract('get', '/v1/admin/services', 403, denied);
      expect((denied.body as Row)['type']).toBe(`${PROBLEMS}forbidden`);
      expectContract(
        'get',
        '/v1/admin/categories',
        403,
        await sessions.agent.agent.get('/v1/admin/categories'),
      );
    });

    it('laisse le MANAGER en lecture seule sur les contenus (403 à chaque écriture)', async () => {
      const attempts: [string, () => request.Test][] = [
        [
          '/v1/admin/services',
          () =>
            write('manager', 'post', '/v1/admin/services').send({
              name: 'Essai',
              categoryId: 'cat_exp',
              tagline: 'x',
            }),
        ],
        [
          '/v1/admin/services/{id}',
          () => write('manager', 'patch', '/v1/admin/services/svc_chef').send({ showInMenu: false }),
        ],
        [
          '/v1/admin/services/{id}/publish',
          () => write('manager', 'post', '/v1/admin/services/svc_visites/publish'),
        ],
        [
          '/v1/admin/services/{id}/unpublish',
          () => write('manager', 'post', '/v1/admin/services/svc_chef/unpublish'),
        ],
        [
          '/v1/admin/services/{id}/duplicate',
          () => write('manager', 'post', '/v1/admin/services/svc_chef/duplicate'),
        ],
        ['/v1/admin/services/{id}', () => write('manager', 'delete', '/v1/admin/services/svc_visites')],
        [
          '/v1/admin/services/reorder',
          () => write('manager', 'patch', '/v1/admin/services/reorder').send({ ids: ['svc_chef'] }),
        ],
        ['/v1/admin/categories', () => write('manager', 'post', '/v1/admin/categories').send({ name: 'X' })],
        [
          '/v1/admin/categories/{id}',
          () => write('manager', 'patch', '/v1/admin/categories/cat_exp').send({ name: 'Y' }),
        ],
        ['/v1/admin/categories/{id}', () => write('manager', 'delete', '/v1/admin/categories/cat_vide')],
        [
          '/v1/admin/categories/reorder',
          () => write('manager', 'patch', '/v1/admin/categories/reorder').send({ ids: ['cat_exp'] }),
        ],
      ];
      for (const [path, attempt] of attempts) {
        const test = attempt();
        const method = test.method.toLowerCase();
        const response = await test;
        expectContract(method, path, 403, response);
        expect((response.body as Row)['type']).toBe(`${PROBLEMS}forbidden`);
      }
      expect(find('service', 'svc_chef')?.['showInMenu']).toBe(true);
      expect(rows('auditLog')).toHaveLength(0);
    });

    it('exige le jeton CSRF sur les mutations (403 csrf-token-invalid)', async () => {
      const response = await sessions.editor.agent.post('/v1/admin/services/svc_chef/duplicate');
      expectContract('post', '/v1/admin/services/{id}/duplicate', 403, response);
      expect((response.body as Row)['type']).toBe(`${PROBLEMS}csrf-token-invalid`);
    });
  });

  describe('GET /v1/admin/services', () => {
    it('liste les services par rubrique puis ordre, avec compteurs, demandes sur 30 jours et complétude', async () => {
      const response = await sessions.manager.agent.get('/v1/admin/services');
      expectContract('get', '/v1/admin/services', 200, response);
      const body = response.body as { data: Row[]; countsByCategory: Row };
      expect(slugsOf(body)).toEqual([
        'chef-prive',
        'massage-a-domicile',
        'visites-guidees-douala',
        'entretien-du-logement',
      ]);
      expect(body.countsByCategory).toEqual({ experience: 3, 'services-a-domicile': 1, 'rubrique-vide': 0 });
      expect(body.data[0]).toMatchObject({
        id: 'svc_chef',
        category: { slug: 'experience', name: 'Expérience' },
        path: '/services/experience/chef-prive',
        requests30d: 1,
        completeness: 100,
        status: 'PUBLISHED',
      });
      expect(body.data[2]).toMatchObject({ status: 'DRAFT', isDemo: true, requests30d: 0, completeness: 0 });
    });

    it('filtre par rubrique, statut et recherche (sans accents), compteurs calculés sans la rubrique', async () => {
      const list = async (query: string) => {
        const response = await sessions.writer.agent.get(`/v1/admin/services?${query}`);
        expectContract('get', '/v1/admin/services', 200, response);
        return response.body as { data: Row[]; countsByCategory: Row };
      };
      expect(slugsOf(await list('category=services-a-domicile'))).toEqual(['entretien-du-logement']);
      const drafts = await list('status=DRAFT');
      expect(slugsOf(drafts)).toEqual(['visites-guidees-douala']);
      expect(drafts.countsByCategory['experience']).toBe(1);
      expect(slugsOf(await list('q=GUIDEES'))).toEqual(['visites-guidees-douala']);
      expect(slugsOf(await list('q=experience/chef'))).toEqual(['chef-prive']);
    });

    it('refuse un statut inconnu (400 invalid-query)', async () => {
      const response = await sessions.manager.agent.get('/v1/admin/services?status=EN_LIGNE');
      expectContract('get', '/v1/admin/services', 400, response);
      expect((response.body as Row)['type']).toBe(`${PROBLEMS}invalid-query`);
    });
  });

  describe('détail, complétude', () => {
    it('renvoie le service à éditer (listes ordonnées, version) et son indicateur de complétude', async () => {
      const response = await sessions.writer.agent.get('/v1/admin/services/svc_chef');
      expectContract('get', '/v1/admin/services/{id}', 200, response);
      expect(response.body).toMatchObject({
        categoryId: 'cat_exp',
        galleryImageIds: ['m_small'],
        relatedServiceIds: ['svc_massage'],
        featuredReviewIds: ['rev_pub'],
        offers: [{ id: 'off_chef_1', title: 'Dîner à deux', action: 'QUOTE', serviceId: null, image: null }],
        coverImage: { id: 'm_hd', width: 1600 },
        version: 'v4',
        completenessDetail: { percent: 100 },
      });

      const completeness = await sessions.manager.agent.get('/v1/admin/services/svc_massage/completeness');
      expectContract('get', '/v1/admin/services/{id}/completeness', 200, completeness);
      expect(completeness.body).toEqual({
        percent: 0,
        criteria: [
          { key: 'general', label: 'Informations générales', done: false },
          { key: 'audiences', label: 'Public', done: false },
          { key: 'steps', label: 'Étapes', done: false },
          { key: 'advantages', label: 'Avantages', done: false },
          { key: 'faq', label: 'Questions fréquentes', done: false },
          { key: 'related', label: 'Services liés', done: false },
          { key: 'coverImage', label: 'Photo principale en haute définition', done: false },
        ],
      });
      expectContract(
        'get',
        '/v1/admin/services/{id}',
        404,
        await sessions.writer.agent.get('/v1/admin/services/inconnu'),
      );
    });
  });

  describe('POST /v1/admin/services', () => {
    it('crée un brouillon à la fin de la rubrique, slug et SEO pré-remplis, slug suffixé s’il est pris', async () => {
      const response = await write('editor', 'post', '/v1/admin/services').send({
        name: 'Chef privé',
        categoryId: 'cat_exp',
        tagline: 'Un autre chef',
        relatedServiceIds: ['svc_massage', 'svc_massage'],
      });
      expectContract('post', '/v1/admin/services', 201, response);
      const body = response.body as Row;
      expect(body).toMatchObject({
        slug: 'chef-prive-2',
        status: 'DRAFT',
        sortOrder: 4,
        seoTitle: 'Chef privé | MAMBO Proxi',
        seoDescription: 'Un autre chef',
        showInMenu: true,
        relatedServiceIds: ['svc_massage'],
        version: 'v1',
        path: '/services/experience/chef-prive-2',
      });
      expect(rows('auditLog').at(-1)).toMatchObject({
        action: 'service.create',
        actorId: ACCOUNTS.editor.id,
      });
      // Brouillon : rien à revalider sur le site.
      expect(rows('revalidationRequest')).toHaveLength(0);
    });

    it('refuse un slug choisi déjà pris (409) et signale les champs et références invalides (422)', async () => {
      const taken = await write('editor', 'post', '/v1/admin/services').send({
        name: 'Autre',
        categoryId: 'cat_exp',
        tagline: 'x',
        slug: 'chef-prive',
      });
      expectContract('post', '/v1/admin/services', 409, taken);
      expect((taken.body as Row)['errors']).toEqual([
        {
          path: 'slug',
          code: 'slug_taken',
          message: 'Cette adresse est déjà utilisée par un autre service.',
        },
      ]);

      const missing = await write('editor', 'post', '/v1/admin/services').send({ name: 'X' });
      expectContract('post', '/v1/admin/services', 422, missing);
      const paths = ((missing.body as Row)['errors'] as Row[]).map((error) => error['path']);
      expect(paths).toEqual(expect.arrayContaining(['name', 'categoryId', 'tagline']));

      const references = await write('editor', 'post', '/v1/admin/services').send({
        name: 'Nouveau service',
        categoryId: 'cat_inconnue',
        tagline: 'Accroche',
        coverImageId: 'media_inconnu',
        featuredReviewIds: ['rev_hidden'],
        relatedServiceIds: ['svc_inconnu'],
      });
      expectContract('post', '/v1/admin/services', 422, references);
      expect((references.body as Row)['errors']).toEqual([
        { path: 'categoryId', code: 'unknown_category', message: 'Cette rubrique n’existe pas.' },
        {
          path: 'coverImageId',
          code: 'unknown_media',
          message: 'Cette image n’existe pas dans la médiathèque.',
        },
        { path: 'relatedServiceIds.0', code: 'unknown_service', message: 'Ce service n’existe pas.' },
        { path: 'featuredReviewIds.0', code: 'unpublished_review', message: 'Choisissez un avis publié.' },
      ]);
    });
  });

  describe('PATCH /v1/admin/services/{id}', () => {
    it('enregistre (version incrémentée), refuse une version obsolète (412) et garde l’identifiant des offres', async () => {
      const stale = await write('editor', 'patch', '/v1/admin/services/svc_chef')
        .set('If-Match', 'v3')
        .send({ name: 'Chef à domicile' });
      expectContract('patch', '/v1/admin/services/{id}', 412, stale);
      expect((stale.body as Row)['type']).toBe(`${PROBLEMS}precondition-failed`);

      const saved = await write('editor', 'patch', '/v1/admin/services/svc_chef')
        .set('If-Match', '"v4"')
        .send({
          name: 'Chef à domicile',
          galleryImageIds: ['m_hd', 'm_small'],
          offers: [
            {
              id: 'off_chef_1',
              title: 'Dîner pour deux',
              text: 'Trois services.',
              action: 'BOOKING',
              actionLabel: 'Réserver',
            },
            {
              title: 'Brunch',
              text: 'Le dimanche.',
              action: 'QUOTE',
              actionLabel: 'Devis',
              serviceId: 'svc_massage',
            },
          ],
        });
      expectContract('patch', '/v1/admin/services/{id}', 200, saved);
      expect(saved.body).toMatchObject({
        name: 'Chef à domicile',
        version: 'v5',
        galleryImageIds: ['m_hd', 'm_small'],
        offers: [
          { id: 'off_chef_1', title: 'Dîner pour deux', action: 'BOOKING' },
          { title: 'Brunch', serviceId: 'svc_massage' },
        ],
      });
      // La traduction de l'offre conservée l'accompagne.
      expect(rows('serviceOffer').find((offer) => offer['id'] === 'off_chef_1')?.['translations']).toEqual({
        en: { title: 'Dinner for two' },
      });
      // Service publié : en ligne aussitôt (revalidation demandée), inscrit au journal.
      expect(rows('revalidationRequest').at(-1)?.['tags']).toEqual(
        expect.arrayContaining(['service:chef-prive', 'category:experience', 'navigation', 'services']),
      );
      expect(rows('auditLog').at(-1)).toMatchObject({ action: 'service.update', entityId: 'svc_chef' });

      const publicDetail = await request(server).get('/v1/services/chef-prive');
      expect(publicDetail.status).toBe(200);
      expect((publicDetail.body as Row)['name']).toBe('Chef à domicile');
    });

    it('crée une redirection 301 quand l’adresse d’un service publié change', async () => {
      const response = await write('editor', 'patch', '/v1/admin/services/svc_chef').send({
        slug: 'chef-a-domicile',
      });
      expectContract('patch', '/v1/admin/services/{id}', 200, response);
      const redirects = await request(server).get('/v1/site/redirects');
      expectContract('get', '/v1/site/redirects', 200, redirects);
      expect(redirects.body).toEqual([
        {
          from: '/services/experience/chef-prive',
          to: '/services/experience/chef-a-domicile',
          permanent: true,
        },
      ]);
      expect((await request(server).get('/v1/services/chef-a-domicile')).status).toBe(200);

      const moved = await write('editor', 'patch', '/v1/admin/services/svc_chef').send({
        categoryId: 'cat_dom',
      });
      expect(moved.body).toMatchObject({
        path: '/services/services-a-domicile/chef-a-domicile',
        sortOrder: 2,
      });
      expect((await request(server).get('/v1/site/redirects')).body).toEqual([
        {
          from: '/services/experience/chef-prive',
          to: '/services/services-a-domicile/chef-a-domicile',
          permanent: true,
        },
        {
          from: '/services/experience/chef-a-domicile',
          to: '/services/services-a-domicile/chef-a-domicile',
          permanent: true,
        },
      ]);

      const taken = await write('editor', 'patch', '/v1/admin/services/svc_massage').send({
        slug: 'entretien-du-logement',
      });
      expectContract('patch', '/v1/admin/services/{id}', 409, taken);
    });

    it('n’accepte pas une accroche vide pour un service publié, ni un corps vide (422)', async () => {
      const empty = await write('editor', 'patch', '/v1/admin/services/svc_chef').send({ tagline: '' });
      expectContract('patch', '/v1/admin/services/{id}', 422, empty);
      const nothing = await write('editor', 'patch', '/v1/admin/services/svc_chef').send({});
      expectContract('patch', '/v1/admin/services/{id}', 422, nothing);
      // Brouillon : l'accroche peut rester vide le temps de l'écrire.
      const draft = await write('editor', 'patch', '/v1/admin/services/svc_visites').send({ tagline: '' });
      expectContract('patch', '/v1/admin/services/{id}', 200, draft);
    });
  });

  describe('publication', () => {
    it('publie un brouillon : fiche, rubrique, liste et menu du site le montrent aussitôt', async () => {
      expect((await request(server).get('/v1/services/visites-guidees-douala')).status).toBe(404);
      const before = await request(server).get('/v1/services');

      const published = await write('editor', 'post', '/v1/admin/services/svc_visites/publish');
      expectContract('post', '/v1/admin/services/{id}/publish', 200, published);
      expect(published.body).toMatchObject({ status: 'PUBLISHED', version: 'v2' });
      expect((published.body as Row)['publishedAt']).toEqual(expect.any(String));
      expect(rows('auditLog').at(-1)).toMatchObject({
        action: 'service.publish',
        label: 'A publié le service « Visites guidées de Douala »',
      });

      expect((await request(server).get('/v1/services/visites-guidees-douala')).status).toBe(200);
      const after = await request(server).get('/v1/services');
      expect((after.body as Row[]).map((item) => item['slug'])).toContain('visites-guidees-douala');
      // Le cache HTTP public se revalide : l'ETag a changé avec le contenu.
      expect(after.headers['etag']).not.toBe(before.headers['etag']);
      const revalidated = await request(server)
        .get('/v1/services')
        .set('If-None-Match', String(before.headers['etag']));
      expect(revalidated.status).toBe(200);
      const navigation = await request(server).get('/v1/site/navigation');
      expect(JSON.stringify(navigation.body)).toContain('/services/experience/visites-guidees-douala');

      const unpublished = await write('editor', 'post', '/v1/admin/services/svc_visites/unpublish');
      expectContract('post', '/v1/admin/services/{id}/unpublish', 200, unpublished);
      expect((await request(server).get('/v1/services/visites-guidees-douala')).status).toBe(404);
    });

    it('exige nom et accroche pour publier (422)', async () => {
      const service = find('service', 'svc_visites');
      if (service) service['tagline'] = '';
      const response = await write('editor', 'post', '/v1/admin/services/svc_visites/publish');
      expectContract('post', '/v1/admin/services/{id}/publish', 422, response);
      expect(response.body).toMatchObject({
        detail: 'Complétez le nom, la rubrique et la phrase d’accroche avant de publier.',
        errors: [{ path: 'tagline', code: 'required', message: 'Écrivez une phrase d’accroche.' }],
      });
    });
  });

  describe('aperçu', () => {
    it('délivre un jeton de 30 min qui ouvre la fiche d’un brouillon sur le site, sans cache', async () => {
      const response = await sessions.writer.agent.get('/v1/admin/services/svc_visites/preview-token');
      expectContract('get', '/v1/admin/services/{id}/preview-token', 200, response);
      const body = response.body as { token: string; url: string; expiresAt: string };
      expect(body.url).toBe(
        `http://localhost:3000/services/experience/visites-guidees-douala?preview=${encodeURIComponent(body.token)}`,
      );
      expect(new Date(body.expiresAt).getTime() - Date.now()).toBeGreaterThan(29 * 60_000);

      const preview = await request(server).get(`/v1/services/visites-guidees-douala?preview=${body.token}`);
      expectContract('get', '/v1/services/{slug}', 200, preview);
      expect(preview.headers['cache-control']).toBe('private, no-store');
      // Un jeton ne vaut que pour son service ; un jeton altéré ne vaut rien.
      expect(
        (await request(server).get(`/v1/services/chef-prive?preview=${body.token}`)).headers['cache-control'],
      ).toBe('private, no-store');
      expect(
        (await request(server).get(`/v1/services/visites-guidees-douala?preview=${body.token}x`)).status,
      ).toBe(404);
      expect((await request(server).get('/v1/services/chef-prive')).headers['cache-control']).toBe(
        'public, no-cache',
      );
    });
  });

  describe('duplication, ordre, suppression', () => {
    it('duplique en brouillon hors menu, avec ses listes', async () => {
      const response = await write('editor', 'post', '/v1/admin/services/svc_chef/duplicate');
      expectContract('post', '/v1/admin/services/{id}/duplicate', 201, response);
      expect(response.body).toMatchObject({
        name: 'Chef privé (copie)',
        slug: 'chef-prive-copie',
        status: 'DRAFT',
        showInMenu: false,
        featuredOnHome: false,
        sortOrder: 4,
        galleryImageIds: ['m_small'],
        relatedServiceIds: ['svc_massage'],
        featuredReviewIds: ['rev_pub'],
        offers: [{ title: 'Dîner à deux' }],
      });
      expect(((response.body as Row)['offers'] as Row[])[0]?.['id']).not.toBe('off_chef_1');
      const again = await write('editor', 'post', '/v1/admin/services/svc_chef/duplicate');
      expect((again.body as Row)['slug']).toBe('chef-prive-copie-2');
    });

    it('réordonne une rubrique (204) et refuse un ordre mêlant deux rubriques (422)', async () => {
      const response = await write('editor', 'patch', '/v1/admin/services/reorder').send({
        scope: 'experience',
        ids: ['svc_visites', 'svc_chef'],
      });
      expectContract('patch', '/v1/admin/services/reorder', 204, response);
      expect(find('service', 'svc_visites')?.['sortOrder']).toBe(1);
      expect(find('service', 'svc_chef')?.['sortOrder']).toBe(2);

      const mixed = await write('editor', 'patch', '/v1/admin/services/reorder').send({
        ids: ['svc_chef', 'svc_menage'],
      });
      expectContract('patch', '/v1/admin/services/reorder', 422, mixed);
      const duplicate = await write('editor', 'patch', '/v1/admin/services/reorder').send({
        ids: ['svc_chef', 'svc_chef'],
      });
      expectContract('patch', '/v1/admin/services/reorder', 422, duplicate);
    });

    it('refuse de supprimer un service publié (409), supprime un brouillon (204)', async () => {
      const published = await write('editor', 'delete', '/v1/admin/services/svc_chef');
      expectContract('delete', '/v1/admin/services/{id}', 409, published);
      const draft = await write('editor', 'delete', '/v1/admin/services/svc_visites');
      expectContract('delete', '/v1/admin/services/{id}', 204, draft);
      expect(find('service', 'svc_visites')).toBeUndefined();
      expectContract(
        'delete',
        '/v1/admin/services/{id}',
        404,
        await write('editor', 'delete', '/v1/admin/services/svc_visites'),
      );
    });
  });

  describe('rubriques', () => {
    it('liste toutes les rubriques avec leur nombre de services', async () => {
      const response = await sessions.manager.agent.get('/v1/admin/categories');
      expectContract('get', '/v1/admin/categories', 200, response);
      expect(
        (response.body as Row[]).map((category) => [
          category['slug'],
          category['serviceCount'],
          category['tint'],
        ]),
      ).toEqual([
        ['experience', 3, 'orange-50'],
        ['services-a-domicile', 1, 'vert-50'],
        ['rubrique-vide', 0, 'neutral-100'],
      ]);
      expectContract(
        'get',
        '/v1/admin/categories/{id}',
        200,
        await sessions.writer.agent.get('/v1/admin/categories/cat_exp'),
      );
    });

    it('crée une rubrique (201) et refuse un slug déjà pris (409)', async () => {
      const response = await write('writer', 'post', '/v1/admin/categories').send({
        name: 'Culture & événementiel',
        tagline: 'Sortir à Douala',
        description: 'Concerts, expositions.',
        icon: 'Music',
        tint: 'neutral-900',
        offerSections: [
          {
            eyebrow: 'Nos offres',
            title: 'Les ==incontournables==',
            offers: [
              {
                title: 'Concert',
                text: 'Places réservées.',
                action: 'QUOTE',
                actionLabel: 'Devis',
                serviceId: 'svc_chef',
              },
            ],
          },
        ],
      });
      expectContract('post', '/v1/admin/categories', 201, response);
      expect(response.body).toMatchObject({
        slug: 'culture-evenementiel',
        status: 'DRAFT',
        sortOrder: 4,
        heroTitle: 'Culture & événementiel',
        tint: 'neutral-900',
        serviceCount: 0,
        offerSections: [
          { title: 'Les ==incontournables==', offers: [{ title: 'Concert', serviceId: 'svc_chef' }] },
        ],
      });

      const taken = await write('writer', 'post', '/v1/admin/categories').send({
        name: 'Autre',
        slug: 'experience',
        tagline: 'x',
        description: 'y',
        icon: 'Box',
        tint: 'vert-50',
      });
      expectContract('post', '/v1/admin/categories', 409, taken);
      const invalid = await write('writer', 'post', '/v1/admin/categories').send({
        name: 'Sans accroche',
        icon: 'pas-une-icone',
      });
      expectContract('post', '/v1/admin/categories', 422, invalid);
    });

    it('change le slug d’une rubrique publiée : redirections de la rubrique et de ses fiches', async () => {
      const response = await write('editor', 'patch', '/v1/admin/categories/cat_exp').send({
        slug: 'experiences',
      });
      expectContract('patch', '/v1/admin/categories/{id}', 200, response);
      const redirects = (await request(server).get('/v1/site/redirects')).body as Row[];
      expect(redirects).toEqual(
        expect.arrayContaining([
          { from: '/services/experience', to: '/services/experiences', permanent: true },
          {
            from: '/services/experience/chef-prive',
            to: '/services/experiences/chef-prive',
            permanent: true,
          },
          {
            from: '/services/experience/massage-a-domicile',
            to: '/services/experiences/massage-a-domicile',
            permanent: true,
          },
        ]),
      );
      expect(redirects).toHaveLength(3);
      const conflict = await write('editor', 'patch', '/v1/admin/categories/cat_dom').send({
        slug: 'experiences',
      });
      expectContract('patch', '/v1/admin/categories/{id}', 409, conflict);
    });

    it('supprime une rubrique vide (204), pas une rubrique qui a des services (409)', async () => {
      expectContract(
        'delete',
        '/v1/admin/categories/{id}',
        409,
        await write('editor', 'delete', '/v1/admin/categories/cat_exp'),
      );
      expectContract(
        'delete',
        '/v1/admin/categories/{id}',
        204,
        await write('editor', 'delete', '/v1/admin/categories/cat_vide'),
      );
      expectContract(
        'delete',
        '/v1/admin/categories/{id}',
        404,
        await write('editor', 'delete', '/v1/admin/categories/cat_vide'),
      );
    });

    it('réordonne les rubriques (204), refuse un identifiant inconnu (422)', async () => {
      const response = await write('editor', 'patch', '/v1/admin/categories/reorder').send({
        ids: ['cat_dom', 'cat_exp', 'cat_vide'],
      });
      expectContract('patch', '/v1/admin/categories/reorder', 204, response);
      expect(find('category', 'cat_dom')?.['sortOrder']).toBe(1);
      const list = await request(server).get('/v1/categories');
      expect((list.body as Row[]).map((category) => category['slug'])).toEqual([
        'services-a-domicile',
        'experience',
      ]);
      const unknown = await write('editor', 'patch', '/v1/admin/categories/reorder').send({
        ids: ['cat_inconnue'],
      });
      expectContract('patch', '/v1/admin/categories/reorder', 422, unknown);
    });
  });
});

describe.runIf(process.env['E2E_REAL_SERVICES'] === 'true')(
  'services et rubriques du back-office (avec la base réelle)',
  () => {
    const mail = new MailQueueDouble();
    const throttler = new ResettableThrottlerStorage();
    const suffix = Date.now().toString(36);
    const adminEmail = `admin-catalogue-${suffix}@mamboproxi.invalid`;
    let app: NestExpressApplication;
    let server: Server;
    let prisma: PrismaService;
    let admin: TestSession;
    let adminId = '';
    let categoryId = '';
    let serviceId = '';

    beforeAll(async () => {
      prepareContract('AdminService', 'AdminCategory', 'Problem');
      app = await createApp({ mail, throttler });
      server = app.getHttpServer();
      prisma = app.get(PrismaService);
      const now = new Date();
      const user = await prisma.user.create({
        data: {
          email: adminEmail,
          name: 'Admin Catalogue',
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
      if (serviceId !== '') await prisma.service.deleteMany({ where: { id: serviceId } });
      if (categoryId !== '') await prisma.category.deleteMany({ where: { id: categoryId } });
      await prisma.revalidationRequest.deleteMany({ where: { tags: { has: `category:essai-${suffix}` } } });
      await prisma.auditLog.deleteMany({ where: { actorId: adminId } });
      await prisma.user.deleteMany({ where: { id: adminId } });
      await app.close();
    });

    it('liste les services du seed avec leurs compteurs', async () => {
      const response = await admin.agent.get('/v1/admin/services');
      expectContract('get', '/v1/admin/services', 200, response);
      expect((response.body as { data: Row[] }).data.length).toBeGreaterThanOrEqual(19);
      expectContract('get', '/v1/admin/categories', 200, await admin.agent.get('/v1/admin/categories'));
    });

    it('crée, publie, relit sur le site, dépublie et supprime un service de test', async () => {
      const category = await admin.agent
        .post('/v1/admin/categories')
        .set('X-CSRF-Token', admin.csrf)
        .send({
          name: `Essai ${suffix}`,
          slug: `essai-${suffix}`,
          tagline: 'Rubrique de test',
          description: 'Créée par les tests e2e.',
          icon: 'Box',
          tint: 'neutral-100',
          status: 'PUBLISHED',
        });
      expectContract('post', '/v1/admin/categories', 201, category);
      categoryId = String((category.body as Row)['id']);

      const created = await admin.agent
        .post('/v1/admin/services')
        .set('X-CSRF-Token', admin.csrf)
        .send({ name: `Service ${suffix}`, categoryId, tagline: 'Service de test' });
      expectContract('post', '/v1/admin/services', 201, created);
      serviceId = String((created.body as Row)['id']);
      const slug = String((created.body as Row)['slug']);

      const saved = await admin.agent
        .patch(`/v1/admin/services/${serviceId}`)
        .set('X-CSRF-Token', admin.csrf)
        .set('If-Match', String((created.body as Row)['version']))
        .send({ summary: 'Résumé', audiences: ['Particuliers'], steps: [{ title: 'Étape', text: 'Texte' }] });
      expectContract('patch', '/v1/admin/services/{id}', 200, saved);

      const published = await admin.agent
        .post(`/v1/admin/services/${serviceId}/publish`)
        .set('X-CSRF-Token', admin.csrf);
      expectContract('post', '/v1/admin/services/{id}/publish', 200, published);
      expectContract('get', '/v1/services/{slug}', 200, await request(server).get(`/v1/services/${slug}`));

      const unpublished = await admin.agent
        .post(`/v1/admin/services/${serviceId}/unpublish`)
        .set('X-CSRF-Token', admin.csrf);
      expectContract('post', '/v1/admin/services/{id}/unpublish', 200, unpublished);
      expect((await request(server).get(`/v1/services/${slug}`)).status).toBe(404);

      const removed = await admin.agent
        .delete(`/v1/admin/services/${serviceId}`)
        .set('X-CSRF-Token', admin.csrf);
      expectContract('delete', '/v1/admin/services/{id}', 204, removed);
      serviceId = '';
      const removedCategory = await admin.agent
        .delete(`/v1/admin/categories/${categoryId}`)
        .set('X-CSRF-Token', admin.csrf);
      expectContract('delete', '/v1/admin/categories/{id}', 204, removedCategory);
      categoryId = '';
    });
  },
);
