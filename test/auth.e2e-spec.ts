/**
 * Tests e2e de l'authentification du back-office (connexion avec code par e-mail, appareils de confiance, rotation
 * des jetons, CSRF, verrouillage, mot de passe oublié) et de la garde globale (routes publiques, permissions des
 * routes `/v1/admin`, comparées aux `x-permissions` du contrat). Chaque réponse documentée est validée contre le
 * contrat.
 *
 * - « avec des doubles » : `PrismaService` remplacé par le double en mémoire, `MailQueueService` par un double qui
 *   garde les e-mails (codes et liens lus dans les e-mails, comme le ferait l'utilisateur).
 * - « avec la base réelle » : `E2E_REAL_SERVICES=true` ; comptes temporaires créés puis supprimés.
 */
import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { Controller, Get, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { DiscoveryService, Reflector } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { IS_PUBLIC_KEY, PERMISSIONS_KEY } from '../src/modules/auth/auth.decorators.js';
import { PasswordService } from '../src/modules/auth/password.service.js';
import { permissionsOf } from '../src/modules/auth/permissions.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
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
  setCookie,
  signIn,
} from './support/auth.js';
import type { PrismaTables } from './support/prisma-double.js';

type Row = Record<string, unknown>;

const MINUTE = 60_000;

function rows(tables: PrismaTables, name: keyof PrismaTables): Row[] {
  return tables[name] ?? [];
}

/** Sonde : une route du back-office déclarée sans permission est refusée à tous. */
@Controller('admin/sonde-sans-permission')
class UndeclaredAdminRouteController {
  @Get()
  probe(): { ok: true } {
    return { ok: true };
  }
}

