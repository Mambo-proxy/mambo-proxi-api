/**
 * Tests e2e des formulaires publics (devis, contact, inscription, formation, partenariat, événement) sur l'application
 * NestJS complète ; chaque réponse est validée contre le contrat.
 *
 * - « avec des doubles » : `PrismaService` est remplacé par le double en mémoire (`test/support/prisma-double.ts`),
 *   `MailQueueService` par un double qui enregistre les e-mails mis en file, et Cloudflare Turnstile par un `fetch`
 *   simulé (clé secrète de test distincte de la clé d'essai, pour que la vérification soit réellement appelée).
 * - « avec la base réelle » : activés par `E2E_REAL_SERVICES=true` (base migrée et remplie par `pnpm db:seed`) ; une
 *   demande de chaque type est créée (jeton Turnstile vide, accepté hors production), puis supprimée.
 */
import type { Server } from 'node:http';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { TURNSTILE_VERIFY_URL } from '../src/common/anti-spam/turnstile.service.js';
import { PUBLIC_FORM_THROTTLE } from '../src/common/throttling/app-throttler.guard.js';
import { MailQueueService } from '../src/modules/mail/mail-queue.service.js';
import type { MailJob } from '../src/modules/mail/mail.types.js';
import { formatReference, referenceYear } from '../src/modules/requests/reference.js';
import { REQUEST_DUE_DELAY_MS } from '../src/modules/requests/requests.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { CONTRACT_WARM_UP_TIMEOUT, expectToMatchContract, prepareContract } from './contract.js';
import { FIXTURE_DATE, publicContentTables } from './fixtures/public-content.js';
import { createPrismaDouble, type PrismaTables } from './support/prisma-double.js';

type Body = Record<string, unknown>;
type Row = Record<string, unknown>;

const ACCEPTED_MESSAGE =
  'Merci, votre demande est bien envoyée ! Vous recevrez un e-mail de confirmation dans quelques instants.';
const REFERENCE_PATTERN = /^MP-\d{4}-\d{4,}$/;
const PROBLEMS = 'https://api.mamboproxi.com/problems/';
const TEAM_RECIPIENTS = ['equipe.douala@mamboproxi.com', 'mireille@mamboproxi.com'];
/** Clé secrète des tests : la vérification Turnstile passe par le `fetch` simulé. */
const E2E_TURNSTILE_SECRET = 'e2e-turnstile-secret';
const REFUSED_TOKEN = 'jeton-refuse';
const FUTURE = new Date('2099-06-01T18:00:00.000Z');

/** Double de `MailQueueService` : enregistre les e-mails mis en file. */
class MailQueueDouble {
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
}

/** Stockage de la limitation de débit remis à zéro entre les tests (5 envois par minute et par formulaire). */
class ResettableThrottlerStorage implements ThrottlerStorage {
  private current = new ThrottlerStorageService();

  increment(...args: Parameters<ThrottlerStorage['increment']>): ReturnType<ThrottlerStorage['increment']> {
    return this.current.increment(...args);
  }

  reset(): void {
    this.current.onApplicationShutdown();
    this.current = new ThrottlerStorageService();
  }
}

interface Doubles {
  mail: MailQueueDouble;
  throttler: ResettableThrottlerStorage;
  tables?: PrismaTables;
}

async function createApp(doubles: Doubles): Promise<NestExpressApplication> {
  let builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MailQueueService)
    .useValue(doubles.mail)
    .overrideProvider(ThrottlerStorage)
    .useValue(doubles.throttler);
  if (doubles.tables)
    builder = builder.overrideProvider(PrismaService).useValue(createPrismaDouble(doubles.tables));
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(app);
  await app.init();
  return app;
}

/** Envoi validé contre le contrat (statut attendu, en-têtes obligatoires, schéma du corps). */
async function post(
  app: NestExpressApplication,
  path: string,
  body: unknown,
  status: number,
  headers: Record<string, string> = {},
): Promise<request.Response> {
  const server: Server = app.getHttpServer();
  const response = await request(server)
    .post(path)
    .set(headers)
    .send(body as object);
  expect(response.status, `${path} : ${JSON.stringify(response.body)}`).toBe(status);
  expectToMatchContract('post', path, status, response);
  return response;
}

function antiSpam(overrides: Body = {}): Body {
  return {
    turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX',
    honeypot: '',
    startedAt: new Date(Date.now() - 60_000).toISOString(),
    ...overrides,
  };
}

function quoteBody(overrides: Body = {}): Body {
  return {
    categorySlug: 'experience',
    serviceSlug: 'chef-prive',
    needs: { eventDate: '2026-11-14', guests: 12, occasion: 'Anniversaire' },
    description: 'Dîner pour les 60 ans de ma mère, cuisine camerounaise revisitée, un invité végétarien.',
    contact: {
      fullName: 'Aurélie Kamga',
      email: 'Aurelie.K@example.com',
      phone: '+237612345678',
      country: 'CM',
      city: 'Bonapriso, Douala',
    },
    contactPreference: 'WHATSAPP',
    consent: true,
    antiSpam: antiSpam(),
    ...overrides,
  };
}

