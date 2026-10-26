/**
 * Tests e2e de `GET /v1/health` sur l'application NestJS complète (supertest), réponses validées contre le contrat.
 *
 * - « avec des doubles » : la base et Redis sont remplacés par des doubles ; ces tests tournent partout,
 *   sans service démarré, et couvrent les cas 200 et 503.
 * - « avec les services réels » : activés par `E2E_REAL_SERVICES=true` (CI, ou en local après
 *   `pnpm services:up`) ; ils interrogent PostgreSQL et Redis via `DATABASE_URL` et `REDIS_URL`.
 */
import type { Server } from 'node:http';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { RedisHealthIndicator } from '../src/health/redis.health.js';
import type { DependencyState } from '../src/health/health.types.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { expectToMatchContract, expectToMatchSchema } from './contract.js';

interface Doubles {
  database: DependencyState;
  redis: DependencyState;
}

async function createApp(doubles?: Doubles): Promise<NestExpressApplication> {
  let builder = Test.createTestingModule({ imports: [AppModule] });
  if (doubles) {
    const queryRaw =
      doubles.database === 'up'
        ? vi.fn().mockResolvedValue([{ '?column?': 1 }])
        : vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:5432'));
    builder = builder
      .overrideProvider(PrismaService)
      .useValue({ $queryRaw: queryRaw, $disconnect: vi.fn().mockResolvedValue(undefined) })
      .overrideProvider(RedisHealthIndicator)
      .useValue({ check: vi.fn().mockResolvedValue(doubles.redis) });
  }
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(app);
  await app.init();
  return app;
}

function server(app: NestExpressApplication): Server {
  return app.getHttpServer();
}

describe('GET /v1/health (avec des doubles)', () => {
  let app: NestExpressApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('répond 200 « ok » quand toutes les dépendances répondent', async () => {
    app = await createApp({ database: 'up', redis: 'up' });

    const response = await request(server(app)).get('/v1/health');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/^application\/json/);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toEqual({
      status: 'ok',
      version: expect.any(String) as unknown,
      checks: { database: 'up', redis: 'up' },
    });
    expectToMatchContract('get', '/v1/health', 200, response);
  });

  it('répond 503 « down » quand la base de données est indisponible', async () => {
    app = await createApp({ database: 'down', redis: 'up' });

    const response = await request(server(app)).get('/v1/health');

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({ status: 'down', checks: { database: 'down', redis: 'up' } });
    expectToMatchContract('get', '/v1/health', 503, response);
  });

  it('répond 503 « degraded » quand seul Redis est indisponible', async () => {
    app = await createApp({ database: 'up', redis: 'down' });

    const response = await request(server(app)).get('/v1/health');

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({ status: 'degraded', checks: { database: 'up', redis: 'down' } });
    expectToMatchContract('get', '/v1/health', 503, response);
  });

  it("reprend l'identifiant de requête reçu, ou en génère un", async () => {
    app = await createApp({ database: 'up', redis: 'up' });

    const forwarded = await request(server(app)).get('/v1/health').set('X-Request-Id', 'essai-1234');
    const generated = await request(server(app)).get('/v1/health');
    const rejected = await request(server(app))
      .get('/v1/health')
      .set('X-Request-Id', 'avec espace et <balise>');

    expect(forwarded.headers['x-request-id']).toBe('essai-1234');
    expect(generated.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(rejected.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('expose les en-têtes de limitation de débit du contrat', async () => {
    app = await createApp({ database: 'up', redis: 'up' });

    const response = await request(server(app)).get('/v1/health');

    expect(response.headers['ratelimit-limit']).toBeDefined();
    expect(response.headers['ratelimit-remaining']).toBeDefined();
  });

  it("n'autorise en CORS que l'origine du site, avec les cookies", async () => {
    app = await createApp({ database: 'up', redis: 'up' });

    const allowed = await request(server(app)).get('/v1/health').set('Origin', 'http://localhost:3000');
    const other = await request(server(app)).get('/v1/health').set('Origin', 'https://exemple.invalid');

    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');
    expect(other.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('répond aux routes inconnues par un 404 au format Problem', async () => {
    app = await createApp({ database: 'up', redis: 'up' });

    const response = await request(server(app)).get('/v1/route-inconnue');

    expect(response.status).toBe(404);
    expect(response.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(response.body).toEqual({
      type: 'https://api.mamboproxi.com/problems/not-found',
      title: 'Introuvable',
      status: 404,
      detail: "La ressource demandée n'existe pas ou n'est plus disponible.",
    });
    expectToMatchSchema('Problem', response.body);
  });

  it('répond à un JSON illisible par un 400 invalid-body', async () => {
    app = await createApp({ database: 'up', redis: 'up' });

    const response = await request(server(app))
      .post('/v1/health')
      .set('Content-Type', 'application/json')
      .send('{"incomplet":');

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      type: 'https://api.mamboproxi.com/problems/invalid-body',
      status: 400,
    });
    expectToMatchSchema('Problem', response.body);
  });
});

describe.runIf(process.env['E2E_REAL_SERVICES'] === 'true')(
  'GET /v1/health (avec les services réels)',
  () => {
    let app: NestExpressApplication;

    beforeAll(async () => {
      app = await createApp();
    });

    afterAll(async () => {
      await app.close();
    });

    it('répond 200 « ok » avec PostgreSQL et Redis joignables', async () => {
      const response = await request(server(app)).get('/v1/health');

      expect(response.body).toMatchObject({ status: 'ok', checks: { database: 'up', redis: 'up' } });
      expect(response.status).toBe(200);
      expectToMatchContract('get', '/v1/health', 200, response);
    });
  },
);
