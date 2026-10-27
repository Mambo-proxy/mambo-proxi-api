/**
 * Outils des tests e2e de l'authentification et des utilisateurs : doubles de la file des e-mails et de la
 * limitation de débit, application de test, lecture des cookies, connexion complète (mot de passe + code reçu par
 * e-mail), comptes de démonstration du double de Prisma.
 */
import type { Server } from 'node:http';
import type { Type } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { expect, vi } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';
import {
  REMINDER_QUEUE_FACTORY,
  type ReminderJob,
  type ReminderQueueClient,
} from '../../src/modules/appointments/appointment-reminders.service.js';
import { MailQueueService } from '../../src/modules/mail/mail-queue.service.js';
import type { MailJob } from '../../src/modules/mail/mail.types.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { expectToMatchContract } from '../contract.js';
import { createPrismaDouble, type PrismaTables } from './prisma-double.js';

type Row = Record<string, unknown>;

export const PROBLEMS = 'https://api.mamboproxi.com/problems/';
/** Mot de passe des comptes de test (12 caractères au moins, absent de la liste des mots de passe compromis). */
export const PASSWORD = 'Le baobab de Bonapriso fleurit en mai';

/** Double de `MailQueueService` : enregistre les e-mails mis en file. */
export class MailQueueDouble {
  readonly jobs: MailJob[] = [];
  readonly enqueue = vi.fn((job: MailJob): Promise<void> => {
    this.jobs.push(job);
    return Promise.resolve();
  });
  readonly enqueueMany = vi.fn((jobs: MailJob[]): Promise<void> => {
    this.jobs.push(...jobs);
    return Promise.resolve();
  });

  reset(): void {
    this.jobs.length = 0;
    this.enqueue.mockClear();
    this.enqueueMany.mockClear();
  }

  /** Dernier e-mail d'un modèle envoyé à une adresse. */
  last(template: MailJob['template'], to: string): MailJob | undefined {
    return this.jobs.filter((job) => job.template === template && job.to === to).at(-1);
  }

  /** Dernier code de connexion envoyé à une adresse. */
  code(to: string): string {
    const code = this.last('otp-code', to)?.data['code'];
    if (typeof code !== 'string') throw new Error(`Aucun code envoyé à ${to}.`);
    return code;
  }

  /** Jeton du dernier lien (`?token=`) d'un modèle envoyé à une adresse. */
  token(template: 'password-reset' | 'user-invite', to: string): string {
    const actionUrl = this.last(template, to)?.data['actionUrl'];
    if (typeof actionUrl !== 'string') throw new Error(`Aucun lien « ${template} » envoyé à ${to}.`);
    const token = new URL(actionUrl).searchParams.get('token');
    if (!token) throw new Error(`Lien sans jeton : ${actionUrl}`);
    return token;
  }
}

/**
 * Double de la file des rappels de rendez-vous (`ReminderQueueClient`) : tâches différées en mémoire, avec la règle
 * de BullMQ (un identifiant déjà présent n'est pas ajouté de nouveau).
 */
export class ReminderQueueDouble implements ReminderQueueClient {
  readonly jobs = new Map<string, { data: ReminderJob; delay: number }>();
  readonly removed: string[] = [];
  readonly add = vi.fn((_name: string, data: ReminderJob, opts: { jobId?: string; delay?: number }) => {
    const jobId = opts.jobId ?? `job-${String(this.jobs.size + 1)}`;
    if (!this.jobs.has(jobId)) this.jobs.set(jobId, { data, delay: opts.delay ?? 0 });
    return Promise.resolve({ id: jobId });
  });
  readonly remove = vi.fn((jobId: string) => {
    this.removed.push(jobId);
    return Promise.resolve(this.jobs.delete(jobId) ? 1 : 0);
  });
  readonly close = vi.fn(() => Promise.resolve());

  reset(): void {
    this.jobs.clear();
    this.removed.length = 0;
    this.add.mockClear();
    this.remove.mockClear();
  }
}

/** Stockage de la limitation de débit remis à zéro entre les tests. */
export class ResettableThrottlerStorage implements ThrottlerStorage {
  private current = new ThrottlerStorageService();