function contactMessageBody(overrides: Body = {}): Body {
  return {
    type: 'INFORMATION',
    contact: {
      fullName: 'Paul Ekotto',
      email: 'paul.ekotto@example.com',
      phone: '+33600000000',
      country: 'FR',
    },
    subject: 'Information sur un service',
    serviceSlug: 'chef-prive',
    message: 'Bonjour, je souhaiterais savoir comment se déroule une prestation de chef à Douala.',
    consent: true,
    antiSpam: antiSpam(),
    ...overrides,
  };
}

function registrationBody(overrides: Body = {}): Body {
  return {
    profile: 'PROFESSIONNEL',
    firstName: 'Marie Claire',
    lastName: 'Ndongo',
    email: 'marie.ndongo@example.com',
    phone: '+237690000000',
    country: 'CM',
    city: 'Akwa, Douala',
    interests: ['experience'],
    organization: 'Saveurs du Wouri',
    activity: 'Traiteur',
    newsletter: true,
    consent: true,
    antiSpam: antiSpam(),
    ...overrides,
  };
}

function trainingBody(overrides: Body = {}): Body {
  return {
    trainingSlug: 'accueil-relation-client',
    organization: 'Hôtel La Falaise',
    participants: 12,
    period: 'Janvier 2027',
    contact: { fullName: 'Jean Mbarga', email: 'jean.mbarga@example.com', phone: '+237677000000' },
    message: 'Formation de notre équipe de réception avant la haute saison.',
    consent: true,
    antiSpam: antiSpam(),
    ...overrides,
  };
}

function partnerBody(overrides: Body = {}): Body {
  return {
    partnershipType: 'PRESTATAIRE_EXPERIENCE',
    organization: 'Express Logistique Douala',
    activity: 'Transport et livraison',
    contact: {
      fullName: 'Serge Nkoulou',
      email: 'serge@example.com',
      phone: '+237655000000',
      country: 'CM',
      city: 'Bonabéri, Douala',
    },
    presentation: 'Flotte de six véhicules, intervention à Douala et Yaoundé.',
    consent: true,
    antiSpam: antiSpam(),
    ...overrides,
  };
}

function eventBody(overrides: Body = {}): Body {
  return {
    eventSlug: 'nuit-des-saveurs-camerounaises',
    seats: 2,
    contact: { fullName: 'Nadia Fotso', email: 'nadia.fotso@example.com', phone: '+237699000000' },
    consent: true,
    antiSpam: antiSpam(),
    ...overrides,
  };
}

function event(fields: Row): Row {
  return {
    endsAt: null,
    city: 'Douala',
    place: 'Akwa',
    tag: 'Gastronomie',
    illustration: 'chef',
    imageId: null,
    image: null,
    description: null,
    capacity: null,
    limited: false,
    status: 'PUBLISHED',
    publishedAt: FIXTURE_DATE,
    translations: null,
    isDemo: true,
    createdAt: FIXTURE_DATE,
    updatedAt: FIXTURE_DATE,
    ...fields,
  };
}

/** Tables du catalogue public complétées des données propres aux formulaires. */
function formTables(): PrismaTables {
  const tables = publicContentTables();
  tables.setting.push({
    key: 'emails',
    value: { teamRecipients: TEAM_RECIPIENTS, senderName: 'MAMBO Proxi', replyTo: 'contact@mamboproxi.com' },
    translations: null,
    updatedAt: FIXTURE_DATE,
  });
  return {
    ...tables,
    user: [
      { id: 'usr_admin', email: 'admin@mamboproxi.com', name: 'Admin', role: 'ADMIN', isActive: true },
      { id: 'usr_editor', email: 'editor@mamboproxi.com', name: 'Éditrice', role: 'EDITOR', isActive: true },
      { id: 'usr_agent', email: 'agent@mamboproxi.com', name: 'Agent', role: 'AGENT', isActive: true },
      { id: 'usr_former', email: 'former@mamboproxi.com', name: 'Ancien', role: 'MANAGER', isActive: false },
    ],
    training: [
      {
        id: 'trn_accueil',
        slug: 'accueil-relation-client',
        title: 'Accueil et relation client',
        status: 'PUBLISHED',
        translations: { en: { title: 'Customer reception and relations' } },
      },
      { id: 'trn_archive', slug: 'formation-archivee', title: 'Formation archivée', status: 'ARCHIVED' },
    ],
    event: [
      event({
        id: 'evt_saveurs',
        slug: 'nuit-des-saveurs-camerounaises',
        title: 'Nuit des saveurs camerounaises',
        startsAt: FUTURE,
        capacity: 3,
        limited: true,
      }),
      event({
        id: 'evt_passe',
        slug: 'evenement-passe',
        title: 'Événement passé',
        startsAt: new Date('2026-01-10T18:00:00.000Z'),
      }),
    ],
    referenceCounter: [{ year: referenceYear(new Date()), lastValue: 142 }],
  };
}

