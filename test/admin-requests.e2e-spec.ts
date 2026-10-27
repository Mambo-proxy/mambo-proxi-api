/**
 * Tests e2e des demandes du back-office (`/v1/admin/requests*`) et de « Mes tâches » (`/v1/admin/me/tasks`) :
 * - « avec des doubles » : double de Prisma (`test/fixtures/back-office.ts`), file des e-mails simulée ; permissions
 *   par rôle, filtres, tri, pagination, export CSV, statut, assignation, notes, duplication, anonymisation ;
 * - « avec la base réelle » : activés par `E2E_REAL_SERVICES=true` (base migrée et remplie par `pnpm db:seed`) ; une
 *   demande de test est créée, traitée puis supprimée.
 * Chaque réponse est validée contre le contrat.
 */
import type { Server } from 'node:http';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { doualaDate } from '../src/common/time/agency-day.js';
import { PasswordService } from '../src/modules/auth/password.service.js';
import { formatReference, referenceYear } from '../src/modules/requests/reference.js';
import { requestSearchText } from '../src/modules/requests/request-search.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { CONTRACT_WARM_UP_TIMEOUT, expectToMatchContract, prepareContract } from './contract.js';
import {
  FORMULA_SUBJECT,
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
type ListBody = { data: Row[]; meta: Row; counts: Row };

const BOM = String.fromCharCode(0xfeff);

const ids = (body: ListBody): unknown[] => body.data.map((item) => item['id']);

/** Réponse CSV : le corps est le texte brut (schéma `{ type: string }` du contrat). */
function csvResponse(response: request.Response): { status: number; headers: Row; body: string } {
  return { status: response.status, headers: response.headers, body: response.text };
}

describe('demandes du back-office (avec des doubles)', () => {
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
  const ref = (number: number): string => formatReference(referenceYear(new Date(clock.now)), number);

  beforeAll(async () => {
    prepareContract('RequestListItem', 'RequestDetail', 'RequestNote', 'MyTasks', 'Problem');
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

  describe('GET /v1/admin/requests', () => {
    it('liste les demandes, des plus récentes aux plus anciennes, avec les compteurs (200)', async () => {
      const response = await sessions.admin.agent.get('/v1/admin/requests');

      expectContract('get', '/v1/admin/requests', 200, response);
      const body = response.body as ListBody;
      // La demande anonymisée n'apparaît plus.
      expect(ids(body)).toEqual(['req_0142', 'req_0156', 'req_0151', 'req_0157', 'req_0120']);
      expect(body.meta).toEqual({ page: 1, pageSize: 20, total: 5, totalPages: 1 });
      expect(body.counts).toEqual({ ALL: 5, NOUVELLE: 2, EN_COURS: 2, PRESTATION_REALISEE: 0, CLOTUREE: 1 });
      expect(body.data[0]).toEqual({
        id: 'req_0142',
        reference: ref(142),
        type: 'DEVIS',
        status: 'NOUVELLE',
        contact: {
          id: 'ctc_aurelie',
          fullName: 'Aurélie Kamga',
          initials: 'AK',
          email: 'aurelie.k@example.com',
          phone: '+237612345678',
          country: 'CM',
          city: 'Bonapriso, Douala',
          profile: 'PARTICULIER',
        },
        service: { id: 'svc_chef_prive', name: 'Chef privé', slug: 'chef-prive' },
        category: { slug: 'experience', name: 'Expérience' },
        subject: 'Chef privé',
        assignedTo: null,
        dueAt: clock.at(-2 * 3_600_000 + 86_400_000).toISOString(),
        isOverdue: false,
        createdAt: clock.at(-2 * 3_600_000).toISOString(),
      });
      const overdue = body.data.find((item) => item['id'] === 'req_0151');
      expect(overdue).toMatchObject({
        isOverdue: true,
        assignedTo: { id: ACCOUNTS.agent.id, name: 'Paul Ngando', initials: 'PN' },
      });
    });

    it('filtre par statut, type, rubrique, pays, quartier et recherche (sans accents ni casse)', async () => {
      const list = async (query: string): Promise<ListBody> => {
        const response = await sessions.admin.agent.get(`/v1/admin/requests?${query}`);
        expectContract('get', '/v1/admin/requests', 200, response);
        return response.body as ListBody;
      };

      const enCours = await list('status=EN_COURS');
      expect(ids(enCours)).toEqual(['req_0151', 'req_0157']);
      // Compteurs calculés avec les autres filtres, sans le statut.
      expect(enCours.counts['ALL']).toBe(5);
      expect(ids(await list('type=CONTACT'))).toEqual(['req_0156']);
      expect(ids(await list('category=experience&status=CLOTUREE'))).toEqual(['req_0120']);
      expect(ids(await list('country=FR'))).toEqual(['req_0157']);
      expect(ids(await list('district=makepe'))).toEqual(['req_0151']);
      expect(ids(await list('district=BONAPRISO'))).toEqual(['req_0142', 'req_0120']);
      expect(ids(await list('q=herve'))).toEqual(['req_0151']);
      expect(ids(await list(`q=${ref(157).toLowerCase()}`))).toEqual(['req_0157']);
      expect(ids(await list('q=saveurs'))).toEqual(['req_0156']);
      const typeCounts = await list('type=DEVIS&status=NOUVELLE');
      expect(typeCounts.counts).toEqual({
        ALL: 4,
        NOUVELLE: 1,
        EN_COURS: 2,
        PRESTATION_REALISEE: 0,
        CLOTUREE: 1,
      });
    });

    it('filtre par personne assignée, échéance et période', async () => {
      const list = async (session: TestSession, query: string): Promise<unknown[]> => {
        const response = await session.agent.get(`/v1/admin/requests?${query}`);
        expectContract('get', '/v1/admin/requests', 200, response);
        return ids(response.body as ListBody);
      };

      expect(await list(sessions.admin, 'assignee=none')).toEqual(['req_0142']);
      expect(await list(sessions.admin, `assignee=${ACCOUNTS.agent.id}`)).toEqual([
        'req_0156',
        'req_0151',
        'req_0120',
      ]);
      expect(await list(sessions.editor, 'assignee=me')).toEqual(['req_0157']);
      expect(await list(sessions.admin, 'due=overdue')).toEqual(['req_0151']);
      expect(await list(sessions.admin, 'due=today')).toContain('req_0156');
      const week = await list(sessions.admin, 'due=week');
      expect(week).toEqual(expect.arrayContaining(['req_0142', 'req_0156', 'req_0157']));
      expect(week).not.toContain('req_0151');
      const from = encodeURIComponent(clock.at(-4 * 86_400_000).toISOString());
      const to = encodeURIComponent(clock.at(-86_400_000).toISOString());
      expect(await list(sessions.admin, `from=${from}&to=${to}`)).toEqual(['req_0151']);
    });

    it('pagine et trie (`sort`, `page`, `pageSize`)', async () => {
      const response = await sessions.admin.agent.get('/v1/admin/requests?sort=reference&page=2&pageSize=2');

      expectContract('get', '/v1/admin/requests', 200, response);
      const body = response.body as ListBody;
      expect(ids(body)).toEqual(['req_0151', 'req_0156']);
      expect(body.meta).toEqual({ page: 2, pageSize: 2, total: 5, totalPages: 3 });

      const due = await sessions.admin.agent.get('/v1/admin/requests?sort=-dueAt&pageSize=1');
      expect(ids(due.body as ListBody)).toEqual(['req_0157']);
    });

    it('refuse des paramètres invalides (400 `invalid-query`)', async () => {
      for (const query of [
        'status=FOO',
        'sort=-email',
        'pageSize=500',
        'page=0',
        'due=demain',
        'from=hier',
      ]) {
        const response = await sessions.admin.agent.get(`/v1/admin/requests?${query}`);
        expectContract('get', '/v1/admin/requests', 400, response);
        expect((response.body as Row)['type'], query).toBe(`${PROBLEMS}invalid-query`);
      }
    });

    it('limite un chargé de clientèle à ses demandes et refuse les autres personnes (403)', async () => {
      const mine = await sessions.agent.agent.get('/v1/admin/requests');
      expectContract('get', '/v1/admin/requests', 200, mine);
      expect(ids(mine.body as ListBody)).toEqual(['req_0156', 'req_0151', 'req_0120']);
      expect((mine.body as ListBody).counts['ALL']).toBe(3);
      expect(
        ids((await sessions.agent.agent.get('/v1/admin/requests?assignee=me')).body as ListBody),
      ).toHaveLength(3);

      const others = await sessions.agent.agent.get(`/v1/admin/requests?assignee=${ACCOUNTS.manager.id}`);
      expectContract('get', '/v1/admin/requests', 403, others);
      expect((others.body as Row)['detail']).toBe('Vous ne voyez que les demandes qui vous sont assignées.');
    });

    it('est refusée sans permission sur les demandes (WRITER : 403) et sans session (401)', async () => {
      expectContract('get', '/v1/admin/requests', 403, await sessions.writer.agent.get('/v1/admin/requests'));
      expectContract('get', '/v1/admin/requests', 401, await request(server).get('/v1/admin/requests'));
    });
  });

  describe('GET /v1/admin/requests/export.csv', () => {
    it('exporte les demandes filtrées (UTF-8 avec BOM, `;`, formules neutralisées) et l’inscrit au journal', async () => {
      const response = await sessions.manager.agent.get('/v1/admin/requests/export.csv?status=NOUVELLE');

      expect(response.status).toBe(200);
      expectToMatchContract('get', '/v1/admin/requests/export.csv', 200, csvResponse(response));
      expect(response.headers['content-type']).toBe('text/csv; charset=utf-8');
      expect(response.headers['content-disposition']).toBe(
        `attachment; filename="demandes-${doualaDate(new Date())}.csv"`,
      );
      expect(response.headers['cache-control']).toBe('no-store');
      const lines = response.text.split('\r\n');
      expect(lines[0]).toBe(
        `${BOM}"Référence";"Type";"Statut";"Client";"E-mail";"Téléphone";"Ville";"Pays";"Service";"Assignée à";"Échéance";"Reçue le"`,
      );
      expect(lines).toHaveLength(3);
      expect(lines[1]).toMatch(
        new RegExp(
          `^"${ref(142)}";"Devis";"Nouvelle";"Aurélie Kamga";"aurelie.k@example.com";"\\+237612345678";"Bonapriso, Douala";"CM";"Chef privé";"";"[^"]+";"[^"]+"$`,
        ),
      );
      // Sujet saisi dans un formulaire public : préfixé d'une apostrophe, guillemets doublés.
      expect(lines[2]).toContain(`"'${FORMULA_SUBJECT.replace(/"/g, '""')}"`);
      expect(lines[2]).toContain('"Paul Ngando"');
      expect(rows('auditLog').at(-1)).toMatchObject({
        action: 'request.export',
        entity: 'Request',
        actorId: ACCOUNTS.manager.id,
        label: 'A exporté 2 demandes (CSV)',
      });
    });

    it('est réservé à `requests:export` (AGENT, WRITER : 403)', async () => {
      for (const session of [sessions.agent, sessions.writer]) {
        const response = await session.agent.get('/v1/admin/requests/export.csv');
        expectContract('get', '/v1/admin/requests/export.csv', 403, response);
      }
      const invalid = await sessions.admin.agent.get('/v1/admin/requests/export.csv?type=AUTRE');
      expectContract('get', '/v1/admin/requests/export.csv', 400, invalid);
    });
  });

  describe('GET /v1/admin/requests/{id}', () => {
    it('renvoie le détail : champs, valeurs, historique, notes, lien WhatsApp (200)', async () => {
      const response = await sessions.editor.agent.get('/v1/admin/requests/req_0142');

      expectContract('get', '/v1/admin/requests/{id}', 200, response);
      const body = response.body as Row;
      expect(body).toMatchObject({
        id: 'req_0142',
        contactPreference: 'WHATSAPP',
        message: 'Dîner pour les 60 ans de ma mère, cuisine camerounaise revisitée.',
        fields: [
          { key: 'rubrique', label: 'Rubrique', value: 'Expérience' },
          { key: 'guests', label: 'Personnes', value: '12' },
        ],
        payload: {
          categorySlug: 'experience',
          serviceSlug: 'chef-prive',
          needs: { guests: 12, occasion: 'Anniversaire' },
        },
        notes: [],
        attachments: [],
        survey: null,
        completedAt: null,
        closedAt: null,
      });
      expect((body['history'] as Row[]).map((event) => event['label'])).toEqual([
        'Demande reçue via le formulaire',
        'Accusé de réception envoyé au client',
      ]);
      expect(body['whatsappUrl']).toBe(
        `https://wa.me/237612345678?text=Bonjour%20Aur%C3%A9lie%2C%20c%27est%20Mambo%20Proxi%20au%20sujet%20de%20votre%20demande%20${ref(142)}.`,
      );
    });

    it('calcule les libellés de l’historique et l’auteur des notes', async () => {
      const assigned = await sessions.admin.agent.get('/v1/admin/requests/req_0151');
      expectContract('get', '/v1/admin/requests/{id}', 200, assigned);
      expect((assigned.body as { history: Row[] }).history.map((event) => event['label'])).toEqual([
        'Demande reçue via le formulaire',
        'Assignée à Paul Ngando',
        'Statut : Nouvelle → En cours',
      ]);

      const withNote = await sessions.admin.agent.get('/v1/admin/requests/req_0156');
      expect((withNote.body as { notes: Row[] }).notes).toEqual([
        {
          id: 'note_1',
          body: 'Rappeler demain matin.',
          author: { id: ACCOUNTS.editor.id, name: 'Équipe Douala', initials: 'ED' },
          createdAt: clock.at(-10 * 3_600_000).toISOString(),
        },
      ]);
    });

    it('répond 404 pour une demande inconnue, anonymisée ou hors du périmètre d’un chargé de clientèle', async () => {
      for (const id of ['req_inconnue', 'req_0090']) {
        const response = await sessions.admin.agent.get(`/v1/admin/requests/${id}`);
        expectContract('get', '/v1/admin/requests/{id}', 404, response);
        expect((response.body as Row)['detail']).toBe('Cette demande n’existe pas ou a été anonymisée.');
      }
      expectContract(
        'get',
        '/v1/admin/requests/{id}',
        404,
        await sessions.agent.agent.get('/v1/admin/requests/req_0142'),
      );
      expectContract(
        'get',
        '/v1/admin/requests/{id}',
        200,
        await sessions.agent.agent.get('/v1/admin/requests/req_0151'),
      );
      expectContract(
        'get',
        '/v1/admin/requests/{id}',
        403,
        await sessions.writer.agent.get('/v1/admin/requests/req_0142'),
      );
    });
  });

  describe('PATCH /v1/admin/requests/{id}', () => {
    const patch = (session: TestSession, id: string, body: Row) =>
      session.agent.patch(`/v1/admin/requests/${id}`).set('X-CSRF-Token', session.csrf).send(body);

    it('change le statut, crée l’événement et inscrit le journal (200)', async () => {
      const response = await patch(sessions.editor, 'req_0142', { status: 'EN_COURS' });

      expectContract('patch', '/v1/admin/requests/{id}', 200, response);
      const body = response.body as { status: string; history: Row[] };
      expect(body.status).toBe('EN_COURS');
      expect(body.history.at(-1)).toMatchObject({
        kind: 'STATUS_CHANGED',
        label: 'Statut : Nouvelle → En cours',
        actor: { id: ACCOUNTS.editor.id, name: 'Équipe Douala', initials: 'ED' },
        data: { from: 'NOUVELLE', to: 'EN_COURS' },
      });
      expect(rows('auditLog').at(-1)).toMatchObject({
        action: 'request.update',
        entity: 'Request',
        entityId: 'req_0142',
        label: `A passé la demande ${ref(142)} de « Nouvelle » à « En cours »`,
        before: { status: 'NOUVELLE' },
        after: { status: 'EN_COURS' },
      });
      expect(JSON.stringify(rows('auditLog').at(-1))).not.toContain('Aurélie');
    });

    it('programme le questionnaire d’un devis passé à « Prestation réalisée » (délai paramétré)', async () => {
      const response = await patch(sessions.manager, 'req_0157', { status: 'PRESTATION_REALISEE' });

      expectContract('patch', '/v1/admin/requests/{id}', 200, response);
      const body = response.body as { completedAt: string; survey: Row; history: Row[] };
      expect(body.completedAt).toEqual(expect.any(String));
      expect(body.survey).toMatchObject({
        status: 'SCHEDULED',
        sentAt: null,
        completedAt: null,
        rating: null,
      });
      const delay = Date.parse(String(body.survey['scheduledFor'])) - Date.parse(body.completedAt);
      expect(delay).toBe(48 * 3_600_000);
      expect(body.history.map((event) => event['label']).slice(-2)).toEqual([
        'Statut : En cours → Prestation réalisée',
        'Questionnaire de satisfaction programmé (dans 48 h)',
      ]);
      expect(rows('survey')).toHaveLength(1);
    });

    it('réserve le retour en arrière aux administrateurs et annule le questionnaire non envoyé', async () => {
      await patch(sessions.manager, 'req_0157', { status: 'PRESTATION_REALISEE' });

      const refused = await patch(sessions.manager, 'req_0157', { status: 'EN_COURS' });
      expectContract('patch', '/v1/admin/requests/{id}', 403, refused);
      expect((refused.body as Row)['detail']).toBe(
        'Seul un administrateur peut revenir à un statut précédent.',
      );

      const reverted = await patch(sessions.admin, 'req_0157', { status: 'EN_COURS' });
      expectContract('patch', '/v1/admin/requests/{id}', 200, reverted);
      expect(reverted.body).toMatchObject({ status: 'EN_COURS', survey: null, completedAt: null });
      expect(rows('survey')).toHaveLength(0);
    });

    it('assigne, prévient la personne (notification et e-mail) et retire l’assignation', async () => {
      const response = await patch(sessions.manager, 'req_0142', { assignedToId: ACCOUNTS.agent.id });

      expectContract('patch', '/v1/admin/requests/{id}', 200, response);
      const body = response.body as { assignedTo: Row; history: Row[] };
      expect(body.assignedTo).toEqual({ id: ACCOUNTS.agent.id, name: 'Paul Ngando', initials: 'PN' });
      expect(body.history.at(-1)).toMatchObject({ kind: 'ASSIGNED', label: 'Assignée à Paul Ngando' });
      expect(rows('notification').at(-1)).toMatchObject({
        userId: ACCOUNTS.agent.id,
        kind: 'ASSIGNMENT',
        title: `Demande assignée — Chef privé (${ref(142)})`,
        link: '/admin/demandes?id=req_0142',
        entityType: 'Request',
        entityId: 'req_0142',
      });
      const job = mail.last('team-assignment', ACCOUNTS.agent.email);
      expect(job).toMatchObject({
        lang: 'fr',
        reference: ref(142),
        data: {
          reference: ref(142),
          serviceName: 'Chef privé',
          fullName: 'Aurélie Kamga',
          assignedByName: 'Carine Eboa',
          requestId: 'req_0142',
          actionUrl: 'http://localhost:3000/admin/demandes?id=req_0142',
        },
      });

      const removed = await patch(sessions.manager, 'req_0142', { assignedToId: null });
      expectContract('patch', '/v1/admin/requests/{id}', 200, removed);
      expect(removed.body).toMatchObject({ assignedTo: null });
      expect((removed.body as { history: Row[] }).history.at(-1)).toMatchObject({
        label: 'Assignation retirée',
      });
    });

    it('ne prévient pas la personne qui s’assigne elle-même', async () => {
      const response = await patch(sessions.editor, 'req_0142', { assignedToId: ACCOUNTS.editor.id });

      expectContract('patch', '/v1/admin/requests/{id}', 200, response);
      expect(rows('notification')).toHaveLength(0);
      expect(mail.jobs.filter((job) => job.template === 'team-assignment')).toHaveLength(0);
    });

    it('refuse une personne qui ne traite pas de demandes (422) et l’assignation sans `requests:assign` (403)', async () => {
      for (const id of [ACCOUNTS.writer.id, ACCOUNTS.disabled.id, ACCOUNTS.invited.id, 'usr_inconnu']) {
        const response = await patch(sessions.admin, 'req_0142', { assignedToId: id });
        expectContract('patch', '/v1/admin/requests/{id}', 422, response);
        expect((response.body as { errors: Row[] }).errors[0]).toMatchObject({ path: 'assignedToId' });
      }
      const agent = await patch(sessions.agent, 'req_0151', { assignedToId: ACCOUNTS.editor.id });
      expectContract('patch', '/v1/admin/requests/{id}', 403, agent);
      expect((agent.body as Row)['detail']).toBe(
        'Seul un responsable peut assigner ou réassigner une demande.',
      );
      expect(find('request', 'req_0151')?.['assignedToId']).toBe(ACCOUNTS.agent.id);
    });

    it('laisse un chargé de clientèle traiter ses demandes, pas celles des autres', async () => {
      const mine = await patch(sessions.agent, 'req_0151', { status: 'PRESTATION_REALISEE', dueAt: null });
      expectContract('patch', '/v1/admin/requests/{id}', 200, mine);
      expect(mine.body).toMatchObject({ status: 'PRESTATION_REALISEE', dueAt: null, isOverdue: false });

      const other = await patch(sessions.agent, 'req_0157', { status: 'CLOTUREE' });
      expectContract('patch', '/v1/admin/requests/{id}', 404, other);
    });

    it('modifie l’échéance et refuse un corps vide ou invalide (422)', async () => {
      const dueAt = '2026-12-01T09:00:00.000Z';
      const response = await patch(sessions.editor, 'req_0142', { dueAt });
      expectContract('patch', '/v1/admin/requests/{id}', 200, response);
      expect(response.body).toMatchObject({ dueAt });

      for (const body of [{}, { status: 'TERMINEE' }, { dueAt: 'demain' }, { assignedToId: 42 }]) {
        const invalid = await patch(sessions.editor, 'req_0142', body);
        expectContract('patch', '/v1/admin/requests/{id}', 422, invalid);
      }
    });

    it('exige le jeton CSRF (403 `csrf-token-invalid`) et une permission d’écriture (WRITER : 403)', async () => {
      const noCsrf = await sessions.admin.agent
        .patch('/v1/admin/requests/req_0142')
        .send({ status: 'EN_COURS' });
      expectContract('patch', '/v1/admin/requests/{id}', 403, noCsrf);
      expect((noCsrf.body as Row)['type']).toBe(`${PROBLEMS}csrf-token-invalid`);

      const writer = await patch(sessions.writer, 'req_0142', { status: 'EN_COURS' });
      expectContract('patch', '/v1/admin/requests/{id}', 403, writer);
      expect(find('request', 'req_0142')?.['status']).toBe('NOUVELLE');
    });
  });

  describe('POST /v1/admin/requests/{id}/notes', () => {
    const post = (session: TestSession, id: string, body: unknown) =>
      session.agent
        .post(`/v1/admin/requests/${id}/notes`)
        .set('X-CSRF-Token', session.csrf)
        .send(body as object);

    it('ajoute une note interne et l’événement `NOTE_ADDED` (201)', async () => {
      const response = await post(sessions.manager, 'req_0142', {
        body: '  Client rappelé, devis en cours.  ',
      });

      expectContract('post', '/v1/admin/requests/{id}/notes', 201, response);
      expect(response.body).toMatchObject({
        body: 'Client rappelé, devis en cours.',
        author: { id: ACCOUNTS.manager.id, name: 'Carine Eboa', initials: 'CE' },
      });
      const detail = await sessions.manager.agent.get('/v1/admin/requests/req_0142');
      expect((detail.body as { history: Row[] }).history.at(-1)).toMatchObject({
        kind: 'NOTE_ADDED',
        label: 'Note interne ajoutée',
        actor: { id: ACCOUNTS.manager.id },
      });
    });

    it('limite un chargé de clientèle à ses demandes et refuse une note vide (422)', async () => {
      expectContract(
        'post',
        '/v1/admin/requests/{id}/notes',
        201,
        await post(sessions.agent, 'req_0151', { body: 'Visite prévue jeudi.' }),
      );
      expectContract(
        'post',
        '/v1/admin/requests/{id}/notes',
        404,
        await post(sessions.agent, 'req_0142', { body: 'Hors périmètre.' }),
      );
      for (const body of [{ body: '   ' }, {}, { body: 'x'.repeat(5001) }])
        expectContract(
          'post',
          '/v1/admin/requests/{id}/notes',
          422,
          await post(sessions.admin, 'req_0142', body),
        );
      expectContract(
        'post',
        '/v1/admin/requests/{id}/notes',
        403,
        await post(sessions.writer, 'req_0142', { body: 'Note.' }),
      );
    });
  });

  describe('POST /v1/admin/requests/{id}/duplicate', () => {
    it('crée une copie « Nouvelle » avec la référence suivante (201)', async () => {
      const response = await sessions.editor.agent
        .post('/v1/admin/requests/req_0157/duplicate')
        .set('X-CSRF-Token', sessions.editor.csrf);

      expectContract('post', '/v1/admin/requests/{id}/duplicate', 201, response);
      const body = response.body as Row & { history: Row[] };
      expect(body).toMatchObject({
        reference: ref(162),
        status: 'NOUVELLE',
        subject: 'Chef privé',
        contact: { id: 'ctc_samuel' },
        assignedTo: { id: ACCOUNTS.editor.id },
        notes: [],
        survey: null,
      });
      expect(body.history).toEqual([
        expect.objectContaining({ kind: 'DUPLICATED', label: `Copie de la demande ${ref(157)}` }),
      ]);
      const copy = find('request', String(body['id']));
      expect(copy).toMatchObject({
        duplicatedFromId: 'req_0157',
        ip: null,
        searchText: requestSearchText(ref(162), 'Chef privé'),
      });
      expect(Date.parse(String(body['dueAt'])) - Date.parse(String(body['createdAt']))).toBe(86_400_000);
    });

    it('est réservée à `requests:write` (AGENT : 403) et répond 404 pour une demande inconnue', async () => {
      const agent = await sessions.agent.agent
        .post('/v1/admin/requests/req_0151/duplicate')
        .set('X-CSRF-Token', sessions.agent.csrf);
      expectContract('post', '/v1/admin/requests/{id}/duplicate', 403, agent);
      const unknown = await sessions.admin.agent
        .post('/v1/admin/requests/req_inconnue/duplicate')
        .set('X-CSRF-Token', sessions.admin.csrf);
      expectContract('post', '/v1/admin/requests/{id}/duplicate', 404, unknown);
    });
  });

  describe('DELETE /v1/admin/requests/{id}', () => {
    it('anonymise la demande, la détache de la personne et la retire du back-office (204)', async () => {
      const response = await sessions.editor.agent
        .delete('/v1/admin/requests/req_0156')
        .set('X-CSRF-Token', sessions.editor.csrf);

      expectContract('delete', '/v1/admin/requests/{id}', 204, response);
      const anonymized = find('request', 'req_0156');
      expect(anonymized).toMatchObject({
        payload: {},
        message: null,
        ip: null,
        userAgent: null,
        subject: null,
        anonymizedAt: expect.any(Date) as unknown,
      });
      const anonymous = find('contact', String(anonymized?.['contactId']));
      expect(anonymous).toMatchObject({
        email: 'anonyme@mamboproxi.invalid',
        anonymizedAt: expect.any(Date) as unknown,
      });
      expect(rows('requestNote').filter((note) => note['requestId'] === 'req_0156')).toHaveLength(0);
      expect(rows('requestEvent').at(-1)).toMatchObject({ requestId: 'req_0156', kind: 'ANONYMIZED' });
      expect(rows('auditLog').at(-1)).toMatchObject({
        action: 'request.anonymize',
        label: `A anonymisé la demande ${ref(156)}`,
      });
      expectContract(
        'get',
        '/v1/admin/requests/{id}',
        404,
        await sessions.editor.agent.get('/v1/admin/requests/req_0156'),
      );
      const contact = await sessions.editor.agent.get('/v1/admin/contacts/ctc_saveurs');
      expect((contact.body as Row)['requestsCount']).toBe(0);
    });

    it('est réservée à `requests:anonymize` (AGENT : 403) et exige le jeton CSRF', async () => {
      const agent = await sessions.agent.agent
        .delete('/v1/admin/requests/req_0151')
        .set('X-CSRF-Token', sessions.agent.csrf);
      expectContract('delete', '/v1/admin/requests/{id}', 403, agent);
      const noCsrf = await sessions.admin.agent.delete('/v1/admin/requests/req_0151');
      expectContract('delete', '/v1/admin/requests/{id}', 403, noCsrf);
      const unknown = await sessions.admin.agent
        .delete('/v1/admin/requests/req_0090')
        .set('X-CSRF-Token', sessions.admin.csrf);
      expectContract('delete', '/v1/admin/requests/{id}', 404, unknown);
      expect(find('request', 'req_0151')?.['anonymizedAt']).toBeNull();
    });
  });

  describe('GET /v1/admin/me/tasks', () => {
    it('donne au chargé de clientèle ses demandes ouvertes et ses rendez-vous (200)', async () => {
      const response = await sessions.agent.agent.get('/v1/admin/me/tasks');

      expectContract('get', '/v1/admin/me/tasks', 200, response);
      const body = response.body as {
        requests: Row & { items: Row[] };
        appointments: Row & { upcoming: Row[] };
        unassigned: unknown;
      };
      expect(body.requests).toMatchObject({
        open: 2,
        byStatus: { NOUVELLE: 1, EN_COURS: 1 },
        overdue: 1,
        dueToday: 1,
      });
      // En retard d'abord, puis par échéance.
      expect(body.requests.items.map((item) => item['id'])).toEqual(['req_0151', 'req_0156']);
      expect(body.appointments).toMatchObject({ today: 1, toConfirm: 1 });
      expect(body.appointments.upcoming.map((item) => item['id'])).toEqual(['apt_7', 'apt_9']);
      expect(body.appointments.upcoming[0]).toMatchObject({
        reference: ref(153),
        contact: { id: 'ctc_samuel', fullName: 'Samuel Eto Mbarga', initials: 'SE' },
        assignedTo: { id: ACCOUNTS.agent.id, name: 'Paul Ngando' },
      });
      expect(body.unassigned).toBeNull();
    });

    it('compte les demandes à assigner pour qui peut assigner, et répond à tous les rôles', async () => {
      const manager = await sessions.manager.agent.get('/v1/admin/me/tasks');
      expectContract('get', '/v1/admin/me/tasks', 200, manager);
      expect(manager.body).toMatchObject({ requests: { open: 0, items: [] }, unassigned: 1 });

      const writer = await sessions.writer.agent.get('/v1/admin/me/tasks');
      expectContract('get', '/v1/admin/me/tasks', 200, writer);
      expect(writer.body).toMatchObject({
        requests: { open: 0, overdue: 0, dueToday: 0, items: [] },
        appointments: { today: 0, toConfirm: 0, upcoming: [] },
        unassigned: null,
      });
      expectContract('get', '/v1/admin/me/tasks', 401, await request(server).get('/v1/admin/me/tasks'));
    });
  });
});

describe.runIf(process.env['E2E_REAL_SERVICES'] === 'true')(
  'demandes du back-office (avec la base réelle, remplie par le seed)',
  () => {
    const mail = new MailQueueDouble();
    const throttler = new ResettableThrottlerStorage();
    const runId = String(Date.now());
    const adminEmail = `e2e.requests.${runId}@example.com`;
    const contactEmail = `e2e.client.${runId}@example.com`;
    let app: NestExpressApplication;
    let server: Server;
    let prisma: PrismaService;
    let admin: TestSession;
    let adminId: string;
    let contactId: string;
    let requestId: string;
    const created: string[] = [];

    beforeAll(async () => {
      prepareContract('RequestListItem', 'RequestDetail', 'RequestNote', 'MyTasks', 'Problem');
      app = await createApp({ mail, throttler });
      server = app.getHttpServer();
      prisma = app.get(PrismaService);
      const now = new Date();
      const user = await prisma.user.create({
        data: {
          email: adminEmail,
          name: 'Admin Demandes',
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
          fullName: 'Élodie Essai',
          city: 'Deïdo, Douala',
          country: 'CM',
          searchText: `elodie essai ${contactEmail}`,
          cityKey: 'deido, douala',
        },
        select: { id: true },
      });
      contactId = contact.id;
      // Numéro hors de la séquence annuelle (le compteur n'est pas consommé).
      const reference = `MP-${String(referenceYear(now))}-9${runId.slice(-6)}`;
      const saved = await prisma.request.create({
        data: {
          reference,
          type: 'DEVIS',
          contactId,
          subject: 'Essai e2e',
          searchText: requestSearchText(reference, 'Essai e2e'),
          consentAt: now,
          dueAt: new Date(now.getTime() + 86_400_000),
          payload: { fields: [{ key: 'ville', label: 'Ville', value: 'Douala' }] },
        },
        select: { id: true },
      });
      requestId = saved.id;
      created.push(requestId);
      admin = await signIn(server, mail, adminEmail);
    }, CONTRACT_WARM_UP_TIMEOUT);

    afterAll(async () => {
      const duplicates = await prisma.request.findMany({
        where: { duplicatedFromId: { in: created } },
        select: { id: true },
      });
      const requestIds = [...created, ...duplicates.map((row) => row.id)];
      await prisma.notification.deleteMany({ where: { entityId: { in: requestIds } } });
      await prisma.request.deleteMany({ where: { id: { in: requestIds } } });
      await prisma.contact.deleteMany({ where: { id: contactId } });
      await prisma.auditLog.deleteMany({ where: { actorId: adminId } });
      await prisma.user.deleteMany({ where: { id: adminId } });
      await app.close();
    });

    beforeEach(() => {
      mail.reset();
    });

    it('liste les demandes du seed, conformes au contrat, et retrouve la demande de test', async () => {
      const list = await admin.agent.get('/v1/admin/requests?pageSize=100');
      expectContract('get', '/v1/admin/requests', 200, list);
      expect((list.body as ListBody).meta['total']).toBeGreaterThan(10);

      const search = await admin.agent.get('/v1/admin/requests?q=elodie&district=deido');
      expectContract('get', '/v1/admin/requests', 200, search);
      expect(ids(search.body as ListBody)).toEqual([requestId]);

      const seeded = (list.body as ListBody).data[0];
      const detail = await admin.agent.get(`/v1/admin/requests/${String(seeded?.['id'])}`);
      expectContract('get', '/v1/admin/requests/{id}', 200, detail);

      const csv = await admin.agent.get('/v1/admin/requests/export.csv');
      expect(csv.status).toBe(200);
      expect(csv.text.startsWith(BOM)).toBe(true);

      expectContract('get', '/v1/admin/me/tasks', 200, await admin.agent.get('/v1/admin/me/tasks'));
    });

    it('traite la demande de test : statut, note, duplication, anonymisation', async () => {
      const path = `/v1/admin/requests/${requestId}`;
      const status = await admin.agent
        .patch(path)
        .set('X-CSRF-Token', admin.csrf)
        .send({ status: 'EN_COURS' });
      expectContract('patch', '/v1/admin/requests/{id}', 200, status);

      const note = await admin.agent
        .post(`${path}/notes`)
        .set('X-CSRF-Token', admin.csrf)
        .send({ body: 'Note de test.' });
      expectContract('post', '/v1/admin/requests/{id}/notes', 201, note);

      const copy = await admin.agent.post(`${path}/duplicate`).set('X-CSRF-Token', admin.csrf);
      expectContract('post', '/v1/admin/requests/{id}/duplicate', 201, copy);

      const done = await admin.agent
        .patch(path)
        .set('X-CSRF-Token', admin.csrf)
        .send({ status: 'PRESTATION_REALISEE' });
      expectContract('patch', '/v1/admin/requests/{id}', 200, done);
      expect((done.body as { survey: Row | null }).survey).toMatchObject({ status: 'SCHEDULED' });

      const removed = await admin.agent.delete(path).set('X-CSRF-Token', admin.csrf);
      expectContract('delete', '/v1/admin/requests/{id}', 204, removed);
      expectContract('get', '/v1/admin/requests/{id}', 404, await admin.agent.get(path));
      const row = await prisma.request.findUnique({
        where: { id: requestId },
        select: { anonymizedAt: true, message: true, contact: { select: { email: true } } },
      });
      expect(row?.anonymizedAt).not.toBeNull();
      expect(row?.contact.email).toBe('anonyme@mamboproxi.invalid');
    });
  },
);