  increment(...args: Parameters<ThrottlerStorage['increment']>): ReturnType<ThrottlerStorage['increment']> {
    return this.current.increment(...args);
  }

  reset(): void {
    this.current.onApplicationShutdown();
    this.current = new ThrottlerStorageService();
  }
}

export interface Doubles {
  mail: MailQueueDouble;
  throttler: ResettableThrottlerStorage;
  tables?: PrismaTables;
  /** File des rappels de rendez-vous (par défaut : un double neuf, jamais Redis). */
  reminders?: ReminderQueueDouble;
  /** Contrôleurs ajoutés à l'application (sondes de la garde globale). */
  controllers?: Type[];
}

/** Application complète ; `DiscoveryModule` en plus pour inspecter les routes déclarées. */
export async function createApp(doubles: Doubles): Promise<NestExpressApplication> {
  let builder = Test.createTestingModule({
    imports: [AppModule, DiscoveryModule],
    controllers: doubles.controllers ?? [],
  })
    .overrideProvider(MailQueueService)
    .useValue(doubles.mail)
    .overrideProvider(ThrottlerStorage)
    .useValue(doubles.throttler)
    .overrideProvider(REMINDER_QUEUE_FACTORY)
    .useValue(() => doubles.reminders ?? new ReminderQueueDouble());
  if (doubles.tables)
    builder = builder.overrideProvider(PrismaService).useValue(createPrismaDouble(doubles.tables));
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(app);
  await app.init();
  return app;
}

/** Statut attendu puis conformité au contrat. */
export function expectContract(
  method: string,
  path: string,
  status: number,
  response: request.Response,
): void {
  expect(response.status, `${method.toUpperCase()} ${path} : ${JSON.stringify(response.body)}`).toBe(status);
  expectToMatchContract(method, path, status, response);
}

export interface ParsedCookie {
  value: string;
  attributes: string[];
}

/** Cookie déposé par une réponse (`Set-Cookie`), ou `undefined`. */
export function setCookie(response: request.Response, name: string): ParsedCookie | undefined {
  const header = response.headers['set-cookie'] as unknown;
  const lines = Array.isArray(header) ? (header as string[]) : typeof header === 'string' ? [header] : [];
  const line = lines.find((item) => item.startsWith(`${name}=`));
  if (!line) return undefined;
  const [pair = '', ...attributes] = line.split(';').map((part) => part.trim());
  return { value: decodeURIComponent(pair.slice(name.length + 1)), attributes };
}

/** Session de test : agent supertest (cookies conservés), jeton CSRF à recopier dans `X-CSRF-Token`. */
export interface TestSession {
  agent: ReturnType<typeof request.agent>;
  csrf: string;
  /** Jeton de rafraîchissement déposé à la connexion. */
  refreshToken: string;
  /** Jeton d'appareil de confiance (`trustDevice: true`). */
  trustedDevice?: string;
}

/** Connexion complète : mot de passe (202), puis code reçu par e-mail (200). */
export async function signIn(
  server: Server,
  mail: MailQueueDouble,
  email: string,
  options: { password?: string; trustDevice?: boolean; agent?: ReturnType<typeof request.agent> } = {},
): Promise<TestSession> {
  const agent = options.agent ?? request.agent(server);
  const login = await agent.post('/v1/auth/login').send({ email, password: options.password ?? PASSWORD });
  expect(login.status, JSON.stringify(login.body)).toBe(202);
  const verify = await agent.post('/v1/auth/verify-otp').send({
    challengeId: (login.body as Row)['challengeId'],
    code: mail.code(email),
    trustDevice: options.trustDevice ?? false,
  });
  expect(verify.status, JSON.stringify(verify.body)).toBe(200);
  const csrf = setCookie(verify, 'mp_csrf')?.value;
  const refreshToken = setCookie(verify, 'mp_rt')?.value;
  if (!csrf || !refreshToken) throw new Error('Cookies mp_csrf ou mp_rt absents.');
  const trustedDevice = setCookie(verify, 'mp_td')?.value;
  return { agent, csrf, refreshToken, ...(trustedDevice ? { trustedDevice } : {}) };
}