function rows(tables: PrismaTables, name: keyof PrismaTables): Row[] {
  return tables[name] ?? [];
}

describe('formulaires publics (avec des doubles)', () => {
  const mail = new MailQueueDouble();
  const throttler = new ResettableThrottlerStorage();
  const fetchMock = vi.fn((_url: string, init: RequestInit): Promise<Response> => {
    const success = (init.body as URLSearchParams).get('response') !== REFUSED_TOKEN;
    const body = { success, 'error-codes': success ? [] : ['invalid-input-response'] };
    return Promise.resolve(
      new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
  });
  let app: NestExpressApplication;
  let tables: PrismaTables;
  let previousSecret: string | undefined;
  const year = referenceYear(new Date());

  beforeAll(async () => {
    prepareContract('SubmissionAccepted', 'Problem');
    previousSecret = process.env['TURNSTILE_SECRET_KEY'];
    process.env['TURNSTILE_SECRET_KEY'] = E2E_TURNSTILE_SECRET;
    vi.stubGlobal('fetch', fetchMock);
    tables = formTables();
    app = await createApp({ mail, throttler, tables });
  }, CONTRACT_WARM_UP_TIMEOUT);

  afterAll(async () => {
    await app.close();
    vi.unstubAllGlobals();
    if (previousSecret === undefined) delete process.env['TURNSTILE_SECRET_KEY'];
    else process.env['TURNSTILE_SECRET_KEY'] = previousSecret;
  });

  beforeEach(() => {
    mail.reset();
    throttler.reset();
    fetchMock.mockClear();
  });

  afterEach(() => {
    mail.enqueueMany.mockReset();
    mail.enqueueMany.mockImplementation((jobs: MailJob[]) => {
      mail.jobs.push(...jobs);
      return Promise.resolve();
    });
  });

  describe('POST /v1/quote-requests', () => {
    it('enregistre la demande, attribue la référence suivante et met les e-mails en file', async () => {
      const before = Date.now();
      const response = await post(app, '/v1/quote-requests', quoteBody(), 201);

      expect(response.body).toEqual({ reference: formatReference(year, 143), message: ACCEPTED_MESSAGE });

      // Jeton vérifié auprès de Cloudflare (fetch simulé), avec la clé secrète et l'adresse IP.
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] ?? [];
      expect(url).toBe(TURNSTILE_VERIFY_URL);
      expect((init?.body as URLSearchParams).get('secret')).toBe(E2E_TURNSTILE_SECRET);
      expect((init?.body as URLSearchParams).get('response')).toBe('XXXX.DUMMY.TOKEN.XXXX');

      const contact = rows(tables, 'contact').find((row) => row['email'] === 'aurelie.k@example.com');
      expect(contact).toMatchObject({
        fullName: 'Aurélie Kamga',
        firstName: 'Aurélie',
        lastName: 'Kamga',
        phone: '+237612345678',
        country: 'CM',
        city: 'Bonapriso, Douala',
        district: 'Bonapriso',
        profile: 'PARTICULIER',
        preferredChannel: 'WHATSAPP',
        source: 'devis',
        language: 'FR',
      });

      const created = rows(tables, 'request').find((row) => row['reference'] === formatReference(year, 143));
      expect(created).toMatchObject({
        type: 'DEVIS',
        status: 'NOUVELLE',
        contactId: contact?.['id'],
        categoryId: 'cat_experience',
        serviceId: 'svc_chef_prive',
        contactPreference: 'WHATSAPP',
        subject: 'Chef privé',
        message: quoteBody()['description'],
        language: 'FR',
      });
      const createdAt = (created?.['createdAt'] as Date).getTime();
      expect(createdAt).toBeGreaterThanOrEqual(before);
      expect((created?.['dueAt'] as Date).getTime() - createdAt).toBe(REQUEST_DUE_DELAY_MS);
      expect((created?.['consentAt'] as Date).getTime()).toBe(createdAt);
      expect(created?.['ip']).toEqual(expect.any(String));
      expect((created?.['payload'] as { fields: unknown[] }).fields).toEqual([
        { key: 'rubrique', label: 'Rubrique', value: 'Expérience' },
        { key: 'service', label: 'Service', value: 'Chef privé' },
        { key: 'eventDate', label: 'Date souhaitée', value: '14 novembre 2026' },
        { key: 'guests', label: 'Nombre de personnes', value: '12' },
        { key: 'preference.contact', label: 'Préférence de contact', value: 'WhatsApp' },
      ]);

      expect(rows(tables, 'requestEvent').filter((row) => row['requestId'] === created?.['id'])).toEqual([
        expect.objectContaining({ kind: 'RECEIVED' }),
      ]);
      const notifications = rows(tables, 'notification').filter((row) => row['entityId'] === created?.['id']);
      expect(notifications.map((row) => row['userId']).sort()).toEqual(['usr_admin', 'usr_editor']);
      expect(notifications[0]).toMatchObject({
        kind: 'REQUEST',
        title: `Nouvelle demande de devis — Chef privé (${formatReference(year, 143)})`,
        link: `/admin/demandes?id=${String(created?.['id'])}`,
        entityType: 'Request',
      });

      expect(mail.jobs.map((job) => [job.template, job.to, job.lang, job.reference])).toEqual([
        ['quote-ack', 'aurelie.k@example.com', 'fr', formatReference(year, 143)],
        ['team-new-request', TEAM_RECIPIENTS[0], 'fr', formatReference(year, 143)],
        ['team-new-request', TEAM_RECIPIENTS[1], 'fr', formatReference(year, 143)],
      ]);
      expect(mail.jobs[0]?.data).toMatchObject({
        firstName: 'Aurélie',
        reference: formatReference(year, 143),
        categoryName: 'Expérience',
        serviceName: 'Chef privé',
        desiredDate: '2026-11-14',
        city: 'Bonapriso, Douala',
        contactPreference: 'WHATSAPP',
      });
      expect(mail.jobs[1]?.data).toMatchObject({
        requestType: 'DEVIS',
        requestTypeLabel: 'Demande de devis',
        subject: 'Chef privé',
        serviceName: 'Chef privé',
        email: 'aurelie.k@example.com',
        quarterName: 'Bonapriso',
        requestId: created?.['id'],
        adminUrl: `http://localhost:3000/admin/demandes?id=${String(created?.['id'])}`,
      });
    });

    it('incrémente la référence et met à jour la fiche contact existante (même e-mail)', async () => {
      const response = await post(
        app,
        '/v1/quote-requests',
        quoteBody({
          contact: {
            fullName: 'Aurélie Kamga',
            email: 'aurelie.k@example.com',
            phone: '+237600000001',
            country: 'CM',
          },
          contactPreference: 'EMAIL',
          lang: 'en',
        }),
        201,
      );

      expect(response.body).toEqual({
        reference: formatReference(year, 144),
        message:
          'Thank you, your request has been sent! You will receive a confirmation email in a few moments.',
      });
      const contacts = rows(tables, 'contact').filter((row) => row['email'] === 'aurelie.k@example.com');
      expect(contacts).toHaveLength(1);
      expect(contacts[0]).toMatchObject({
        phone: '+237600000001',
        city: 'Bonapriso, Douala',
        preferredChannel: 'EMAIL',
        language: 'EN',
      });
      expect(mail.jobs[0]).toMatchObject({ template: 'quote-ack', lang: 'en' });
      expect(mail.jobs[0]?.data).toMatchObject({ categoryName: 'Experience' });
    });

    it('répond 422 avec les chemins et les messages en français', async () => {
      const count = rows(tables, 'request').length;
      const response = await post(
        app,
        '/v1/quote-requests',
        quoteBody({
          contact: { fullName: 'A', email: 'pas-un-email', phone: '0600000000', country: 'CM' },
          description: 'Trop court',
          consent: false,
        }),
        422,
      );

      expect(response.headers['content-type']).toMatch(/^application\/problem\+json/);
      expect(response.body).toMatchObject({
        type: `${PROBLEMS}validation-error`,
        title: 'Certaines informations sont à corriger',
        status: 422,
        detail: 'Vérifiez les champs signalés puis renvoyez le formulaire.',
      });
      expect((response.body as { errors: Body[] }).errors).toEqual([
        { path: 'description', code: 'too_short', message: 'Saisissez au moins 20 caractères.' },
        { path: 'contact.fullName', code: 'too_short', message: 'Saisissez au moins 2 caractères.' },
        { path: 'contact.email', code: 'invalid_email', message: 'Saisissez une adresse e-mail valide.' },
        {
          path: 'contact.phone',
          code: 'invalid_format',
          message: 'Saisissez un numéro au format international (ex. +237 6 00 00 00 00).',
        },
        {
          path: 'consent',
          code: 'required',
          message: "Merci d'accepter le traitement de vos données pour envoyer votre demande.",
        },
      ]);
      expect(rows(tables, 'request')).toHaveLength(count);
      expect(mail.jobs).toEqual([]);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('répond 422 pour une rubrique inconnue ou un service non publié', async () => {
      const category = await post(
        app,
        '/v1/quote-requests',
        quoteBody({ categorySlug: 'ancienne-rubrique' }),
        422,
      );
      expect((category.body as { errors: Body[] }).errors).toEqual([
        {
          path: 'categorySlug',
          code: 'not_found',
          message: "Cette rubrique n'existe pas ou n'est plus disponible.",
        },
      ]);

      const service = await post(
        app,
        '/v1/quote-requests',
        quoteBody({ serviceSlug: 'service-brouillon' }),
        422,
      );
      expect((service.body as { errors: Body[] }).errors).toEqual([
        {
          path: 'serviceSlug',
          code: 'not_found',
          message: "Ce service n'existe pas ou n'est plus disponible.",
        },
      ]);
    });

    it('champ piège rempli : succès factice, rien n’est enregistré ni envoyé', async () => {
      const requests = rows(tables, 'request').length;
      const counter = rows(tables, 'referenceCounter')[0]?.['lastValue'];

      const response = await post(
        app,
        '/v1/quote-requests',
        quoteBody({ antiSpam: antiSpam({ honeypot: 'https://spam.example' }) }),
        201,
      );

      expect(response.body).toEqual({
        reference: expect.stringMatching(REFERENCE_PATTERN) as string,
        message: ACCEPTED_MESSAGE,
      });
      expect(rows(tables, 'request')).toHaveLength(requests);
      expect(rows(tables, 'referenceCounter')[0]?.['lastValue']).toBe(counter);
      expect(mail.jobs).toEqual([]);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('envoi moins de 3 s après l’ouverture du formulaire : 400 spam-check-failed', async () => {
      const response = await post(
        app,
        '/v1/quote-requests',
        quoteBody({ antiSpam: antiSpam({ startedAt: new Date().toISOString() }) }),
        400,
      );

      expect(response.body).toEqual({
        type: `${PROBLEMS}spam-check-failed`,
        title: 'Vérification de sécurité échouée',
        status: 400,
        detail: "La vérification anti-robot n'a pas abouti. Rechargez la page puis réessayez.",
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('jeton Turnstile refusé par Cloudflare : 400 spam-check-failed, rien n’est enregistré', async () => {
      const requests = rows(tables, 'request').length;
      const response = await post(
        app,
        '/v1/quote-requests',
        quoteBody({ antiSpam: antiSpam({ turnstileToken: REFUSED_TOKEN }) }),
        400,
      );

      expect(response.body).toMatchObject({ type: `${PROBLEMS}spam-check-failed` });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(rows(tables, 'request')).toHaveLength(requests);
    });

    it('jeton vide hors production (site sans clé Turnstile) : accepté sans appel à Cloudflare', async () => {
      await post(app, '/v1/quote-requests', quoteBody({ antiSpam: antiSpam({ turnstileToken: '' }) }), 201);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('une file d’e-mails indisponible ne fait pas échouer l’envoi', async () => {
      mail.enqueueMany.mockRejectedValueOnce(new Error('Connexion Redis refusée'));
      const response = await post(app, '/v1/quote-requests', quoteBody(), 201);
      expect(response.body).toMatchObject({ reference: expect.stringMatching(REFERENCE_PATTERN) as string });
    });

    it('limite les envois à 5 par minute (429 rate-limited)', async () => {
      for (let attempt = 0; attempt < PUBLIC_FORM_THROTTLE.limit; attempt += 1) {
        await post(app, '/v1/quote-requests', { consent: true }, 422);
      }
      const response = await post(app, '/v1/quote-requests', quoteBody(), 429);

      expect(response.headers['retry-after']).toEqual(expect.any(String));
      expect(response.body).toMatchObject({ type: `${PROBLEMS}rate-limited`, title: 'Trop de tentatives' });
    });
  });

  describe('POST /v1/contact-messages', () => {
    it('enregistre une demande d’information sur un service', async () => {
      const response = await post(app, '/v1/contact-messages', contactMessageBody(), 201);
      const reference = (response.body as Body)['reference'];

      expect(response.body).toEqual({
        reference: expect.stringMatching(REFERENCE_PATTERN) as string,
        message:
          'Merci, votre message est bien envoyé ! Vous recevrez un e-mail de confirmation dans quelques instants.',
      });
      expect(rows(tables, 'request').find((row) => row['reference'] === reference)).toMatchObject({
        type: 'INFORMATION',
        status: 'NOUVELLE',
        serviceId: 'svc_chef_prive',
        categoryId: 'cat_experience',
        subject: 'Information sur un service',
      });
      expect(mail.jobs.map((job) => job.template)).toEqual([
        'contact-ack',
        'team-new-request',
        'team-new-request',
      ]);
      expect(mail.jobs[0]?.data).toMatchObject({
        firstName: 'Paul',
        messageType: 'INFORMATION',
        subjectLabel: 'Information sur un service',
        serviceName: 'Chef privé',
      });
    });

    it('accepte un simple message sans téléphone ni pays', async () => {
      await post(
        app,
        '/v1/contact-messages',
        contactMessageBody({
          type: 'CONTACT',
          contact: { fullName: 'Léa Moukoko', email: 'lea@example.com', phone: null, country: null },
          subject: null,
          serviceSlug: null,
        }),
        201,
      );
      expect(mail.jobs[0]).toMatchObject({ template: 'contact-ack', to: 'lea@example.com' });
    });

    it('répond 422 pour un message trop court', async () => {
      const response = await post(
        app,
        '/v1/contact-messages',
        contactMessageBody({ message: 'Bonjour' }),
        422,
      );
      expect((response.body as { errors: Body[] }).errors).toEqual([
        { path: 'message', code: 'too_short', message: 'Saisissez au moins 10 caractères.' },
      ]);
    });
  });

  describe('POST /v1/registrations', () => {
    it('inscrit un professionnel, enregistre ses rubriques et prépare l’abonnement newsletter', async () => {
      const response = await post(app, '/v1/registrations', registrationBody(), 201);
      const reference = (response.body as Body)['reference'];

      expect(response.body).toMatchObject({
        message:
          'Merci, votre inscription est bien enregistrée ! Vous recevrez un e-mail de confirmation dans quelques instants.',
      });
      const contact = rows(tables, 'contact').find((row) => row['email'] === 'marie.ndongo@example.com');
      expect(contact).toMatchObject({
        fullName: 'Marie Claire Ndongo',
        firstName: 'Marie Claire',
        lastName: 'Ndongo',
        profile: 'PROFESSIONNEL',
        organization: 'Saveurs du Wouri',
        activity: 'Traiteur',
        district: 'Akwa',
        source: 'inscription',
      });
      expect(rows(tables, 'contactInterest').filter((row) => row['contactId'] === contact?.['id'])).toEqual([
        expect.objectContaining({ categoryId: 'cat_experience' }),
      ]);
      expect(
        rows(tables, 'subscriber').find((row) => row['email'] === 'marie.ndongo@example.com'),
      ).toMatchObject({
        contactId: contact?.['id'],
        status: 'EN_ATTENTE',
        source: 'INSCRIPTION',
        consentAt: expect.any(Date) as Date,
      });
      const created = rows(tables, 'request').find((row) => row['reference'] === reference);
      expect(created).toMatchObject({
        type: 'INSCRIPTION',
        subject: 'Inscription professionnel — Saveurs du Wouri',
      });
      expect(rows(tables, 'notification').find((row) => row['entityId'] === created?.['id'])).toMatchObject({
        kind: 'REGISTRATION',
        title: `Nouvelle inscription professionnel — Marie Claire N. (${String(reference)})`,
      });
      expect(mail.jobs[0]).toMatchObject({
        template: 'registration-confirmed',
        to: 'marie.ndongo@example.com',
      });
      expect(mail.jobs[0]?.data).toMatchObject({
        firstName: 'Marie Claire',
        profile: 'PROFESSIONNEL',
        interestNames: ['Expérience'],
        newsletterPending: true,
      });
    });

    it('exige structure et activité d’un professionnel, et des rubriques publiées', async () => {
      const missing = await post(
        app,
        '/v1/registrations',
        registrationBody({ organization: null, activity: '' }),
        422,
      );
      expect((missing.body as { errors: Body[] }).errors).toEqual([
        { path: 'organization', code: 'required', message: 'Ce champ est obligatoire.' },
        { path: 'activity', code: 'required', message: 'Ce champ est obligatoire.' },
      ]);

      const archived = await post(
        app,
        '/v1/registrations',
        registrationBody({ interests: ['experience', 'ancienne-rubrique'] }),
        422,
      );
      expect((archived.body as { errors: Body[] }).errors).toEqual([
        {
          path: 'interests.1',
          code: 'not_found',
          message: "Cette rubrique n'existe pas ou n'est plus disponible.",
        },
      ]);
    });

    it('n’abonne pas à la newsletter sans case cochée', async () => {
      await post(
        app,
        '/v1/registrations',
        registrationBody({
          profile: 'PARTICULIER',
          email: 'particulier@example.com',
          organization: null,
          activity: null,
          newsletter: false,
        }),
        201,
      );
      expect(rows(tables, 'subscriber').some((row) => row['email'] === 'particulier@example.com')).toBe(
        false,
      );
      expect(mail.jobs[0]?.data).toMatchObject({ newsletterPending: false });
    });
  });

  describe('POST /v1/training-requests', () => {
    it('enregistre une demande pour une formation du catalogue', async () => {
      const response = await post(app, '/v1/training-requests', trainingBody({ lang: 'en' }), 201);
      const reference = (response.body as Body)['reference'];

      expect(rows(tables, 'request').find((row) => row['reference'] === reference)).toMatchObject({
        type: 'FORMATION',
        trainingId: 'trn_accueil',
        participants: 12,
        period: 'Janvier 2027',
        organization: 'Hôtel La Falaise',
        subject: 'Accueil et relation client',
        language: 'EN',
      });
      expect(mail.jobs[0]).toMatchObject({ template: 'training-request-received', lang: 'en' });
      expect(mail.jobs[0]?.data).toMatchObject({
        trainingName: 'Customer reception and relations',
        participants: 12,
        organization: 'Hôtel La Falaise',
      });
    });

    it('accepte une formation « autre » précisée', async () => {
      const response = await post(
        app,
        '/v1/training-requests',
        trainingBody({ trainingSlug: 'autre', otherTraining: 'Gestion des réservations' }),
        201,
      );
      const reference = (response.body as Body)['reference'];
      expect(rows(tables, 'request').find((row) => row['reference'] === reference)).toMatchObject({
        trainingId: null,
        otherTraining: 'Gestion des réservations',
        subject: 'Gestion des réservations',
      });
    });

    it('répond 422 pour une formation inconnue ou « autre » non précisée', async () => {
      const unknown = await post(
        app,
        '/v1/training-requests',
        trainingBody({ trainingSlug: 'formation-archivee' }),
        422,
      );
      expect((unknown.body as { errors: Body[] }).errors).toEqual([
        {
          path: 'trainingSlug',
          code: 'not_found',
          message: "Cette formation n'existe pas ou n'est plus proposée.",
        },
      ]);

      const other = await post(app, '/v1/training-requests', trainingBody({ trainingSlug: 'autre' }), 422);
      expect((other.body as { errors: Body[] }).errors).toEqual([
        { path: 'otherTraining', code: 'required', message: 'Précisez la formation souhaitée.' },
      ]);
    });
  });

  describe('POST /v1/partner-requests', () => {
    it('enregistre la demande et classe le contact en professionnel', async () => {
      const response = await post(app, '/v1/partner-requests', partnerBody(), 201);
      const reference = (response.body as Body)['reference'];
      const created = rows(tables, 'request').find((row) => row['reference'] === reference);

      expect(created).toMatchObject({
        type: 'PARTENARIAT',
        partnershipType: 'PRESTATAIRE_EXPERIENCE',
        organization: 'Express Logistique Douala',
        subject: 'Express Logistique Douala',
        message: 'Flotte de six véhicules, intervention à Douala et Yaoundé.',
      });
      expect(rows(tables, 'contact').find((row) => row['email'] === 'serge@example.com')).toMatchObject({
        profile: 'PROFESSIONNEL',
        organization: 'Express Logistique Douala',
        activity: 'Transport et livraison',
      });
      expect(rows(tables, 'notification').find((row) => row['entityId'] === created?.['id'])).toMatchObject({
        kind: 'PARTNERSHIP',
      });
      expect(mail.jobs[0]).toMatchObject({ template: 'partner-request-received', to: 'serge@example.com' });
      expect(mail.jobs[0]?.data).toMatchObject({
        partnershipType: 'PRESTATAIRE_EXPERIENCE',
        partnershipLabel: 'Prestataire Expérience',
        organization: 'Express Logistique Douala',
      });
    });

    it('exige la ville du contact', async () => {
      const response = await post(
        app,
        '/v1/partner-requests',
        partnerBody({
          contact: {
            fullName: 'Serge Nkoulou',
            email: 'serge@example.com',
            phone: '+237655000000',
            country: 'CM',
          },
        }),
        422,
      );
      expect((response.body as { errors: Body[] }).errors).toEqual([
        { path: 'contact.city', code: 'required', message: 'Ce champ est obligatoire.' },
      ]);
    });
  });

  describe('POST /v1/event-registrations', () => {
    it('inscrit dans la limite des places, puis répond 409 event-full', async () => {
      const response = await post(app, '/v1/event-registrations', eventBody(), 201);
      const reference = (response.body as Body)['reference'];

      expect(rows(tables, 'request').find((row) => row['reference'] === reference)).toMatchObject({
        type: 'EVENEMENT',
        eventId: 'evt_saveurs',
        seats: 2,
        subject: 'Nuit des saveurs camerounaises',
        message: 'Inscription pour 2 personnes.',
      });
      expect(mail.jobs[0]).toMatchObject({ template: 'event-registration', to: 'nadia.fotso@example.com' });
      expect(mail.jobs[0]?.data).toMatchObject({
        eventName: 'Nuit des saveurs camerounaises',
        startsAt: FUTURE.toISOString(),
        place: 'Douala, Akwa',
        city: 'Douala',
        seats: 2,
      });

      // Jauge de 3 : 2 places prises, il en reste 1.
      const full = await post(app, '/v1/event-registrations', eventBody({ seats: 2 }), 409);
      expect(full.body).toEqual({
        type: `${PROBLEMS}event-full`,
        title: 'Complet',
        status: 409,
        detail: 'Il ne reste plus assez de places pour cet événement.',
      });
      await post(app, '/v1/event-registrations', eventBody({ seats: 1 }), 201);
    });

    it('répond 422 pour un événement inconnu ou passé', async () => {
      const unknown = await post(app, '/v1/event-registrations', eventBody({ eventSlug: 'inconnu' }), 422);
      expect((unknown.body as { errors: Body[] }).errors).toEqual([
        {
          path: 'eventSlug',
          code: 'not_found',
          message: "Cet événement n'existe pas ou n'est plus disponible.",
        },
      ]);

      const past = await post(
        app,
        '/v1/event-registrations',
        eventBody({ eventSlug: 'evenement-passe' }),
        422,
      );
      expect((past.body as { errors: Body[] }).errors).toEqual([
        { path: 'eventSlug', code: 'closed', message: 'Les inscriptions à cet événement sont closes.' },
      ]);
    });
  });
});

describe.runIf(process.env['E2E_REAL_SERVICES'] === 'true')(
  'formulaires publics (avec la base réelle, remplie par le seed)',
  () => {
    const mail = new MailQueueDouble();
    const throttler = new ResettableThrottlerStorage();
    const runId = String(Date.now());
    let app: NestExpressApplication;
    let prisma: PrismaService;
    const references: string[] = [];

    beforeAll(async () => {
      prepareContract('SubmissionAccepted', 'Problem');
      app = await createApp({ mail, throttler });
      prisma = app.get(PrismaService);
    }, CONTRACT_WARM_UP_TIMEOUT);

    afterAll(async () => {
      // Données de test retirées (le compteur des références garde ses numéros consommés).
      const created = await prisma.request.findMany({
        where: { reference: { in: references } },
        select: { id: true, contactId: true },
      });
      const requestIds = created.map((row) => row.id);
      const contactIds = [...new Set(created.map((row) => row.contactId))];
      await prisma.notification.deleteMany({ where: { entityId: { in: requestIds } } });
      await prisma.request.deleteMany({ where: { id: { in: requestIds } } });
      await prisma.subscriber.deleteMany({ where: { contactId: { in: contactIds } } });
      await prisma.contact.deleteMany({ where: { id: { in: contactIds } } });
      await app.close();
    });

    beforeEach(() => {
      mail.reset();
    });

    /** Envoi, puis vérification de la référence (numéro suivant du compteur) et de l'historique. */
    async function submit(path: string, body: Body, type: string): Promise<void> {
      const year = referenceYear(new Date());
      const counter = await prisma.referenceCounter.findUnique({ where: { year } });
      const response = await post(app, path, { ...body, antiSpam: antiSpam({ turnstileToken: '' }) }, 201);
      const reference = String((response.body as Body)['reference']);
      references.push(reference);

      expect(reference).toBe(formatReference(year, (counter?.lastValue ?? 0) + 1));
      const created = await prisma.request.findUnique({
        where: { reference },
        include: { history: true, contact: { select: { email: true } } },
      });
      expect(created).toMatchObject({ type, status: 'NOUVELLE' });
      expect(created?.history.map((event) => event.kind)).toEqual(['RECEIVED']);
      expect(created?.dueAt?.getTime()).toBe((created?.createdAt.getTime() ?? 0) + REQUEST_DUE_DELAY_MS);
      expect(mail.jobs[0]).toMatchObject({ to: created?.contact.email, reference });
      expect(mail.jobs.filter((job) => job.template === 'team-new-request').length).toBeGreaterThan(0);
    }

    const email = (name: string): string => `e2e.${name}.${runId}@example.com`;

    it('devis', async () => {
      await submit(
        '/v1/quote-requests',
        quoteBody({ contact: { ...(quoteBody()['contact'] as Body), email: email('devis') } }),
        'DEVIS',
      );
    });

    it('message de contact', async () => {
      await submit(
        '/v1/contact-messages',
        contactMessageBody({
          contact: { ...(contactMessageBody()['contact'] as Body), email: email('contact') },
        }),
        'INFORMATION',
      );
    });

    it('inscription', async () => {
      await submit('/v1/registrations', registrationBody({ email: email('inscription') }), 'INSCRIPTION');
    });

    it('demande de formation', async () => {
      const training = await prisma.training.findFirst({
        where: { status: 'PUBLISHED' },
        select: { slug: true },
      });
      await submit(
        '/v1/training-requests',
        trainingBody({
          trainingSlug: training?.slug ?? 'autre',
          otherTraining: training ? null : 'Formation sur mesure',
          contact: { ...(trainingBody()['contact'] as Body), email: email('formation') },
        }),
        'FORMATION',
      );
    });

    it('demande de partenariat', async () => {
      await submit(
        '/v1/partner-requests',
        partnerBody({ contact: { ...(partnerBody()['contact'] as Body), email: email('partenariat') } }),
        'PARTENARIAT',
      );
    });

    it('inscription à un événement', async () => {
      const now = new Date();
      const events = await prisma.event.findMany({
        where: { status: 'PUBLISHED', startsAt: { gt: now } },
        select: { slug: true, capacity: true, registrations: { select: { seats: true } } },
        orderBy: { startsAt: 'asc' },
      });
      const open = events.find(
        (item) =>
          item.capacity === null ||
          item.capacity - item.registrations.reduce((total, row) => total + (row.seats ?? 0), 0) >= 1,
      );
      // Événements du seed à dates fixes : aucun à venir une fois passés (cas vérifié par les tests avec doubles).
      if (!open) return;
      await submit(
        '/v1/event-registrations',
        eventBody({
          eventSlug: open.slug,
          seats: 1,
          contact: { ...(eventBody()['contact'] as Body), email: email('evenement') },
        }),
        'EVENEMENT',
      );
    });
  },
);
