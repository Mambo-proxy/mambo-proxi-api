/**
 * Tests e2e des contacts du back-office (`/v1/admin/contacts*`) :
 * - « avec des doubles » : double de Prisma (`test/fixtures/back-office.ts`) ; permissions par rôle, filtres,
 *   indicateurs, export CSV, fiche, export RGPD, droit à l'effacement ;
 * - « avec la base réelle » : activés par `E2E_REAL_SERVICES=true` (base migrée et remplie par `pnpm db:seed`) ; un
 *   contact de test est créé, exporté puis effacé.
 * Chaque réponse est validée contre le contrat.
 */
import type { Server } from 'node:http';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { doualaDate } from '../src/common/time/agency-day.js';
import { PasswordService } from '../src/modules/auth/password.service.js';
import { contactSearchKeys } from '../src/modules/contacts/contact.mapper.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { CONTRACT_WARM_UP_TIMEOUT, expectToMatchContract, prepareContract } from './contract.js';
import {
  backOfficeClock,
  backOfficeTables,
  resetBackOffice,
  type BackOfficeClock,
} from './fixtures/back-office.js';
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
type ListBody = { data: Row[]; meta: Row; stats: Row };

const BOM = String.fromCharCode(0xfeff);

const ids = (body: ListBody): unknown[] => body.data.map((item) => item['id']);

function csvResponse(response: request.Response): { status: number; headers: Row; body: string } {
  return { status: response.status, headers: response.headers, body: response.text };
}