describe('authentification (avec des doubles)', () => {
  const mail = new MailQueueDouble();
  const throttler = new ResettableThrottlerStorage();
  let app: NestExpressApplication;
  let server: Server;
  let tables: PrismaTables;
  let passwordHash: string;

  beforeAll(async () => {
    prepareContract('LoginResult', 'CurrentUser', 'Problem', 'AdminUser', 'TeamPresence');
    passwordHash = await new PasswordService().hash(PASSWORD);
    tables = authTables(passwordHash);
    app = await createApp({ mail, throttler, tables, controllers: [UndeclaredAdminRouteController] });
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

  describe('POST /v1/auth/login', () => {
    it('envoie un code à 6 chiffres par e-mail pour un appareil inconnu (202)', async () => {
      const before = Date.now();
      const response = await request(server)
        .post('/v1/auth/login')
        .send({ email: 'Mireille@MamboProxi.com', password: PASSWORD, rememberMe: true });

      expectContract('post', '/v1/auth/login', 202, response);
      const body = response.body as Row;
      expect(body).toMatchObject({ status: 'OTP_REQUIRED', emailHint: 'm•••••@mamboproxi.com' });
      expect(Date.parse(String(body['resendAvailableAt']))).toBeGreaterThanOrEqual(before + MINUTE - 1000);
      expect(setCookie(response, 'mp_at')).toBeUndefined();
      expect(mail.code(ACCOUNTS.admin.email)).toMatch(/^\d{6}$/);
      expect(mail.last('otp-code', ACCOUNTS.admin.email)).toMatchObject({ lang: 'fr' });

      const challenge = rows(tables, 'otpChallenge').find((row) => row['id'] === body['challengeId']);
      expect(challenge).toMatchObject({ userId: ACCOUNTS.admin.id, rememberMe: true, attempts: 0 });
      // Seul le condensat du code est enregistré.
      expect(challenge?.['codeHash']).not.toContain(mail.code(ACCOUNTS.admin.email));
    });

    it('répond 401 sans distinguer adresse inconnue, mot de passe faux, invitation ou compte désactivé', async () => {
      const attempts = [
        { email: 'inconnu@mamboproxi.com', password: PASSWORD },
        { email: ACCOUNTS.admin.email, password: 'mauvais mot de passe' },
        { email: ACCOUNTS.invited.email, password: PASSWORD },
        { email: ACCOUNTS.disabled.email, password: PASSWORD },
      ];
      for (const body of attempts) {
        const response = await request(server).post('/v1/auth/login').send(body);
        expectContract('post', '/v1/auth/login', 401, response);
        expect(response.body).toEqual({
          type: `${PROBLEMS}invalid-credentials`,
          title: 'Identifiants incorrects',
          status: 401,
          detail: "L'adresse e-mail ou le mot de passe est incorrect.",
        });
      }
      expect(mail.jobs).toEqual([]);
    });

    it('verrouille le compte 15 minutes à la 5e erreur (423), même avec le bon mot de passe ensuite', async () => {
      for (let attempt = 1; attempt <= 4; attempt += 1) {
        const response = await request(server)
          .post('/v1/auth/login')
          .send({ email: ACCOUNTS.manager.email, password: `erreur ${String(attempt)}` });
        expectContract('post', '/v1/auth/login', 401, response);
      }
      const locked = await request(server)
        .post('/v1/auth/login')
        .send({ email: ACCOUNTS.manager.email, password: 'erreur 5' });
      expectContract('post', '/v1/auth/login', 423, locked);
      expect((locked.body as Row)['detail']).toBe(
        'Trop de tentatives. Réessayez dans 15 minutes ou réinitialisez votre mot de passe.',
      );

      const stillLocked = await request(server)
        .post('/v1/auth/login')
        .send({ email: ACCOUNTS.manager.email, password: PASSWORD });
      expectContract('post', '/v1/auth/login', 423, stillLocked);

      // Verrou levé : le bon mot de passe remet le compteur à zéro.
      const user = rows(tables, 'user').find((row) => row['id'] === ACCOUNTS.manager.id)!;
      user['lockedUntil'] = new Date(Date.now() - 1000);
      const unlocked = await request(server)
        .post('/v1/auth/login')
        .send({ email: ACCOUNTS.manager.email, password: PASSWORD });
      expectContract('post', '/v1/auth/login', 202, unlocked);
      expect(user).toMatchObject({ failedLoginCount: 0, lockedUntil: null });
    });

    it('refuse un corps invalide (422)', async () => {
      const response = await request(server)
        .post('/v1/auth/login')
        .send({ email: 'pas-une-adresse', password: '' });

      expectContract('post', '/v1/auth/login', 422, response);
      expect((response.body as { errors: Row[] }).errors.map((error) => error['path']).sort()).toEqual([
        'email',
        'password',
      ]);
    });

    it('limite les tentatives par adresse IP (429)', async () => {
      let last: request.Response | undefined;
      for (let attempt = 0; attempt < 11; attempt += 1)
        last = await request(server)
          .post('/v1/auth/login')
          .send({ email: 'robot@example.com', password: 'x' });

      expectContract('post', '/v1/auth/login', 429, last!);
      expect(last!.headers['retry-after']).toBeDefined();
    });
  });

  describe('POST /v1/auth/verify-otp', () => {
    async function challenge(email: string = ACCOUNTS.admin.email): Promise<string> {
      const response = await request(server).post('/v1/auth/login').send({ email, password: PASSWORD });
      expect(response.status).toBe(202);
      return String((response.body as Row)['challengeId']);
    }

    it('ouvre la session : utilisateur, permissions et cookies httpOnly, SameSite=Lax (200)', async () => {
      const challengeId = await challenge();
      const response = await request(server)
        .post('/v1/auth/verify-otp')
        .send({ challengeId, code: mail.code(ACCOUNTS.admin.email) });

      expectContract('post', '/v1/auth/verify-otp', 200, response);
      expect(response.body).toMatchObject({
        status: 'AUTHENTICATED',
        user: {
          id: ACCOUNTS.admin.id,
          email: ACCOUNTS.admin.email,
          name: 'Mireille Bell',
          firstName: 'Mireille',
          initials: 'MB',
          role: 'ADMIN',
          permissions: permissionsOf('ADMIN'),
        },
      });
      const access = setCookie(response, 'mp_at');
      const refresh = setCookie(response, 'mp_rt');
      const csrf = setCookie(response, 'mp_csrf');
      expect(access?.attributes).toEqual(expect.arrayContaining(['HttpOnly', 'SameSite=Lax', 'Path=/']));
      expect(access?.attributes.some((attribute) => attribute === 'Max-Age=900')).toBe(true);
      expect(refresh?.attributes).toEqual(expect.arrayContaining(['HttpOnly', 'SameSite=Lax']));
      expect(csrf?.attributes).not.toContain('HttpOnly');
      // Sans « Rester connecté » : cookies de session du navigateur.
      expect(refresh?.attributes.some((attribute) => attribute.startsWith('Max-Age'))).toBe(false);
      expect(setCookie(response, 'mp_td')).toBeUndefined();
      expect(response.headers['cache-control']).toBe('no-store');

      const session = rows(tables, 'session').at(-1);
      expect(session).toMatchObject({ userId: ACCOUNTS.admin.id, rememberMe: false });
      expect(session?.['refreshTokenHash']).not.toBe(refresh?.value);
      expect(
        rows(tables, 'user').find((row) => row['id'] === ACCOUNTS.admin.id)?.['lastLoginAt'],
      ).toBeInstanceOf(Date);
    });

    it('décompte les essais (401), puis refuse le code au 5e essai faux', async () => {
      const challengeId = await challenge();
      const code = mail.code(ACCOUNTS.admin.email);
      const wrong = code === '000000' ? '111111' : '000000';

      const first = await request(server).post('/v1/auth/verify-otp').send({ challengeId, code: wrong });
      expectContract('post', '/v1/auth/verify-otp', 401, first);
      expect(first.body).toMatchObject({
        type: `${PROBLEMS}invalid-otp`,
        title: 'Code incorrect',
        detail: 'Ce code est incorrect. Il vous reste 4 essais.',
      });
      for (const left of [3, 2, 1]) {
        const response = await request(server).post('/v1/auth/verify-otp').send({ challengeId, code: wrong });
        expect((response.body as Row)['detail']).toBe(
          `Ce code est incorrect. Il vous reste ${String(left)} essai${left > 1 ? 's' : ''}.`,
        );
      }
      const fifth = await request(server).post('/v1/auth/verify-otp').send({ challengeId, code: wrong });
      expect((fifth.body as Row)['detail']).toBe(
        'Trop d’essais. Reconnectez-vous pour recevoir un nouveau code.',
      );

      const late = await request(server).post('/v1/auth/verify-otp').send({ challengeId, code });
      expectContract('post', '/v1/auth/verify-otp', 401, late);
    });

    it('refuse un code expiré, déjà utilisé ou un défi inconnu (401)', async () => {
      const challengeId = await challenge();
      const code = mail.code(ACCOUNTS.admin.email);
      const ok = await request(server).post('/v1/auth/verify-otp').send({ challengeId, code });
      expect(ok.status).toBe(200);
      const reused = await request(server).post('/v1/auth/verify-otp').send({ challengeId, code });
      expectContract('post', '/v1/auth/verify-otp', 401, reused);
      expect((reused.body as Row)['detail']).toBe(
        'Ce code a expiré. Reconnectez-vous pour en recevoir un nouveau.',
      );

      const expiredId = await challenge();
      rows(tables, 'otpChallenge').find((row) => row['id'] === expiredId)!['expiresAt'] = new Date(
        Date.now() - 1,
      );
      const expired = await request(server)
        .post('/v1/auth/verify-otp')
        .send({ challengeId: expiredId, code: mail.code(ACCOUNTS.admin.email) });
      expectContract('post', '/v1/auth/verify-otp', 401, expired);

      const unknown = await request(server)
        .post('/v1/auth/verify-otp')
        .send({ challengeId: 'inconnu', code });
      expectContract('post', '/v1/auth/verify-otp', 401, unknown);
    });

    it('refuse un corps invalide (422)', async () => {
      const response = await request(server)
        .post('/v1/auth/verify-otp')
        .send({ challengeId: '', code: '12ab' });

      expectContract('post', '/v1/auth/verify-otp', 422, response);
      expect((response.body as { errors: Row[] }).errors.map((error) => error['path']).sort()).toEqual([
        'challengeId',
        'code',
      ]);
    });

    it('refuse le code d’un compte verrouillé entre-temps (423)', async () => {
      const challengeId = await challenge();
      const admin = rows(tables, 'user').find((row) => row['id'] === ACCOUNTS.admin.id)!;
      admin['lockedUntil'] = new Date(Date.now() + 15 * MINUTE);
      const response = await request(server)
        .post('/v1/auth/verify-otp')
        .send({ challengeId, code: mail.code(ACCOUNTS.admin.email) });

      expectContract('post', '/v1/auth/verify-otp', 423, response);
      expect((response.body as Row)['type']).toBe(`${PROBLEMS}account-locked`);
    });

    it('mémorise l’appareil 30 jours : connexion suivante sans code (200 dès le mot de passe)', async () => {
      const agent = request.agent(server);
      const session = await signIn(server, mail, ACCOUNTS.admin.email, { agent, trustDevice: true });
      expect(session.trustedDevice).toBeDefined();
      const device = rows(tables, 'trustedDevice').at(-1);
      expect(device).toMatchObject({ userId: ACCOUNTS.admin.id });
      expect((device?.['expiresAt'] as Date).getTime()).toBeGreaterThan(Date.now() + 29 * 24 * 60 * MINUTE);

      mail.reset();
      const again = await agent
        .post('/v1/auth/login')
        .send({ email: ACCOUNTS.admin.email, password: PASSWORD });
      expectContract('post', '/v1/auth/login', 200, again);
      expect(again.body).toMatchObject({ status: 'AUTHENTICATED', user: { id: ACCOUNTS.admin.id } });
      expect(setCookie(again, 'mp_at')).toBeDefined();
      expect(mail.jobs).toEqual([]);

      // L'appareil d'un autre compte ne dispense pas du code.
      const other = await agent
        .post('/v1/auth/login')
        .send({ email: ACCOUNTS.manager.email, password: PASSWORD });
      expectContract('post', '/v1/auth/login', 202, other);

      // Paramètre `trustedDeviceDays` à 0 : code toujours demandé.
      rows(tables, 'setting')[0]['value'] = { maintenanceMode: false, trustedDeviceDays: 0 };
      const disabled = await agent
        .post('/v1/auth/login')
        .send({ email: ACCOUNTS.admin.email, password: PASSWORD });
      expectContract('post', '/v1/auth/login', 202, disabled);
    });

    it('« Rester connecté » : session de 30 jours et cookies persistants', async () => {
      const login = await request(server)
        .post('/v1/auth/login')
        .send({ email: ACCOUNTS.admin.email, password: PASSWORD, rememberMe: true });
      const response = await request(server)
        .post('/v1/auth/verify-otp')
        .send({ challengeId: (login.body as Row)['challengeId'], code: mail.code(ACCOUNTS.admin.email) });

      expect(response.status).toBe(200);
      const maxAge = setCookie(response, 'mp_rt')
        ?.attributes.find((attribute) => attribute.startsWith('Max-Age='))
        ?.slice('Max-Age='.length);
      expect(Number(maxAge)).toBeGreaterThan(29 * 24 * 3600);
      expect(rows(tables, 'session').at(-1)).toMatchObject({ rememberMe: true });
    });
  });

  describe('POST /v1/auth/resend-otp', () => {
    it('attend 60 s (429 avec Retry-After), puis envoie un nouveau code ; l’ancien ne vaut plus (202)', async () => {
      const login = await request(server)
        .post('/v1/auth/login')
        .send({ email: ACCOUNTS.admin.email, password: PASSWORD });
      const challengeId = String((login.body as Row)['challengeId']);
      const firstCode = mail.code(ACCOUNTS.admin.email);

      const tooSoon = await request(server).post('/v1/auth/resend-otp').send({ challengeId });
      expectContract('post', '/v1/auth/resend-otp', 429, tooSoon);
      expect(Number(tooSoon.headers['retry-after'])).toBeGreaterThan(0);

      rows(tables, 'otpChallenge').find((row) => row['id'] === challengeId)!['resendAvailableAt'] = new Date(
        Date.now() - 1,
      );
      const resent = await request(server).post('/v1/auth/resend-otp').send({ challengeId });
      expectContract('post', '/v1/auth/resend-otp', 202, resent);
      expect(resent.body).toMatchObject({ status: 'OTP_REQUIRED', challengeId });
      expect(mail.jobs.filter((job) => job.template === 'otp-code')).toHaveLength(2);

      const secondCode = mail.code(ACCOUNTS.admin.email);
      if (secondCode !== firstCode) {
        const old = await request(server).post('/v1/auth/verify-otp').send({ challengeId, code: firstCode });
        expect(old.status).toBe(401);
      }
      const ok = await request(server).post('/v1/auth/verify-otp').send({ challengeId, code: secondCode });
      expect(ok.status).toBe(200);
    });

    it('refuse un défi inconnu ou clos (401) et un corps invalide (422)', async () => {
      const response = await request(server).post('/v1/auth/resend-otp').send({ challengeId: 'inconnu' });

      expectContract('post', '/v1/auth/resend-otp', 401, response);
      expect((response.body as Row)['type']).toBe(`${PROBLEMS}invalid-otp`);

      const invalid = await request(server).post('/v1/auth/resend-otp').send({});
      expectContract('post', '/v1/auth/resend-otp', 422, invalid);
    });
  });

  describe('GET /v1/auth/me', () => {
    it('renvoie l’utilisateur connecté et ses permissions (200)', async () => {
      const { agent } = await signIn(server, mail, ACCOUNTS.agent.email);
      const response = await agent.get('/v1/auth/me');

      expectContract('get', '/v1/auth/me', 200, response);
      expect(response.body).toEqual({
        id: ACCOUNTS.agent.id,
        email: ACCOUNTS.agent.email,
        name: 'Paul Ngando',
        firstName: 'Paul',
        initials: 'PN',
        role: 'AGENT',
        permissions: [
          'dashboard:read',
          'requests:read-assigned',
          'requests:write-assigned',
          'appointments:read-assigned',
          'appointments:write-assigned',
        ],
        lastLoginAt: expect.any(String) as string,
      });
    });

    it('répond 401 sans session, avec un jeton modifié ou une session révoquée', async () => {
      const anonymous = await request(server).get('/v1/auth/me');
      expectContract('get', '/v1/auth/me', 401, anonymous);
      expect(anonymous.body).toEqual({
        type: `${PROBLEMS}unauthorized`,
        title: 'Session expirée',
        status: 401,
        detail: 'Veuillez vous reconnecter.',
      });

      const forged = await request(server).get('/v1/auth/me').set('Cookie', 'mp_at=eyJhbGciOiJub25lIn0.e30.');
      expectContract('get', '/v1/auth/me', 401, forged);

      const { agent } = await signIn(server, mail, ACCOUNTS.agent.email);
      for (const session of rows(tables, 'session')) session['revokedAt'] = new Date();
      expectContract('get', '/v1/auth/me', 401, await agent.get('/v1/auth/me'));
    });

    it('met à jour la dernière activité au plus une fois par minute', async () => {
      const { agent } = await signIn(server, mail, ACCOUNTS.agent.email);
      const session = rows(tables, 'session').at(-1)!;
      const user = rows(tables, 'user').find((row) => row['id'] === ACCOUNTS.agent.id)!;
      const old = new Date(Date.now() - 2 * MINUTE);
      session['lastActiveAt'] = old;
      user['lastActiveAt'] = old;

      await agent.get('/v1/auth/me');
      const touched = session['lastActiveAt'] as Date;
      expect(touched.getTime()).toBeGreaterThan(old.getTime());
      expect(user['lastActiveAt']).toEqual(touched);
      await agent.get('/v1/auth/me');
      expect(session['lastActiveAt']).toBe(touched);
    });
  });

  describe('POST /v1/auth/refresh', () => {
    it('fait tourner le jeton de rafraîchissement : nouveaux cookies, ancienne session remplacée (204)', async () => {
      const { agent, refreshToken } = await signIn(server, mail, ACCOUNTS.editor.email);
      const response = await agent.post('/v1/auth/refresh');

      expectContract('post', '/v1/auth/refresh', 204, response);
      const next = setCookie(response, 'mp_rt');
      expect(next?.value).toBeDefined();
      expect(next?.value).not.toBe(refreshToken);
      expect(setCookie(response, 'mp_at')).toBeDefined();
      expect(setCookie(response, 'mp_csrf')).toBeDefined();
      const [first, second] = rows(tables, 'session');
      expect(first).toMatchObject({ replacedById: second?.['id'] });
      expect(first?.['revokedAt']).toBeInstanceOf(Date);
      expect(second?.['expiresAt']).toEqual(first?.['expiresAt']);

      expectContract('get', '/v1/auth/me', 200, await agent.get('/v1/auth/me'));
    });

    it('ignore sans nouveaux cookies un jeton tout juste remplacé (onglets simultanés)', async () => {
      const { agent, refreshToken } = await signIn(server, mail, ACCOUNTS.editor.email);
      expect((await agent.post('/v1/auth/refresh')).status).toBe(204);

      const concurrent = await request(server)
        .post('/v1/auth/refresh')
        .set('Cookie', `mp_rt=${refreshToken}`);
      expectContract('post', '/v1/auth/refresh', 204, concurrent);
      expect(setCookie(concurrent, 'mp_rt')).toBeUndefined();
      expectContract('get', '/v1/auth/me', 200, await agent.get('/v1/auth/me'));
    });

    it('révoque toutes les sessions quand un jeton remplacé est réutilisé plus tard (401)', async () => {
      const { agent, refreshToken } = await signIn(server, mail, ACCOUNTS.editor.email);
      const other = await signIn(server, mail, ACCOUNTS.editor.email);
      expect((await agent.post('/v1/auth/refresh')).status).toBe(204);
      const replaced = rows(tables, 'session').find(
        (row) => row['replacedById'] !== undefined && row['replacedById'] !== null,
      )!;
      replaced['revokedAt'] = new Date(Date.now() - MINUTE);

      const reuse = await request(server).post('/v1/auth/refresh').set('Cookie', `mp_rt=${refreshToken}`);
      expectContract('post', '/v1/auth/refresh', 401, reuse);
      expect(setCookie(reuse, 'mp_rt')?.attributes).toEqual(
        expect.arrayContaining([expect.stringMatching(/^Expires=/)]),
      );

      expect((await agent.get('/v1/auth/me')).status).toBe(401);
      expect((await other.agent.get('/v1/auth/me')).status).toBe(401);
      expect(rows(tables, 'session').every((row) => row['revokedAt'] instanceof Date)).toBe(true);
    });

    it('refuse un jeton absent, inconnu ou expiré (401)', async () => {
      expectContract('post', '/v1/auth/refresh', 401, await request(server).post('/v1/auth/refresh'));
      expectContract(
        'post',
        '/v1/auth/refresh',
        401,
        await request(server).post('/v1/auth/refresh').set('Cookie', 'mp_rt=inconnu'),
      );
      const { agent } = await signIn(server, mail, ACCOUNTS.editor.email);
      rows(tables, 'session').at(-1)!['expiresAt'] = new Date(Date.now() - 1);
      expectContract('post', '/v1/auth/refresh', 401, await agent.post('/v1/auth/refresh'));
    });
  });

  describe('POST /v1/auth/logout', () => {
    it('exige le jeton CSRF, révoque la session et efface les cookies (204)', async () => {
      const { agent, csrf } = await signIn(server, mail, ACCOUNTS.writer.email, { trustDevice: true });

      const withoutCsrf = await agent.post('/v1/auth/logout');
      expectContract('post', '/v1/auth/logout', 403, withoutCsrf);
      expect((withoutCsrf.body as Row)['type']).toBe(`${PROBLEMS}csrf-token-invalid`);

      const response = await agent.post('/v1/auth/logout').set('X-CSRF-Token', csrf);
      expectContract('post', '/v1/auth/logout', 204, response);
      for (const name of ['mp_at', 'mp_rt', 'mp_csrf'])
        expect(setCookie(response, name)?.value, name).toBe('');
      expect(setCookie(response, 'mp_td')).toBeUndefined();
      expect(rows(tables, 'session').at(-1)?.['revokedAt']).toBeInstanceOf(Date);
      expectContract('get', '/v1/auth/me', 401, await agent.get('/v1/auth/me'));
    });

    it('accepte une session au jeton d’accès expiré grâce au jeton de rafraîchissement', async () => {
      const { csrf, refreshToken } = await signIn(server, mail, ACCOUNTS.writer.email);
      const response = await request(server)
        .post('/v1/auth/logout')
        .set('Cookie', `mp_rt=${refreshToken}; mp_csrf=${csrf}`)
        .set('X-CSRF-Token', csrf);

      expectContract('post', '/v1/auth/logout', 204, response);
      expect(rows(tables, 'session').at(-1)?.['revokedAt']).toBeInstanceOf(Date);
    });

    it('répond 401 sans session', async () => {
      expectContract('post', '/v1/auth/logout', 401, await request(server).post('/v1/auth/logout'));
    });
  });

  describe('mot de passe oublié et réinitialisation', () => {
    const forgot = (email: string) => request(server).post('/v1/auth/forgot-password').send({ email });

    it('répond la même chose que le compte existe ou non ; seul un compte actif reçoit le lien (202)', async () => {
      const known = await forgot(ACCOUNTS.manager.email);
      const unknown = await forgot('personne@mamboproxi.com');
      const disabled = await forgot(ACCOUNTS.disabled.email);

      for (const response of [known, unknown, disabled]) {
        expectContract('post', '/v1/auth/forgot-password', 202, response);
        expect(response.body).toEqual({
          message:
            'Si un compte correspond à cette adresse, vous allez recevoir un lien de réinitialisation.',
        });
      }
      await expect.poll(() => mail.jobs.length).toBe(1);
      const job = mail.last('password-reset', ACCOUNTS.manager.email);
      expect(String(job?.data['actionUrl'])).toMatch(
        /^http:\/\/localhost:3000\/admin\/nouveau-mot-de-passe\?token=/,
      );
      expect(rows(tables, 'passwordReset')).toHaveLength(1);
      expect(rows(tables, 'passwordReset')[0]?.['tokenHash']).not.toBe(
        mail.token('password-reset', ACCOUNTS.manager.email),
      );
    });

    it('refuse une adresse invalide sans envoyer d’e-mail (422)', async () => {
      const response = await forgot('pas-une-adresse');

      expectContract('post', '/v1/auth/forgot-password', 422, response);
      expect((response.body as { errors: Row[] }).errors.map((error) => error['path'])).toEqual(['email']);
      expect(mail.jobs).toEqual([]);
    });

    it('change le mot de passe, révoque sessions et appareils, puis le lien ne sert plus (204, 410)', async () => {
      const { agent } = await signIn(server, mail, ACCOUNTS.manager.email, { trustDevice: true });
      await forgot(ACCOUNTS.manager.email);
      await expect.poll(() => mail.last('password-reset', ACCOUNTS.manager.email)).toBeDefined();
      const token = mail.token('password-reset', ACCOUNTS.manager.email);
      const password = 'Nouveau mot de passe pour Carine';

      const response = await request(server).post('/v1/auth/reset-password').send({ token, password });
      expectContract('post', '/v1/auth/reset-password', 204, response);
      expect((await agent.get('/v1/auth/me')).status).toBe(401);
      expect(rows(tables, 'trustedDevice').every((row) => row['revokedAt'] instanceof Date)).toBe(true);

      const reused = await request(server).post('/v1/auth/reset-password').send({ token, password });
      expectContract('post', '/v1/auth/reset-password', 410, reused);
      expect(reused.body).toMatchObject({
        status: 410,
        detail: 'Ce lien a expiré. Demandez un nouveau lien de réinitialisation.',
      });

      const old = await request(server)
        .post('/v1/auth/login')
        .send({ email: ACCOUNTS.manager.email, password: PASSWORD });
      expect(old.status).toBe(401);
      const fresh = await request(server)
        .post('/v1/auth/login')
        .send({ email: ACCOUNTS.manager.email, password });
      expect(fresh.status).toBe(202);
    });

    it('refuse un mot de passe trop court ou compromis (422) et un lien expiré (410)', async () => {
      await forgot(ACCOUNTS.manager.email);
      await expect.poll(() => mail.last('password-reset', ACCOUNTS.manager.email)).toBeDefined();
      const token = mail.token('password-reset', ACCOUNTS.manager.email);

      const short = await request(server).post('/v1/auth/reset-password').send({ token, password: 'court' });
      expectContract('post', '/v1/auth/reset-password', 422, short);
      expect((short.body as { errors: Row[] }).errors[0]).toMatchObject({ path: 'password' });

      const common = await request(server)
        .post('/v1/auth/reset-password')
        .send({ token, password: 'motdepasse123' });
      expectContract('post', '/v1/auth/reset-password', 422, common);
      expect((common.body as { errors: Row[] }).errors[0]).toMatchObject({ code: 'compromised_password' });

      const sameAsEmail = await request(server)
        .post('/v1/auth/reset-password')
        .send({ token, password: ACCOUNTS.manager.email });
      expectContract('post', '/v1/auth/reset-password', 422, sameAsEmail);

      rows(tables, 'passwordReset')[0]['expiresAt'] = new Date(Date.now() - 1);
      const expired = await request(server)
        .post('/v1/auth/reset-password')
        .send({ token, password: 'Nouveau mot de passe pour Carine' });
      expectContract('post', '/v1/auth/reset-password', 410, expired);
    });
  });

  describe('POST /v1/auth/accept-invite', () => {
    it('active le compte invité avec son premier mot de passe, une seule fois (204, 410)', async () => {
      const admin = await signIn(server, mail, ACCOUNTS.admin.email);
      const resend = await admin.agent
        .post(`/v1/admin/users/${ACCOUNTS.invited.id}/reset-password`)
        .set('X-CSRF-Token', admin.csrf);
      expect(resend.status).toBe(202);
      const token = mail.token('user-invite', ACCOUNTS.invited.email);
      const password = 'Premier mot de passe pour Awa';

      const accepted = await request(server).post('/v1/auth/accept-invite').send({ token, password });
      expectContract('post', '/v1/auth/accept-invite', 204, accepted);
      expect(
        rows(tables, 'user').find((row) => row['id'] === ACCOUNTS.invited.id)?.['activatedAt'],
      ).toBeInstanceOf(Date);
      const again = await request(server).post('/v1/auth/accept-invite').send({ token, password });
      expectContract('post', '/v1/auth/accept-invite', 410, again);
      expect((again.body as Row)['detail']).toBe(
        'Cette invitation a expiré. Demandez à un administrateur de vous inviter à nouveau.',
      );

      await signIn(server, mail, ACCOUNTS.invited.email, { password });
    });

    it('refuse un jeton inconnu (410) et un corps invalide (422)', async () => {
      expectContract(
        'post',
        '/v1/auth/accept-invite',
        410,
        await request(server).post('/v1/auth/accept-invite').send({ token: 'inconnu', password: PASSWORD }),
      );
      expectContract(
        'post',
        '/v1/auth/accept-invite',
        422,
        await request(server).post('/v1/auth/accept-invite').send({ token: 'inconnu' }),
      );
    });
  });

  describe('garde globale', () => {
    it('refuse une mutation du back-office sans jeton CSRF, ou avec celui d’un autre compte (403)', async () => {
      const admin = await signIn(server, mail, ACCOUNTS.admin.email);
      const manager = await signIn(server, mail, ACCOUNTS.manager.email);
      const path = `/v1/admin/users/${ACCOUNTS.agent.id}`;

      const missing = await admin.agent.patch(path).send({ name: 'Paul N.' });
      expectContract('patch', '/v1/admin/users/{id}', 403, missing);
      expect((missing.body as Row)['type']).toBe(`${PROBLEMS}csrf-token-invalid`);

      const foreign = await admin.agent
        .patch(path)
        .set('Cookie', `mp_csrf=${manager.csrf}`)
        .set('X-CSRF-Token', manager.csrf)
        .send({ name: 'Paul N.' });
      expect(foreign.status).toBe(403);

      const forged = await admin.agent
        .patch(path)
        .set('X-CSRF-Token', 'jeton.invente')
        .send({ name: 'Paul N.' });
      expect(forged.status).toBe(403);
    });

    it('refuse à tous une route du back-office déclarée sans permission (403)', async () => {
      const admin = await signIn(server, mail, ACCOUNTS.admin.email);
      const response = await admin.agent.get('/v1/admin/sonde-sans-permission');

      expect(response.status).toBe(403);
      expect((response.body as Row)['type']).toBe(`${PROBLEMS}forbidden`);
      expect((await request(server).get('/v1/admin/sonde-sans-permission')).status).toBe(401);
    });

    it('laisse les routes publiques du site accessibles sans session', async () => {
      expect((await request(server).get('/v1/health')).status).not.toBe(401);
      expect((await request(server).get('/v1/zones')).status).toBe(200);
    });

    it('déclare pour chaque route les droits du contrat (publique, session, x-permissions)', () => {
      type Operation = { security?: unknown[]; 'x-permissions'?: string[] };
      const contract = parse(readFileSync(new URL('../contracts/openapi.yaml', import.meta.url), 'utf8')) as {
        paths: Record<string, Record<string, Operation>>;
      };
      const discovery = app.get(DiscoveryService);
      const reflector = app.get(Reflector);
      // Déconnexion : publique pour la garde, la session étant vérifiée par la route (jeton d'accès ou de rafraîchissement).
      const checkedByHandler = new Set(['post /v1/auth/logout']);
      const routes: string[] = [];

      for (const wrapper of discovery.getControllers()) {
        const controller = wrapper.metatype as (new (...args: never[]) => unknown) | null;
        if (!controller || controller === UndeclaredAdminRouteController) continue;
        const base = String(Reflect.getMetadata(PATH_METADATA, controller) ?? '');
        const prototype = controller.prototype as Record<string, unknown>;
        for (const name of Object.getOwnPropertyNames(prototype)) {
          const handler = prototype[name];
          if (name === 'constructor' || typeof handler !== 'function') continue;
          const methodCode = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
          if (methodCode === undefined) continue;
          const method = RequestMethod[methodCode].toLowerCase();
          const sub = String(Reflect.getMetadata(PATH_METADATA, handler) ?? '');
          const path = `/v1/${[base, sub].filter((part) => part && part !== '/').join('/')}`
            .replace(/\/+/g, '/')
            .replace(/\/$/, '')
            .replace(/:(\w+)/g, '{$1}');
          const key = `${method} ${path}`;
          routes.push(key);

          const operation = contract.paths[path]?.[method];
          expect(operation, `${key} : opération absente du contrat`).toBeDefined();
          const isPublic =
            reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [handler, controller]) === true;
          const permissions = reflector.getAllAndOverride<string[] | undefined>(PERMISSIONS_KEY, [
            handler,
            controller,
          ]);
          const contractPublic = (operation?.security ?? []).length === 0;
          if (!checkedByHandler.has(key))
            expect(isPublic, `${key} : publique selon le contrat`).toBe(contractPublic);
          expect([...(permissions ?? [])].sort(), `${key} : x-permissions`).toEqual(
            [...(operation?.['x-permissions'] ?? [])].sort(),
          );
        }
      }
      expect(routes).toEqual(
        expect.arrayContaining(['post /v1/auth/login', 'get /v1/admin/users', 'get /v1/health']),
      );
    });
  });
});

describe.runIf(process.env['E2E_REAL_SERVICES'] === 'true')(
  'authentification et utilisateurs (avec la base réelle)',
  () => {
    const mail = new MailQueueDouble();
    const throttler = new ResettableThrottlerStorage();
    const runId = String(Date.now());
    const adminEmail = `e2e.admin.${runId}@example.com`;
    const managerEmail = `e2e.manager.${runId}@example.com`;
    const invitedEmail = `e2e.invite.${runId}@example.com`;
    let app: NestExpressApplication;
    let server: Server;
    let prisma: PrismaService;

    beforeAll(async () => {
      prepareContract('LoginResult', 'CurrentUser', 'Problem', 'AdminUser', 'TeamPresence');
      app = await createApp({ mail, throttler });
      server = app.getHttpServer();
      prisma = app.get(PrismaService);
      const passwordHash = await new PasswordService().hash(PASSWORD);
      const now = new Date();
      await prisma.user.createMany({
        data: [
          {
            email: adminEmail,
            name: 'Admin Essai',
            role: 'ADMIN',
            passwordHash,
            activatedAt: now,
            invitedAt: now,
          },
          {
            email: managerEmail,
            name: 'Responsable Essai',
            role: 'MANAGER',
            passwordHash,
            activatedAt: now,
            invitedAt: now,
          },
        ],
      });
    }, CONTRACT_WARM_UP_TIMEOUT);

    afterAll(async () => {
      const users = await prisma.user.findMany({
        where: { email: { in: [adminEmail, managerEmail, invitedEmail] } },
        select: { id: true },
      });
      const ids = users.map((user) => user.id);
      await prisma.auditLog.deleteMany({
        where: { OR: [{ actorId: { in: ids } }, { entityId: { in: ids } }] },
      });
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
      await app.close();
    });

    beforeEach(() => {
      mail.reset();
      throttler.reset();
    });

    it('connexion avec code, profil, rotation des jetons et déconnexion', async () => {
      const session = await signIn(server, mail, adminEmail, { trustDevice: true });
      const me = await session.agent.get('/v1/auth/me');
      expectContract('get', '/v1/auth/me', 200, me);
      expect(me.body).toMatchObject({ email: adminEmail, role: 'ADMIN', initials: 'AE' });

      const refreshed = await session.agent.post('/v1/auth/refresh');
      expectContract('post', '/v1/auth/refresh', 204, refreshed);
      const csrf = setCookie(refreshed, 'mp_csrf')?.value ?? session.csrf;
      expectContract('get', '/v1/auth/me', 200, await session.agent.get('/v1/auth/me'));

      // Appareil de confiance : la connexion suivante ne demande pas de code.
      const again = await session.agent
        .post('/v1/auth/login')
        .send({ email: adminEmail, password: PASSWORD });
      expectContract('post', '/v1/auth/login', 200, again);

      expectContract(
        'post',
        '/v1/auth/logout',
        204,
        await session.agent
          .post('/v1/auth/logout')
          .set('X-CSRF-Token', setCookie(again, 'mp_csrf')?.value ?? csrf),
      );
      expectContract('get', '/v1/auth/me', 401, await session.agent.get('/v1/auth/me'));
    });

    it('utilisateurs : liste, présence, rôles, invitation, acceptation et suppression', async () => {
      const admin = await signIn(server, mail, adminEmail);
      const manager = await signIn(server, mail, managerEmail);

      const list = await admin.agent.get('/v1/admin/users');
      expectContract('get', '/v1/admin/users', 200, list);
      expect((list.body as Row[]).map((user) => user['email'])).toEqual(
        expect.arrayContaining([adminEmail, managerEmail]),
      );
      expectContract('get', '/v1/admin/users', 403, await manager.agent.get('/v1/admin/users'));

      const presence = await manager.agent.get('/v1/admin/users/presence');
      expectContract('get', '/v1/admin/users/presence', 200, presence);
      const members = (presence.body as { data: { user: Row; online: boolean }[] }).data;
      expect(members.find((member) => member.user['name'] === 'Admin Essai')?.online).toBe(true);
      expectContract('get', '/v1/admin/roles', 200, await manager.agent.get('/v1/admin/roles'));

      const invited = await admin.agent
        .post('/v1/admin/users/invite')
        .set('X-CSRF-Token', admin.csrf)
        .send({ email: invitedEmail, name: 'Invitée Essai', role: 'WRITER' });
      expectContract('post', '/v1/admin/users/invite', 201, invited);
      const invitedId = String((invited.body as Row)['id']);
      const password = 'Premier mot de passe de l’invitée';
      expectContract(
        'post',
        '/v1/auth/accept-invite',
        204,
        await request(server)
          .post('/v1/auth/accept-invite')
          .send({ token: mail.token('user-invite', invitedEmail), password }),
      );
      await signIn(server, mail, invitedEmail, { password });

      const removed = await admin.agent
        .delete(`/v1/admin/users/${invitedId}`)
        .set('X-CSRF-Token', admin.csrf);
      expectContract('delete', '/v1/admin/users/{id}', 204, removed);
      expect(await prisma.user.findUnique({ where: { id: invitedId } })).toBeNull();
    });

    // Comptes de démonstration du seed avec `SEED_DEMO_PASSWORD` (CI) : mot de passe haché par le seed.
    it.runIf(Boolean(process.env['SEED_DEMO_PASSWORD']))(
      'connexion d’un compte de démonstration du seed',
      async () => {
        const started = new Date();
        const session = await signIn(server, mail, ACCOUNTS.manager.email, {
          password: process.env['SEED_DEMO_PASSWORD'],
        });
        const me = await session.agent.get('/v1/auth/me');
        expectContract('get', '/v1/auth/me', 200, me);
        expect(me.body).toMatchObject({ name: 'Carine Eboa', role: 'MANAGER', initials: 'CE' });

        const carine = await prisma.user.findUnique({
          where: { email: ACCOUNTS.manager.email },
          select: { id: true },
        });
        await prisma.session.deleteMany({ where: { userId: carine?.id, createdAt: { gte: started } } });
      },
    );
  },
);
