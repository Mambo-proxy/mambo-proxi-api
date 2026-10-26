/**
 * Tests e2e des utilisateurs du back-office (`/v1/admin/users*`, `/v1/admin/roles`) avec le double de Prisma :
 * permissions par rôle, présence de l'équipe, invitation, modification, désactivation, suppression,
 * réinitialisation par un administrateur. Chaque réponse est validée contre le contrat.
 */
import type { Server } from 'node:http';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PasswordService } from '../src/modules/auth/password.service.js';
import { roleDefinitions } from '../src/modules/auth/permissions.js';
import { CONTRACT_WARM_UP_TIMEOUT, prepareContract } from './contract.js';
import {
  ACCOUNTS,
  MailQueueDouble,
  PASSWORD,
  PROBLEMS,
  ResettableThrottlerStorage,
  authTables,
  createApp,
  expectContract,
  resetTables,
  signIn,
  type TestSession,
} from './support/auth.js';
import type { PrismaTables } from './support/prisma-double.js';

type Row = Record<string, unknown>;

describe('utilisateurs du back-office (avec des doubles)', () => {
  const mail = new MailQueueDouble();
  const throttler = new ResettableThrottlerStorage();
  let app: NestExpressApplication;
  let server: Server;
  let tables: PrismaTables;
  let passwordHash: string;

  const rows = (name: keyof PrismaTables): Row[] => tables[name] ?? [];
  const user = (id: string): Row | undefined => rows('user').find((row) => row['id'] === id);
  const as = (email: string): Promise<TestSession> => signIn(server, mail, email);

  beforeAll(async () => {
    prepareContract('AdminUser', 'TeamPresence', 'RoleDefinition', 'Problem', 'MessageResponse');
    passwordHash = await new PasswordService().hash(PASSWORD);
    tables = authTables(passwordHash);
    app = await createApp({ mail, throttler, tables });
    server = app.getHttpServer();
  }, CONTRACT_WARM_UP_TIMEOUT);

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    resetTables(tables, passwordHash);
    mail.reset();
    throttler.reset();
  });

  describe('GET /v1/admin/users', () => {
    it('liste les utilisateurs et leur statut pour un administrateur (200)', async () => {
      const { agent } = await as(ACCOUNTS.admin.email);
      const response = await agent.get('/v1/admin/users');

      expectContract('get', '/v1/admin/users', 200, response);
      const body = response.body as Row[];
      expect(body).toHaveLength(7);
      expect(body.find((row) => row['id'] === ACCOUNTS.editor.id)).toMatchObject({
        name: 'Équipe Douala',
        initials: 'ED',
        role: 'EDITOR',
        status: 'ACTIF',
        isActive: true,
      });
      expect(body.find((row) => row['id'] === ACCOUNTS.invited.id)).toMatchObject({ status: 'INVITE' });
      expect(body.find((row) => row['id'] === ACCOUNTS.disabled.id)).toMatchObject({
        status: 'DESACTIVE',
        isActive: false,
      });
      expect(JSON.stringify(body)).not.toContain('passwordHash');
    });

    it('est réservée à `users:manage` (403) et à une session ouverte (401)', async () => {
      for (const email of [ACCOUNTS.manager.email, ACCOUNTS.editor.email, ACCOUNTS.agent.email]) {
        const { agent } = await as(email);
        const response = await agent.get('/v1/admin/users');
        expectContract('get', '/v1/admin/users', 403, response);
        expect(response.body).toEqual({
          type: `${PROBLEMS}forbidden`,
          title: 'Action non autorisée',
          status: 403,
          detail: "Votre rôle ne permet pas d'effectuer cette action.",
        });
      }
      expectContract('get', '/v1/admin/users', 401, await request(server).get('/v1/admin/users'));
    });
  });

  describe('GET /v1/admin/users/presence', () => {
    it('montre les membres actifs, connectés d’abord, avec leurs tâches ouvertes (200)', async () => {
      const editor = await as(ACCOUNTS.editor.email);
      const response = await editor.agent.get('/v1/admin/users/presence');

      expectContract('get', '/v1/admin/users/presence', 200, response);
      const body = response.body as { onlineWindowMinutes: number; onlineCount: number; data: Row[] };
      expect(body.onlineWindowMinutes).toBe(5);
      expect(body.onlineCount).toBe(1);
      const ids = body.data.map((member) => (member['user'] as Row)['id']);
      expect(ids[0]).toBe(ACCOUNTS.editor.id);
      expect(ids).not.toContain(ACCOUNTS.invited.id);
      expect(ids).not.toContain(ACCOUNTS.disabled.id);
      expect(ids).toHaveLength(5);
      const paul = body.data.find((member) => (member['user'] as Row)['id'] === ACCOUNTS.agent.id);
      // Une demande en cours et un rendez-vous confirmé à venir ; ni la demande clôturée ni le rendez-vous annulé.
      expect(paul).toMatchObject({ role: 'AGENT', online: false, assignable: true, openTasks: 2 });
      const grace = body.data.find((member) => (member['user'] as Row)['id'] === ACCOUNTS.writer.id);
      expect(grace).toMatchObject({ assignable: false, openTasks: 0 });
    });

    it('passe un membre hors ligne quand sa session est révoquée', async () => {
      await as(ACCOUNTS.agent.email);
      const manager = await as(ACCOUNTS.manager.email);
      const online = async (): Promise<boolean> => {
        const response = await manager.agent.get('/v1/admin/users/presence');
        const data = (response.body as { data: Row[] }).data;
        return (
          data.find((member) => (member['user'] as Row)['id'] === ACCOUNTS.agent.id)?.['online'] === true
        );
      };

      expect(await online()).toBe(true);
      for (const session of rows('session').filter((row) => row['userId'] === ACCOUNTS.agent.id))
        session['revokedAt'] = new Date();
      expect(await online()).toBe(false);
    });

    it('est refusée sans `team:read` (AGENT, WRITER : 403)', async () => {
      for (const email of [ACCOUNTS.agent.email, ACCOUNTS.writer.email]) {
        const { agent } = await as(email);
        expectContract('get', '/v1/admin/users/presence', 403, await agent.get('/v1/admin/users/presence'));
      }
    });
  });

  describe('GET /v1/admin/roles', () => {
    it('renvoie les cinq rôles et leurs permissions (200)', async () => {
      const { agent } = await as(ACCOUNTS.manager.email);
      const response = await agent.get('/v1/admin/roles');

      expectContract('get', '/v1/admin/roles', 200, response);
      expect(response.body).toEqual(roleDefinitions());
    });
  });

  describe('POST /v1/admin/users/invite', () => {
    it('crée le compte sans mot de passe et envoie le lien d’activation (201)', async () => {
      const admin = await as(ACCOUNTS.admin.email);
      const response = await admin.agent
        .post('/v1/admin/users/invite')
        .set('X-CSRF-Token', admin.csrf)
        .send({ email: ' Brice.Tchana@MamboProxi.com ', name: 'Brice Tchana', role: 'AGENT' });

      expectContract('post', '/v1/admin/users/invite', 201, response);
      expect(response.body).toMatchObject({
        email: 'brice.tchana@mamboproxi.com',
        name: 'Brice Tchana',
        initials: 'BT',
        role: 'AGENT',
        status: 'INVITE',
        isActive: true,
        lastLoginAt: null,
      });
      const id = String((response.body as Row)['id']);
      expect(user(id)).toMatchObject({ passwordHash: null, invitedById: ACCOUNTS.admin.id });
      expect(rows('invitation').find((row) => row['userId'] === id)).toMatchObject({ role: 'AGENT' });
      const job = mail.last('user-invite', 'brice.tchana@mamboproxi.com');
      expect(job).toMatchObject({ lang: 'fr', data: { firstName: 'Brice' } });
      expect(String(job?.data['actionUrl'])).toMatch(
        /^http:\/\/localhost:3000\/admin\/invitation\?token=[\w-]{43}$/,
      );
      expect(rows('auditLog').at(-1)).toMatchObject({
        actorId: ACCOUNTS.admin.id,
        action: 'user.invite',
        entity: 'User',
        entityId: id,
        label: 'A invité Brice Tchana (Chargé·e de clientèle)',
      });
    });

    it('refuse une adresse déjà utilisée (409), un corps invalide (422) et un rôle sans `users:manage` (403)', async () => {
      const admin = await as(ACCOUNTS.admin.email);
      const duplicate = await admin.agent
        .post('/v1/admin/users/invite')
        .set('X-CSRF-Token', admin.csrf)
        .send({ email: ACCOUNTS.manager.email, name: 'Doublon', role: 'EDITOR' });
      expectContract('post', '/v1/admin/users/invite', 409, duplicate);
      expect((duplicate.body as Row)['detail']).toBe('Un utilisateur utilise déjà cette adresse.');

      const invalid = await admin.agent
        .post('/v1/admin/users/invite')
        .set('X-CSRF-Token', admin.csrf)
        .send({ email: 'pas-une-adresse', name: '', role: 'SUPERADMIN' });
      expectContract('post', '/v1/admin/users/invite', 422, invalid);
      expect((invalid.body as { errors: Row[] }).errors.map((error) => error['path']).sort()).toEqual([
        'email',
        'name',
        'role',
      ]);

      const manager = await as(ACCOUNTS.manager.email);
      const forbidden = await manager.agent
        .post('/v1/admin/users/invite')
        .set('X-CSRF-Token', manager.csrf)
        .send({ email: 'nouveau@mamboproxi.com', name: 'Nouveau', role: 'ADMIN' });
      expectContract('post', '/v1/admin/users/invite', 403, forbidden);
      expect(mail.jobs.filter((job) => job.template === 'user-invite')).toEqual([]);
    });
  });

  describe('PATCH /v1/admin/users/{id}', () => {
    const path = (id: string): string => `/v1/admin/users/${id}`;

    it('change le rôle : nouvelles permissions dès la requête suivante (200)', async () => {
      const paul = await as(ACCOUNTS.agent.email);
      const admin = await as(ACCOUNTS.admin.email);
      const response = await admin.agent
        .patch(path(ACCOUNTS.agent.id))
        .set('X-CSRF-Token', admin.csrf)
        .send({ role: 'MANAGER', name: 'Paul Ngando Mbia' });

      expectContract('patch', '/v1/admin/users/{id}', 200, response);
      expect(response.body).toMatchObject({ role: 'MANAGER', name: 'Paul Ngando Mbia', initials: 'PN' });
      const me = await paul.agent.get('/v1/auth/me');
      expect((me.body as { permissions: string[] }).permissions).toContain('requests:read');
      expect(rows('auditLog').at(-1)).toMatchObject({
        action: 'user.update',
        label: 'A donné le rôle Responsable à Paul Ngando Mbia',
        before: { name: 'Paul Ngando', role: 'AGENT', isActive: true },
        after: { name: 'Paul Ngando Mbia', role: 'MANAGER', isActive: true },
      });
    });

    it('désactive un compte : sessions révoquées aussitôt, connexion refusée ; puis le réactive (200)', async () => {
      const carine = await as(ACCOUNTS.manager.email);
      const admin = await as(ACCOUNTS.admin.email);
      const disabled = await admin.agent
        .patch(path(ACCOUNTS.manager.id))
        .set('X-CSRF-Token', admin.csrf)
        .send({ isActive: false });

      expectContract('patch', '/v1/admin/users/{id}', 200, disabled);
      expect(disabled.body).toMatchObject({ isActive: false, status: 'DESACTIVE' });
      expect((await carine.agent.get('/v1/auth/me')).status).toBe(401);
      expect((await carine.agent.post('/v1/auth/refresh')).status).toBe(401);
      const login = await request(server)
        .post('/v1/auth/login')
        .send({ email: ACCOUNTS.manager.email, password: PASSWORD });
      expect(login.status).toBe(401);

      const enabled = await admin.agent
        .patch(path(ACCOUNTS.manager.id))
        .set('X-CSRF-Token', admin.csrf)
        .send({ isActive: true });
      expectContract('patch', '/v1/admin/users/{id}', 200, enabled);
      expect(enabled.body).toMatchObject({ status: 'ACTIF' });
    });

    it('protège le dernier administrateur actif et son propre compte (409)', async () => {
      const admin = await as(ACCOUNTS.admin.email);
      const demote = await admin.agent
        .patch(path(ACCOUNTS.admin.id))
        .set('X-CSRF-Token', admin.csrf)
        .send({ role: 'EDITOR' });
      expectContract('patch', '/v1/admin/users/{id}', 409, demote);
      expect((demote.body as Row)['detail']).toBe('Impossible de retirer le dernier administrateur actif.');

      const self = await admin.agent
        .patch(path(ACCOUNTS.admin.id))
        .set('X-CSRF-Token', admin.csrf)
        .send({ isActive: false });
      expectContract('patch', '/v1/admin/users/{id}', 409, self);
      expect((self.body as Row)['detail']).toBe('Vous ne pouvez pas désactiver votre propre compte.');

      // Un second administrateur actif : la rétrogradation devient possible.
      user(ACCOUNTS.editor.id)!['role'] = 'ADMIN';
      const allowed = await admin.agent
        .patch(path(ACCOUNTS.admin.id))
        .set('X-CSRF-Token', admin.csrf)
        .send({ role: 'MANAGER' });
      expectContract('patch', '/v1/admin/users/{id}', 200, allowed);
    });

    it('répond 404 pour un utilisateur inconnu ; un corps vide est refusé (422)', async () => {
      const admin = await as(ACCOUNTS.admin.email);
      const unknown = await admin.agent
        .patch(path('usr_inconnu'))
        .set('X-CSRF-Token', admin.csrf)
        .send({ name: 'Personne' });
      expectContract('patch', '/v1/admin/users/{id}', 404, unknown);

      const empty = await admin.agent.patch(path(ACCOUNTS.agent.id)).set('X-CSRF-Token', admin.csrf).send({});
      expectContract('patch', '/v1/admin/users/{id}', 422, empty);
    });
  });

  describe('DELETE /v1/admin/users/{id}', () => {
    const path = (id: string): string => `/v1/admin/users/${id}`;

    it('supprime une invitation non acceptée (204)', async () => {
      const admin = await as(ACCOUNTS.admin.email);
      const response = await admin.agent.delete(path(ACCOUNTS.invited.id)).set('X-CSRF-Token', admin.csrf);

      expectContract('delete', '/v1/admin/users/{id}', 204, response);
      expect(user(ACCOUNTS.invited.id)).toBeUndefined();
      expect(rows('auditLog').at(-1)).toMatchObject({ action: 'user.delete', entityId: ACCOUNTS.invited.id });
    });

    it('refuse son propre compte et un utilisateur qui a un historique (409)', async () => {
      const admin = await as(ACCOUNTS.admin.email);
      const self = await admin.agent.delete(path(ACCOUNTS.admin.id)).set('X-CSRF-Token', admin.csrf);
      expectContract('delete', '/v1/admin/users/{id}', 409, self);

      const withNotes = await admin.agent.delete(path(ACCOUNTS.editor.id)).set('X-CSRF-Token', admin.csrf);
      expectContract('delete', '/v1/admin/users/{id}', 409, withNotes);
      expect((withNotes.body as Row)['detail']).toBe(
        'Cet utilisateur a un historique dans les demandes : désactivez-le plutôt que de le supprimer.',
      );
      expect(user(ACCOUNTS.editor.id)).toBeDefined();
    });

    it('répond 404 pour un utilisateur inconnu', async () => {
      const admin = await as(ACCOUNTS.admin.email);
      const response = await admin.agent.delete(path('usr_inconnu')).set('X-CSRF-Token', admin.csrf);

      expectContract('delete', '/v1/admin/users/{id}', 404, response);
    });
  });

  describe('POST /v1/admin/users/{id}/reset-password', () => {
    const path = (id: string): string => `/v1/admin/users/${id}/reset-password`;

    it('envoie un lien de réinitialisation et révoque les sessions du compte (202)', async () => {
      const grace = await as(ACCOUNTS.writer.email);
      const admin = await as(ACCOUNTS.admin.email);
      const response = await admin.agent.post(path(ACCOUNTS.writer.id)).set('X-CSRF-Token', admin.csrf);

      expectContract('post', '/v1/admin/users/{id}/reset-password', 202, response);
      expect(response.body).toEqual({
        message: `Lien de réinitialisation envoyé à ${ACCOUNTS.writer.email}.`,
      });
      expect((await grace.agent.get('/v1/auth/me')).status).toBe(401);
      expect(rows('passwordReset').at(-1)).toMatchObject({
        userId: ACCOUNTS.writer.id,
        requestedBy: ACCOUNTS.admin.id,
      });
      expect(mail.token('password-reset', ACCOUNTS.writer.email)).toMatch(/^[\w-]{43}$/);
    });

    it('renvoie l’invitation d’un compte qui ne l’a pas encore acceptée (202)', async () => {
      const admin = await as(ACCOUNTS.admin.email);
      const response = await admin.agent.post(path(ACCOUNTS.invited.id)).set('X-CSRF-Token', admin.csrf);

      expectContract('post', '/v1/admin/users/{id}/reset-password', 202, response);
      expect(response.body).toEqual({ message: `Invitation renvoyée à ${ACCOUNTS.invited.email}.` });
      expect(mail.last('user-invite', ACCOUNTS.invited.email)).toBeDefined();
    });

    it('refuse un compte désactivé (409), un utilisateur inconnu (404) et un rôle sans `users:manage` (403)', async () => {
      const admin = await as(ACCOUNTS.admin.email);
      const disabled = await admin.agent.post(path(ACCOUNTS.disabled.id)).set('X-CSRF-Token', admin.csrf);
      expectContract('post', '/v1/admin/users/{id}/reset-password', 409, disabled);
      expect((disabled.body as Row)['detail']).toBe(
        'Ce compte est désactivé : réactivez-le avant de lui envoyer un lien.',
      );

      const unknown = await admin.agent.post(path('usr_inconnu')).set('X-CSRF-Token', admin.csrf);
      expectContract('post', '/v1/admin/users/{id}/reset-password', 404, unknown);

      const editor = await as(ACCOUNTS.editor.email);
      expectContract(
        'post',
        '/v1/admin/users/{id}/reset-password',
        403,
        await editor.agent.post(path(ACCOUNTS.writer.id)).set('X-CSRF-Token', editor.csrf),
      );
    });
  });
});