describe('contacts du back-office (avec des doubles)', () => {
  const mail = new MailQueueDouble();
  const throttler = new ResettableThrottlerStorage();
  let app: NestExpressApplication;
  let server: Server;
  let tables: PrismaTables;
  let fresh: PrismaTables;
  let clock: BackOfficeClock;
  const sessions = {} as Record<'admin' | 'manager' | 'agent' | 'editor' | 'writer', TestSession>;

  const rows = (name: keyof PrismaTables): Row[] => tables[name] ?? [];
  const find = (name: keyof PrismaTables, id: string): Row | undefined =>
    rows(name).find((row) => row['id'] === id);

  beforeAll(async () => {
    prepareContract('AdminContactListItem', 'AdminContact', 'ContactStats', 'Problem');
    const passwordHash = await new PasswordService().hash(PASSWORD);
    clock = backOfficeClock();
    fresh = backOfficeTables(passwordHash, clock);
    tables = backOfficeTables(passwordHash, clock);
    app = await createApp({ mail, throttler, tables });
    server = app.getHttpServer();
    for (const role of ['admin', 'manager', 'agent', 'editor', 'writer'] as const)
      sessions[role] = await signIn(server, mail, ACCOUNTS[role].email);
  }, CONTRACT_WARM_UP_TIMEOUT);

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    resetBackOffice(tables, fresh);
    mail.reset();
    throttler.reset();
  });

  describe('GET /v1/admin/contacts', () => {
    it('liste les contacts du plus récent au plus ancien, avec les indicateurs (200)', async () => {
      const response = await sessions.manager.agent.get('/v1/admin/contacts');

      expectContract('get', '/v1/admin/contacts', 200, response);
      const body = response.body as ListBody;
      expect(ids(body)).toEqual(['ctc_aurelie', 'ctc_saveurs', 'ctc_grace', 'ctc_herve', 'ctc_samuel']);
      expect(body.meta).toEqual({ page: 1, pageSize: 20, total: 5, totalPages: 1 });
      expect(body.stats).toEqual({
        total: 5,
        individuals: 4,
        professionals: 1,
        newsletterSubscribers: 1,
        newThisMonth: 3,
        byCountry: { CM: 4, FR: 1 },
        locations: { douala: 3, surroundings: 1, elsewhere: 1 },
      });
      expect(body.data[0]).toEqual({
        id: 'ctc_aurelie',
        fullName: 'Aurélie Kamga',
        initials: 'AK',
        email: 'aurelie.k@example.com',
        phone: '+237612345678',
        country: 'CM',
        city: 'Bonapriso, Douala',
        profile: 'PARTICULIER',
        organization: null,
        interests: [{ slug: 'experience', name: 'Expérience' }],
        requestsCount: 2,
        newsletterStatus: 'CONFIRME',
        source: 'devis',
        createdAt: clock.at(-2 * 86_400_000).toISOString(),
      });
      expect(body.data[1]).toMatchObject({
        profile: 'PROFESSIONNEL',
        organization: 'Saveurs de Douala',
        interests: [
          { slug: 'immobilier', name: 'Immobilier' },
          { slug: 'experience', name: 'Expérience' },
        ],
        newsletterStatus: null,
      });
      // La demande anonymisée de Grâce Abena n'est plus comptée.
      expect(body.data[2]).toMatchObject({ id: 'ctc_grace', requestsCount: 0 });
    });

    it('filtre par profil, pays, quartier, rubrique et recherche (sans accents ni casse)', async () => {
      const list = async (query: string): Promise<ListBody> => {
        const response = await sessions.editor.agent.get(`/v1/admin/contacts?${query}`);
        expectContract('get', '/v1/admin/contacts', 200, response);
        return response.body as ListBody;
      };

      const pros = await list('profile=PROFESSIONNEL');
      expect(ids(pros)).toEqual(['ctc_saveurs']);
      // Indicateurs indépendants des filtres.
      expect(pros.stats['total']).toBe(5);
      expect(ids(await list('country=FR'))).toEqual(['ctc_samuel']);
      expect(ids(await list('district=MAKEPE'))).toEqual(['ctc_herve']);
      expect(ids(await list('interest=immobilier'))).toEqual(['ctc_saveurs']);
      expect(ids(await list('interest=experience'))).toEqual(['ctc_aurelie', 'ctc_saveurs']);
      expect(ids(await list('q=GRACE'))).toEqual(['ctc_grace']);
      expect(ids(await list('q=saveurs-douala'))).toEqual(['ctc_saveurs']);
      const page = await list('sort=fullName&page=2&pageSize=2');
      expect(ids(page)).toEqual(['ctc_herve', 'ctc_samuel']);
      expect(page.meta).toEqual({ page: 2, pageSize: 2, total: 5, totalPages: 3 });
    });

    it('refuse des paramètres invalides (400) et les rôles sans `contacts:read` (403)', async () => {
      for (const query of ['profile=ENTREPRISE', 'country=france', 'sort=email', 'pageSize=0']) {
        const response = await sessions.admin.agent.get(`/v1/admin/contacts?${query}`);
        expectContract('get', '/v1/admin/contacts', 400, response);
        expect((response.body as Row)['type']).toBe(`${PROBLEMS}invalid-query`);
      }
      for (const session of [sessions.agent, sessions.writer])
        expectContract('get', '/v1/admin/contacts', 403, await session.agent.get('/v1/admin/contacts'));
      expectContract('get', '/v1/admin/contacts', 401, await request(server).get('/v1/admin/contacts'));
    });
  });

  describe('GET /v1/admin/contacts/export.csv', () => {
    it('exporte les contacts filtrés avec les colonnes du back-office et l’inscrit au journal', async () => {
      const response = await sessions.editor.agent.get('/v1/admin/contacts/export.csv?country=CM');

      expect(response.status).toBe(200);
      expectToMatchContract('get', '/v1/admin/contacts/export.csv', 200, csvResponse(response));
      expect(response.headers['content-type']).toBe('text/csv; charset=utf-8');
      expect(response.headers['content-disposition']).toBe(
        `attachment; filename="contacts-${doualaDate(new Date())}.csv"`,
      );
      const lines = response.text.split('\r\n');
      expect(lines[0]).toBe(
        `${BOM}"Nom";"Structure";"E-mail";"Téléphone";"Profil";"Ville";"Pays";"Intérêts";"Demandes";"Newsletter";"Créé le"`,
      );
      expect(lines).toHaveLength(5);
      expect(lines[1]).toBe(
        `"Aurélie Kamga";"";"aurelie.k@example.com";"+237612345678";"Particulier";"Bonapriso, Douala";"CM";"Expérience";"2";"Abonné";"${doualaDate(clock.at(-2 * 86_400_000))}"`,
      );
      expect(lines[2]).toContain(
        '"Saveurs de Douala";"Saveurs de Douala";"contact@saveurs-douala.example.com";"+237655443322";"Professionnel";"Akwa, Douala";"CM";"Immobilier, Expérience";"1";"Non"',
      );
      expect(rows('auditLog').at(-1)).toMatchObject({
        action: 'contact.export',
        actorId: ACCOUNTS.editor.id,
        label: 'A exporté 4 contacts (CSV)',
      });
    });

    it('est réservé à `contacts:export` (AGENT, WRITER : 403)', async () => {
      for (const session of [sessions.agent, sessions.writer])
        expectContract(
          'get',
          '/v1/admin/contacts/export.csv',
          403,
          await session.agent.get('/v1/admin/contacts/export.csv'),
        );
    });
  });

  describe('GET /v1/admin/contacts/{id}', () => {
    it('renvoie la fiche : demandes, rendez-vous et abonnement (200)', async () => {
      const response = await sessions.manager.agent.get('/v1/admin/contacts/ctc_aurelie');

      expectContract('get', '/v1/admin/contacts/{id}', 200, response);
      const body = response.body as Row & { requests: Row[]; subscriber: Row };
      expect(body.requests.map((item) => item['id'])).toEqual(['req_0142', 'req_0120']);
      expect(body).toMatchObject({ preferredChannel: 'WHATSAPP', activity: null, appointments: [] });
      expect(body.subscriber).toEqual({
        id: 'sub_aurelie',
        email: 'aurelie.k@example.com',
        name: 'Aurélie Kamga',
        phone: '+237612345678',
        country: 'CM',
        status: 'CONFIRME',
        tags: ['experience'],
        source: 'footer',
        confirmedAt: clock.at(-2 * 86_400_000).toISOString(),
        unsubscribedAt: null,
        createdAt: clock.at(-2 * 86_400_000).toISOString(),
      });

      const samuel = await sessions.manager.agent.get('/v1/admin/contacts/ctc_samuel');
      expectContract('get', '/v1/admin/contacts/{id}', 200, samuel);
      expect((samuel.body as { appointments: Row[] }).appointments.map((item) => item['id'])).toEqual([
        'apt_7',
      ]);
      expect((samuel.body as { subscriber: Row }).subscriber).toMatchObject({ source: 'suivi-mambo' });
    });

    it('répond 404 pour un contact inconnu et 403 sans `contacts:read`', async () => {
      const unknown = await sessions.admin.agent.get('/v1/admin/contacts/ctc_inconnu');
      expectContract('get', '/v1/admin/contacts/{id}', 404, unknown);
      expect((unknown.body as Row)['detail']).toBe('Ce contact n’existe plus.');
      expectContract(
        'get',
        '/v1/admin/contacts/{id}',
        403,
        await sessions.agent.agent.get('/v1/admin/contacts/ctc_aurelie'),
      );
    });
  });

  describe('GET /v1/admin/contacts/{id}/export', () => {
    it('exporte toutes les données de la personne, sans les notes internes (200)', async () => {
      const response = await sessions.admin.agent.get('/v1/admin/contacts/ctc_saveurs/export');

      expectContract('get', '/v1/admin/contacts/{id}/export', 200, response);
      expect(response.headers['content-disposition']).toBe('attachment; filename="donnees-ctc_saveurs.json"');
      expect(response.headers['cache-control']).toBe('no-store');
      const body = response.body as { contact: Row; requests: Row[]; newsletter: unknown };
      expect(body.contact).toMatchObject({
        id: 'ctc_saveurs',
        organization: 'Saveurs de Douala',
        district: 'Akwa',
      });
      expect(body.requests).toHaveLength(1);
      expect(body.requests[0]).toMatchObject({
        typeLabel: 'Contact',
        message: 'Pouvez-vous nous rappeler ?',
        consent: { ip: '203.0.113.7', userAgent: 'Mozilla/5.0' },
      });
      expect(JSON.stringify(body)).not.toContain('Rappeler demain matin.');
      expect(body.newsletter).toBeNull();
      expect(rows('auditLog').at(-1)).toMatchObject({
        action: 'contact.export-data',
        entityId: 'ctc_saveurs',
      });
    });

    it('est réservé à `contacts:export` (AGENT : 403) et répond 404 pour un contact inconnu', async () => {
      expectContract(
        'get',
        '/v1/admin/contacts/{id}/export',
        403,
        await sessions.agent.agent.get('/v1/admin/contacts/ctc_saveurs/export'),
      );
      expectContract(
        'get',
        '/v1/admin/contacts/{id}/export',
        404,
        await sessions.admin.agent.get('/v1/admin/contacts/ctc_inconnu/export'),
      );
    });
  });

  describe('DELETE /v1/admin/contacts/{id}', () => {
    it('efface la fiche, anonymise ses demandes et son abonnement (204)', async () => {
      const response = await sessions.editor.agent
        .delete('/v1/admin/contacts/ctc_aurelie')
        .set('X-CSRF-Token', sessions.editor.csrf);

      expectContract('delete', '/v1/admin/contacts/{id}', 204, response);
      expect(find('contact', 'ctc_aurelie')).toMatchObject({
        email: 'efface-ctc_aurelie@mamboproxi.invalid',
        fullName: 'Contact effacé',
        phone: null,
        city: null,
        searchText: '',
        anonymizedAt: expect.any(Date) as unknown,
      });
      for (const id of ['req_0142', 'req_0120'])
        expect(find('request', id)).toMatchObject({
          contactId: 'ctc_aurelie',
          message: null,
          ip: null,
          anonymizedAt: expect.any(Date) as unknown,
        });
      expect(find('subscriber', 'sub_aurelie')).toMatchObject({
        email: 'efface-sub_aurelie@mamboproxi.invalid',
        name: null,
        status: 'DESINSCRIT',
        tags: [],
      });
      expect(rows('contactInterest').filter((row) => row['contactId'] === 'ctc_aurelie')).toHaveLength(0);
      const audit = rows('auditLog').at(-1);
      expect(audit).toMatchObject({ action: 'contact.erase', entityId: 'ctc_aurelie' });
      expect(JSON.stringify(audit)).not.toContain('Aurélie');

      expectContract(
        'get',
        '/v1/admin/contacts/{id}',
        404,
        await sessions.editor.agent.get('/v1/admin/contacts/ctc_aurelie'),
      );
      const list = await sessions.editor.agent.get('/v1/admin/contacts');
      expect(ids(list.body as ListBody)).not.toContain('ctc_aurelie');
      expect((list.body as ListBody).stats).toMatchObject({ total: 4, newsletterSubscribers: 0 });
      const requests = await sessions.editor.agent.get('/v1/admin/requests');
      expect((requests.body as { data: Row[] }).data.map((item) => item['id'])).not.toContain('req_0142');
    });

    it('exige `contacts:write` (WRITER, AGENT : 403), le jeton CSRF et un contact existant (404)', async () => {
      for (const session of [sessions.writer, sessions.agent])
        expectContract(
          'delete',
          '/v1/admin/contacts/{id}',
          403,
          await session.agent.delete('/v1/admin/contacts/ctc_herve').set('X-CSRF-Token', session.csrf),
        );
      const noCsrf = await sessions.admin.agent.delete('/v1/admin/contacts/ctc_herve');
      expectContract('delete', '/v1/admin/contacts/{id}', 403, noCsrf);
      expect((noCsrf.body as Row)['type']).toBe(`${PROBLEMS}csrf-token-invalid`);
      expectContract(
        'delete',
        '/v1/admin/contacts/{id}',
        404,
        await sessions.admin.agent
          .delete('/v1/admin/contacts/ctc_inconnu')
          .set('X-CSRF-Token', sessions.admin.csrf),
      );
      expect(find('contact', 'ctc_herve')).toMatchObject({ anonymizedAt: null });
    });
  });
});