const CREATED_AT = new Date('2026-06-02T09:00:00.000Z');

function userRow(fields: Row): Row {
  return {
    isActive: true,
    isDemo: false,
    passwordHash: null,
    activatedAt: CREATED_AT,
    invitedAt: CREATED_AT,
    invitedById: null,
    lastLoginAt: null,
    lastActiveAt: null,
    failedLoginCount: 0,
    lockedUntil: null,
    passwordChangedAt: null,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...fields,
  };
}

/** Comptes du double de Prisma : un par rôle (exemples du contrat), une invitation en cours, un compte désactivé. */
export const ACCOUNTS = {
  admin: { id: 'usr_mireille', email: 'mireille@mamboproxi.com', name: 'Mireille Bell', role: 'ADMIN' },
  manager: { id: 'usr_carine', email: 'carine.eboa@mamboproxi.com', name: 'Carine Eboa', role: 'MANAGER' },
  agent: { id: 'usr_paul', email: 'paul.ngando@mamboproxi.com', name: 'Paul Ngando', role: 'AGENT' },
  editor: { id: 'usr_equipe', email: 'equipe.douala@mamboproxi.com', name: 'Équipe Douala', role: 'EDITOR' },
  writer: { id: 'usr_grace', email: 'grace.nkongo@mamboproxi.com', name: 'Grace Nkongo', role: 'WRITER' },
  invited: { id: 'usr_awa', email: 'awa.mbappe@mamboproxi.com', name: 'Awa Mbappé', role: 'AGENT' },
  disabled: {
    id: 'usr_ancien',
    email: 'ancien.membre@mamboproxi.com',
    name: 'Ancien Membre',
    role: 'EDITOR',
  },
} as const;

/** Tables du double : comptes, paramètre `securite`, une demande et un rendez-vous assignés, une note. */
export function authTables(passwordHash: string): PrismaTables {
  const future = new Date(Date.now() + 3 * 24 * 60 * 60_000);
  return {
    setting: [
      {
        key: 'securite',
        value: { maintenanceMode: false, trustedDeviceDays: 30 },
        translations: null,
        updatedAt: CREATED_AT,
      },
    ],
    media: [],
    category: [],
    service: [],
    review: [],
    page: [],
    zone: [],
    redirect: [],
    jobOffer: [],
    user: [
      userRow({ ...ACCOUNTS.admin, passwordHash, lastLoginAt: new Date('2026-10-19T07:58:00.000Z') }),
      userRow({ ...ACCOUNTS.manager, passwordHash }),
      userRow({ ...ACCOUNTS.agent, passwordHash }),
      userRow({ ...ACCOUNTS.editor, passwordHash }),
      userRow({ ...ACCOUNTS.writer, passwordHash }),
      userRow({ ...ACCOUNTS.invited, activatedAt: null, invitedById: ACCOUNTS.admin.id }),
      userRow({ ...ACCOUNTS.disabled, passwordHash, isActive: false }),
    ],
    request: [
      { id: 'req_0151', assignedToId: ACCOUNTS.agent.id, status: 'EN_COURS' },
      { id: 'req_0120', assignedToId: ACCOUNTS.agent.id, status: 'CLOTUREE' },
      { id: 'req_0156', assignedToId: ACCOUNTS.editor.id, status: 'NOUVELLE' },
    ],
    appointment: [
      { id: 'apt_7', assignedToId: ACCOUNTS.agent.id, status: 'CONFIRME', endsAt: future },
      { id: 'apt_2', assignedToId: ACCOUNTS.agent.id, status: 'ANNULE', endsAt: future },
    ],
    requestNote: [
      { id: 'note_1', requestId: 'req_0156', authorId: ACCOUNTS.editor.id, body: 'Rappeler demain.' },
    ],
  };
}

/** Remet les tables du double dans leur état initial (même objet, lu par le double à chaque requête). */
export function resetTables(tables: PrismaTables, passwordHash: string): void {
  // Toutes les tables (facultatives comprises, créées par le double) sont vidées, puis remplies.
  for (const key of Object.keys(tables)) (tables as unknown as Record<string, unknown[]>)[key] = [];
  Object.assign(tables, authTables(passwordHash));
}