describe.runIf(process.env['E2E_REAL_SERVICES'] === 'true')(
  'contacts du back-office (avec la base réelle, remplie par le seed)',
  () => {
    const mail = new MailQueueDouble();
    const throttler = new ResettableThrottlerStorage();
    const runId = String(Date.now());
    const adminEmail = `e2e.contacts.${runId}@example.com`;
    const contactEmail = `e2e.fiche.${runId}@example.com`;
    let app: NestExpressApplication;
    let server: Server;
    let prisma: PrismaService;
    let admin: TestSession;
    let adminId: string;
    let contactId: string;

    beforeAll(async () => {
      prepareContract('AdminContactListItem', 'AdminContact', 'ContactStats', 'Problem');
      app = await createApp({ mail, throttler });
      server = app.getHttpServer();
      prisma = app.get(PrismaService);
      const now = new Date();
      const user = await prisma.user.create({
        data: {
          email: adminEmail,
          name: 'Admin Contacts',
          role: 'ADMIN',
          passwordHash: await new PasswordService().hash(PASSWORD),
          activatedAt: now,
          invitedAt: now,
        },
        select: { id: true },
      });
      adminId = user.id;
      const contact = await prisma.contact.create({
        data: {
          email: contactEmail,
          fullName: 'Éric Essai',
          city: 'Bépanda, Douala',
          country: 'CM',
          ...contactSearchKeys({ fullName: 'Éric Essai', email: contactEmail, city: 'Bépanda, Douala' }),
        },
        select: { id: true },
      });
      contactId = contact.id;
      admin = await signIn(server, mail, adminEmail);
    }, CONTRACT_WARM_UP_TIMEOUT);

    afterAll(async () => {
      await prisma.contact.deleteMany({ where: { id: contactId } });
      await prisma.auditLog.deleteMany({ where: { actorId: adminId } });
      await prisma.user.deleteMany({ where: { id: adminId } });
      await app.close();
    });

    it('liste les contacts du seed avec les indicateurs de la maquette', async () => {
      const list = await admin.agent.get('/v1/admin/contacts?pageSize=6');
      expectContract('get', '/v1/admin/contacts', 200, list);
      const body = list.body as ListBody;
      expect(body.stats['professionals']).toBeGreaterThanOrEqual(174);
      expect(Number(body.stats['total'])).toBeGreaterThanOrEqual(1486);

      const search = await admin.agent.get('/v1/admin/contacts?q=eric%20essai&district=bepanda');
      expectContract('get', '/v1/admin/contacts', 200, search);
      expect(ids(search.body as ListBody)).toEqual([contactId]);

      const seeded = body.data[0];
      expectContract(
        'get',
        '/v1/admin/contacts/{id}',
        200,
        await admin.agent.get(`/v1/admin/contacts/${String(seeded?.['id'])}`),
      );
      const csv = await admin.agent.get('/v1/admin/contacts/export.csv?profile=PROFESSIONNEL');
      expect(csv.status).toBe(200);
      expect(csv.text.split('\r\n').length).toBeGreaterThan(174);
    });

    it('exporte puis efface le contact de test', async () => {
      const exported = await admin.agent.get(`/v1/admin/contacts/${contactId}/export`);
      expectContract('get', '/v1/admin/contacts/{id}/export', 200, exported);

      const erased = await admin.agent
        .delete(`/v1/admin/contacts/${contactId}`)
        .set('X-CSRF-Token', admin.csrf);
      expectContract('delete', '/v1/admin/contacts/{id}', 204, erased);
      expectContract(
        'get',
        '/v1/admin/contacts/{id}',
        404,
        await admin.agent.get(`/v1/admin/contacts/${contactId}`),
      );
      const row = await prisma.contact.findUnique({ where: { id: contactId }, select: { email: true } });
      expect(row?.email).toBe(`efface-${contactId}@mamboproxi.invalid`);
    });
  },
);
