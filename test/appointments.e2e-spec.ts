/**
 * Tests e2e des rendez-vous et disponibilités :
 * - côté site : `GET /v1/appointments/availability`, `POST /v1/appointments` (anti-spam, créneau proposé, double
 *   réservation, index unique), `POST /v1/appointments/{reference}/accept-proposal` ;
 * - back-office : `/v1/admin/appointments*` (agenda, détail, saisie, confirmation, report, annulation, fin, notes,
 *   assignation) et `/v1/admin/availability`, permissions par rôle et CSRF ;
 * - rappel de la veille : tâche différée programmée, retirée au report et à l'annulation, envoi idempotent.
 * « Avec des doubles » : double de Prisma (`test/fixtures/appointments.ts`), files des e-mails et des rappels
 * simulées. « Avec la base réelle » (`E2E_REAL_SERVICES=true`, base remplie par le seed) : créneaux et agenda du
 * seed conformes au contrat, réservations simultanées du même créneau (verrou et index unique réels).
 * Chaque réponse est validée contre le contrat.
 */
import type { Server } from 'node:http';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { addDays, doualaDate } from '../src/common/time/agency-day.js';
import { AppConfigService } from '../src/config/app-config.service.js';
import {
  AppointmentRemindersService,
  reminderJobId,
  reminderTime,
} from '../src/modules/appointments/appointment-reminders.service.js';
import { isSlotTakenError } from '../src/modules/appointments/appointment-slots.js';
import { PasswordService } from '../src/modules/auth/password.service.js';
import { TOKEN_PURPOSES, hmacDigest } from '../src/modules/auth/tokens.js';
import { referenceYear } from '../src/modules/requests/reference.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { CONTRACT_WARM_UP_TIMEOUT, prepareContract } from './contract.js';
import {
  PROPOSAL_TOKEN,
  appointmentClock,
  appointmentTables,
  resetAppointments,
  type AppointmentClock,
} from './fixtures/appointments.js';
import {
  ACCOUNTS,
  MailQueueDouble,
  PASSWORD,
  PROBLEMS,
  ReminderQueueDouble,
  ResettableThrottlerStorage,
  createApp,
  expectContract,
  signIn,
  type TestSession,
} from './support/auth.js';
import type { PrismaTables } from './support/prisma-double.js';

type Row = Record<string, unknown>;
type Agenda = { data: Row[]; pending: Row[] };
type AvailabilityBody = {
  timezone: string;
  days: { date: string; available: boolean; closedReason: string | null; slots: Row[] }[];
};

const REFERENCE_PATTERN = /^MP-\d{4}-\d{4,}$/;
const DAY = 86_400_000;

function antiSpam(overrides: Row = {}): Row {
  return {
    turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX',
    honeypot: '',
    startedAt: new Date(Date.now() - 60_000).toISOString(),
    ...overrides,
  };
}

const ids = (items: Row[]): unknown[] => items.map((item) => item['id']);
const starts = (slots: Row[]): unknown[] => slots.map((slot) => slot['startsAt']);

describe('rendez-vous et disponibilités (avec des doubles)', () => {
  const mail = new MailQueueDouble();
  const reminders = new ReminderQueueDouble();
  const throttler = new ResettableThrottlerStorage();
  let app: NestExpressApplication;
  let server: Server;
  let tables: PrismaTables;
  let fresh: PrismaTables;
  let clock: AppointmentClock;
  let proposalHash: string;
  const sessions = {} as Record<'admin' | 'manager' | 'agent' | 'editor' | 'writer', TestSession>;

  const rows = (name: keyof PrismaTables): Row[] => tables[name] ?? [];
  const find = (name: keyof PrismaTables, id: string): Row | undefined =>
    rows(name).find((row) => row['id'] === id);
  const iso = (day: string, hour: number, minute = 0): string => clock.at(day, hour, minute).toISOString();

  function bookingBody(overrides: Row = {}): Row {
    return {
      reason: 'DEVIS',
      format: 'VISIO',
      startsAt: iso(clock.D, 10),
      contact: {
        fullName: 'Christelle Ngo Mbe',
        email: 'Christelle.Ngo@example.com',
        phone: '+237677112233',
      },
      message: 'Je voudrais un devis pour le ménage hebdomadaire.',
      consent: true,
      antiSpam: antiSpam(),
      ...overrides,
    };
  }

  const book = (body: Row) => request(server).post('/v1/appointments').send(body);
  const availability = (query: string) => request(server).get(`/v1/appointments/availability?${query}`);
  const patch = (session: TestSession, id: string, body: Row) =>
    session.agent.patch(`/v1/admin/appointments/${id}`).set('X-CSRF-Token', session.csrf).send(body);
  const agendaQuery = (): string =>
    `from=${encodeURIComponent(iso(clock.D, 0))}&to=${encodeURIComponent(iso(addDays(clock.F, 1), 0))}`;

  beforeAll(async () => {
    prepareContract(
      'AdminAppointment',
      'Availability',
      'AvailabilityConfig',
      'SubmissionAccepted',
      'Problem',
    );
    const passwordHash = await new PasswordService().hash(PASSWORD);
    clock = appointmentClock();
    fresh = appointmentTables(passwordHash, clock);
    tables = appointmentTables(passwordHash, clock);
    app = await createApp({ mail, throttler, tables, reminders });
    server = app.getHttpServer();
    proposalHash = hmacDigest(
      app.get(AppConfigService).get('TOKEN_SIGNING_SECRET'),
      TOKEN_PURPOSES.appointmentProposal,
      PROPOSAL_TOKEN,
    );
    for (const role of ['admin', 'manager', 'agent', 'editor', 'writer'] as const)
      sessions[role] = await signIn(server, mail, ACCOUNTS[role].email);
  }, CONTRACT_WARM_UP_TIMEOUT);

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    resetAppointments(tables, fresh);
    const proposed = find('appointment', 'apt_proposed');
    if (proposed) proposed['proposalTokenHash'] = proposalHash;
    mail.reset();
    reminders.reset();
    throttler.reset();
  });

  describe('GET /v1/appointments/availability', () => {
    it('renvoie les créneaux libres en heure de Douala, sans les rendez-vous qui les occupent (200)', async () => {
      const response = await availability(`from=${clock.D}&to=${clock.F}`);

      expectContract('get', '/v1/appointments/availability', 200, response);
      expect(response.headers['cache-control']).toBe('no-store');
      const body = response.body as AvailabilityBody;
      expect(body.timezone).toBe('Africa/Douala');
      const days = new Map(body.days.map((day) => [day.date, day]));
      // Jour D : 09:00 confirmé et 11:00 proposé sont occupés ; 10:00 (rendez-vous annulé) est libre.
      expect(starts(days.get(clock.D)?.slots ?? [])).toEqual([iso(clock.D, 10), iso(clock.D, 14)]);
      // 10:00 à Douala = 09:00 UTC toute l'année (pas d'heure d'été).
      expect(iso(clock.D, 10).slice(11)).toBe('09:00:00.000Z');
      expect(days.get(clock.D)?.slots[0]).toEqual({
        startsAt: iso(clock.D, 10),
        endsAt: iso(clock.D, 11),
        formats: ['AGENCE', 'TELEPHONE', 'VISIO'],
      });
      // Jour E : le créneau d'origine de la proposition (09:00) est libéré, 10:00 est à confirmer.
      expect(starts(days.get(clock.E)?.slots ?? [])).toEqual([
        iso(clock.E, 9),
        iso(clock.E, 11),
        iso(clock.E, 14),
      ]);
      expect(days.get(clock.F)).toEqual({
        date: clock.F,
        available: false,
        closedReason: 'Fête nationale',
        slots: [],
      });
      const sunday = body.days.find((day) => new Date(`${day.date}T12:00:00Z`).getUTCDay() === 0);
      if (sunday) expect(sunday).toMatchObject({ available: false, closedReason: 'Fermé le dimanche' });
    });

    it('filtre par format et retire les créneaux trop proches', async () => {
      const phone = await availability(`from=${clock.D}&to=${clock.D}&format=AGENCE`);
      expectContract('get', '/v1/appointments/availability', 200, phone);
      expect(starts((phone.body as AvailabilityBody).days[0]?.slots ?? [])).toEqual([iso(clock.D, 10)]);

      const today = doualaDate(new Date());
      const soon = await availability(`from=${today}&to=${today}`);
      expectContract('get', '/v1/appointments/availability', 200, soon);
      expect((soon.body as AvailabilityBody).days[0]?.slots).toEqual([]);
    });

    it('refuse une période invalide (422)', async () => {
      for (const query of [
        `from=${clock.E}&to=${clock.D}`,
        `from=${clock.D}&to=${addDays(clock.D, 63)}`,
        'from=2026-02-30&to=2026-03-01',
        `from=${clock.D}`,
        `from=${clock.D}&to=${clock.E}&format=PIGEON`,
      ]) {
        const response = await availability(query);
        expectContract('get', '/v1/appointments/availability', 422, response);
        expect((response.body as Row)['type']).toBe(`${PROBLEMS}validation-error`);
      }
    });
  });

  describe('POST /v1/appointments', () => {
    it('enregistre la demande « À confirmer », reliée à une demande de même référence (201)', async () => {
      const response = await book(bookingBody());

      expectContract('post', '/v1/appointments', 201, response);
      const { reference, message } = response.body as { reference: string; message: string };
      expect(reference).toMatch(REFERENCE_PATTERN);
      expect(message).toBe(
        'Votre demande de rendez-vous est enregistrée. Nous la confirmons par e-mail très rapidement.',
      );

      const saved = rows('appointment').find((row) => row['reference'] === reference);
      expect(saved).toMatchObject({
        status: 'A_CONFIRMER',
        reason: 'DEVIS',
        format: 'VISIO',
        startsAt: clock.at(clock.D, 10),
        endsAt: clock.at(clock.D, 11),
        assignedToId: null,
        createdById: null,
        message: 'Je voudrais un devis pour le ménage hebdomadaire.',
      });
      const linked = rows('request').find((row) => row['id'] === saved?.['requestId']);
      expect(linked).toMatchObject({ type: 'RENDEZ_VOUS', reference, status: 'NOUVELLE' });
      const contact = rows('contact').find((row) => row['id'] === saved?.['contactId']);
      expect(contact).toMatchObject({ email: 'christelle.ngo@example.com', source: 'rendez-vous' });
      // Notifications de l'équipe : vers le rendez-vous.
      const notifications = rows('notification').filter((row) => row['entityId'] === saved?.['id']);
      expect(notifications.length).toBeGreaterThan(0);
      expect(notifications[0]).toMatchObject({
        kind: 'APPOINTMENT',
        entityType: 'Appointment',
        link: `/admin/rendez-vous?id=${String(saved?.['id'])}`,
      });

      const ack = mail.last('appointment-received', 'christelle.ngo@example.com');
      expect(ack).toMatchObject({
        lang: 'fr',
        reference,
        data: {
          firstName: 'Christelle',
          reference,
          startsAt: iso(clock.D, 10),
          endsAt: iso(clock.D, 11),
          reasonLabel: 'Devis',
          formatLabel: 'Visio',
        },
      });
      const alert = mail.last('team-new-request', 'equipe.douala@mamboproxi.com');
      expect(alert?.data['adminUrl']).toMatch(/\/admin\/rendez-vous\?id=/);
      expect(alert?.data['requestType']).toBe('RENDEZ_VOUS');

      // Le créneau n'est plus proposé.
      const after = await availability(`from=${clock.D}&to=${clock.D}`);
      expect(starts((after.body as AvailabilityBody).days[0]?.slots ?? [])).toEqual([iso(clock.D, 14)]);
    });

    it('refuse un créneau déjà pris (409 `slot-taken`) et un créneau non proposé (422)', async () => {
      const taken = await book(bookingBody({ startsAt: iso(clock.D, 9) }));
      expectContract('post', '/v1/appointments', 409, taken);
      expect(taken.body).toMatchObject({ type: `${PROBLEMS}slot-taken`, title: 'Créneau indisponible' });

      for (const startsAt of [
        iso(clock.D, 10, 30),
        iso(clock.F, 10),
        new Date(Date.now() + 3_600_000).toISOString(),
      ]) {
        const invalid = await book(bookingBody({ startsAt }));
        expectContract('post', '/v1/appointments', 422, invalid);
        expect((invalid.body as { errors: Row[] }).errors).toEqual([
          expect.objectContaining({ path: 'startsAt', code: 'unavailable' }),
        ]);
      }
      // Créneau de l'après-midi : téléphone seulement.
      const format = await book(bookingBody({ startsAt: iso(clock.D, 14), format: 'VISIO' }));
      expectContract('post', '/v1/appointments', 422, format);
      expect(rows('request')).toEqual([]);
    });

    it('traduit la violation de l’index unique (réservation simultanée) en 409 et annule tout', async () => {
      const prisma = app.get<
        PrismaService,
        { appointment: { findMany: { mockImplementationOnce: (fn: () => Promise<Row[]>) => void } } }
      >(PrismaService);
      // L'autre réservation n'est pas encore visible au moment du contrôle : seule la base l'arrête.
      prisma.appointment.findMany.mockImplementationOnce(() => Promise.resolve([]));
      const contacts = rows('contact').length;

      const response = await book(bookingBody({ startsAt: iso(clock.D, 9) }));

      expectContract('post', '/v1/appointments', 409, response);
      expect((response.body as Row)['type']).toBe(`${PROBLEMS}slot-taken`);
      // Transaction annulée : ni demande, ni fiche, ni compteur consommé.
      expect(rows('request')).toEqual([]);
      expect(rows('contact')).toHaveLength(contacts);
      expect(rows('referenceCounter')).toEqual([]);
      expect(mail.jobs).toEqual([]);
    });

    it('vérifie l’anti-spam et les champs (400, 422) ; un robot reçoit un succès factice', async () => {
      const fast = await book(bookingBody({ antiSpam: antiSpam({ startedAt: new Date().toISOString() }) }));
      expectContract('post', '/v1/appointments', 400, fast);

      const trap = await book(bookingBody({ antiSpam: antiSpam({ honeypot: 'robot' }) }));
      expectContract('post', '/v1/appointments', 201, trap);
      expect(rows('appointment')).toHaveLength(5);

      const invalid = await book(
        bookingBody({
          reason: 'VISITE',
          consent: false,
          contact: { fullName: 'A', email: 'x', phone: '06' },
        }),
      );
      expectContract('post', '/v1/appointments', 422, invalid);
      expect((invalid.body as { errors: Row[] }).errors.map((error) => error['path'])).toEqual(
        expect.arrayContaining(['reason', 'consent', 'contact.fullName', 'contact.email', 'contact.phone']),
      );
    });
  });

  describe('POST /v1/appointments/{reference}/accept-proposal', () => {
    const path = (clockRef: AppointmentClock) => `/v1/appointments/${clockRef.ref(141)}/accept-proposal`;

    it('confirme le créneau proposé, envoie l’invitation et programme le rappel (200, même réponse ensuite)', async () => {
      const response = await request(server).post(path(clock)).send({ token: PROPOSAL_TOKEN });

      expectContract('post', '/v1/appointments/{reference}/accept-proposal', 200, response);
      expect(response.body).toEqual({
        message: 'Parfait ! Votre rendez-vous est confirmé. Vous allez recevoir une invitation par e-mail.',
      });
      expect(find('appointment', 'apt_proposed')).toMatchObject({
        status: 'CONFIRME',
        startsAt: clock.at(clock.D, 11),
        endsAt: clock.at(clock.D, 12),
        proposedStartsAt: null,
      });
      const confirmed = mail.last('appointment-confirmed', 'samuel.em@example.com');
      expect(confirmed?.data).toMatchObject({
        startsAt: iso(clock.D, 11),
        place: 'Agence Douala, Bonapriso',
      });
      expect(String(confirmed?.data['ics'])).toContain('BEGIN:VCALENDAR');
      const jobId = reminderJobId('apt_proposed', clock.at(clock.D, 11));
      expect(reminders.jobs.get(jobId)?.data).toEqual({
        appointmentId: 'apt_proposed',
        startsAt: iso(clock.D, 11),
      });
      const notification = rows('notification').find((row) => row['userId'] === ACCOUNTS.manager.id);
      expect(notification).toMatchObject({ kind: 'APPOINTMENT', entityId: 'apt_proposed' });

      const again = await request(server).post(path(clock)).send({ token: PROPOSAL_TOKEN });
      expectContract('post', '/v1/appointments/{reference}/accept-proposal', 200, again);
    });

    it('refuse un lien inconnu ou expiré (410), un rendez-vous clos ou un créneau pris (409)', async () => {
      const wrong = await request(server).post(path(clock)).send({ token: 'autre-jeton' });
      expectContract('post', '/v1/appointments/{reference}/accept-proposal', 410, wrong);
      const unknown = await request(server)
        .post('/v1/appointments/inconnue/accept-proposal')
        .send({ token: 'x' });
      expectContract('post', '/v1/appointments/{reference}/accept-proposal', 410, unknown);
      const empty = await request(server).post(path(clock)).send({});
      expectContract('post', '/v1/appointments/{reference}/accept-proposal', 422, empty);

      const proposed = find('appointment', 'apt_proposed') ?? {};
      proposed['proposalExpiresAt'] = new Date(Date.now() - 1_000);
      const expired = await request(server).post(path(clock)).send({ token: PROPOSAL_TOKEN });
      expectContract('post', '/v1/appointments/{reference}/accept-proposal', 410, expired);

      // 5 envois par minute et par adresse : compteur remis à zéro pour la suite.
      throttler.reset();
      proposed['proposalExpiresAt'] = new Date(Date.now() + DAY);
      rows('appointment').push({
        ...find('appointment', 'apt_pending'),
        id: 'apt_other',
        reference: clock.ref(150),
        status: 'CONFIRME',
        startsAt: clock.at(clock.D, 11),
        endsAt: clock.at(clock.D, 12),
      });
      const taken = await request(server).post(path(clock)).send({ token: PROPOSAL_TOKEN });
      expectContract('post', '/v1/appointments/{reference}/accept-proposal', 409, taken);
      expect((taken.body as Row)['type']).toBe(`${PROBLEMS}slot-taken`);

      proposed['status'] = 'ANNULE';
      const closed = await request(server).post(path(clock)).send({ token: PROPOSAL_TOKEN });
      expectContract('post', '/v1/appointments/{reference}/accept-proposal', 409, closed);
      expect(reminders.add).not.toHaveBeenCalled();
    });
  });

  describe('GET /v1/admin/appointments', () => {
    it('renvoie l’agenda de la période (début affiché) et la file « À confirmer » (200)', async () => {
      const response = await sessions.admin.agent.get(`/v1/admin/appointments?${agendaQuery()}`);

      expectContract('get', '/v1/admin/appointments', 200, response);
      const body = response.body as Agenda;
      // Samuel est affiché sur le créneau proposé (D 11:00), pas sur son créneau d'origine (E 09:00).
      expect(ids(body.data)).toEqual(['apt_confirmed', 'apt_cancelled', 'apt_proposed', 'apt_pending']);
      expect(ids(body.pending)).toEqual(['apt_pending']);
      expect(body.data[0]).toEqual({
        id: 'apt_confirmed',
        reference: clock.ref(139),
        contact: {
          id: 'ctc_ruth',
          fullName: 'Ruth Abena',
          initials: 'RA',
          email: 'ruth.a@example.com',
          phone: '+32470000000',
          country: 'BE',
          city: 'Bruxelles',
          profile: 'PARTICULIER',
        },
        reason: 'IMMOBILIER',
        format: 'VISIO',
        startsAt: iso(clock.D, 9),
        endsAt: iso(clock.D, 10),
        status: 'CONFIRME',
        proposedStartsAt: null,
        location: null,
        videoLink: 'https://meet.example.com/mambo-ruth',
        message: null,
        notes: null,
        reminderSentAt: null,
        assignedTo: { id: ACCOUNTS.agent.id, name: 'Paul Ngando', initials: 'PN' },
        createdAt: new Date(clock.now - 5 * DAY).toISOString(),
      });

      const confirmed = await sessions.admin.agent.get(
        `/v1/admin/appointments?${agendaQuery()}&status=CONFIRME`,
      );
      expect(ids((confirmed.body as Agenda).data)).toEqual(['apt_confirmed']);
      const none = await sessions.manager.agent.get(`/v1/admin/appointments?${agendaQuery()}&assignee=none`);
      expect(ids((none.body as Agenda).data)).toEqual(['apt_cancelled', 'apt_pending']);
    });

    it('limite un chargé de clientèle à ses rendez-vous (200, 403) ; refuse les autres rôles et les paramètres invalides', async () => {
      const own = await sessions.agent.agent.get(`/v1/admin/appointments?${agendaQuery()}`);
      expectContract('get', '/v1/admin/appointments', 200, own);
      expect(ids((own.body as Agenda).data)).toEqual(['apt_confirmed']);
      expect((own.body as Agenda).pending).toEqual([]);

      const other = await sessions.agent.agent.get(
        `/v1/admin/appointments?${agendaQuery()}&assignee=${ACCOUNTS.manager.id}`,
      );
      expectContract('get', '/v1/admin/appointments', 403, other);

      const writer = await sessions.writer.agent.get(`/v1/admin/appointments?${agendaQuery()}`);
      expectContract('get', '/v1/admin/appointments', 403, writer);
      const anonymous = await request(server).get(`/v1/admin/appointments?${agendaQuery()}`);
      expectContract('get', '/v1/admin/appointments', 401, anonymous);

      for (const query of [
        'from=lundi&to=mardi',
        `${agendaQuery()}&status=PERDU`,
        'to=2026-10-05T00:00:00Z',
      ]) {
        const invalid = await sessions.admin.agent.get(`/v1/admin/appointments?${query}`);
        expectContract('get', '/v1/admin/appointments', 400, invalid);
        expect((invalid.body as Row)['type']).toBe(`${PROBLEMS}invalid-query`);
      }
    });

    it('détaille un rendez-vous visible (200) et cache les autres (404)', async () => {
      const detail = await sessions.agent.agent.get('/v1/admin/appointments/apt_confirmed');
      expectContract('get', '/v1/admin/appointments/{id}', 200, detail);
      const hidden = await sessions.agent.agent.get('/v1/admin/appointments/apt_pending');
      expectContract('get', '/v1/admin/appointments/{id}', 404, hidden);
      const missing = await sessions.admin.agent.get('/v1/admin/appointments/apt_inconnu');
      expectContract('get', '/v1/admin/appointments/{id}', 404, missing);
      expectContract(
        'get',
        '/v1/admin/appointments/{id}',
        403,
        await sessions.writer.agent.get('/v1/admin/appointments/apt_confirmed'),
      );
    });
  });

  describe('POST /v1/admin/appointments', () => {
    const input = (overrides: Row = {}): Row => ({
      contact: {
        fullName: 'Joël Nkoulou',
        email: 'joel.nkoulou@example.com',
        phone: '+237677445566',
        country: 'CM',
      },
      reason: 'RECRUTEMENT',
      format: 'VISIO',
      startsAt: iso(clock.E, 15),
      durationMinutes: 45,
      notes: 'Entretien pour le poste de coordinateur.',
      ...overrides,
    });

    it('saisit un rendez-vous confirmé, assigné à qui le saisit, avec e-mail et rappel (201)', async () => {
      const response = await sessions.admin.agent
        .post('/v1/admin/appointments')
        .set('X-CSRF-Token', sessions.admin.csrf)
        .send(input());

      expectContract('post', '/v1/admin/appointments', 201, response);
      const created = response.body as Row;
      expect(created).toMatchObject({
        status: 'CONFIRME',
        startsAt: iso(clock.E, 15),
        endsAt: iso(clock.E, 15, 45),
        videoLink: 'https://meet.mamboproxi.com/agence',
        location: null,
        notes: 'Entretien pour le poste de coordinateur.',
        assignedTo: { id: ACCOUNTS.admin.id, name: 'Mireille Bell', initials: 'MB' },
        contact: expect.objectContaining({
          fullName: 'Joël Nkoulou',
          email: 'joel.nkoulou@example.com',
        }) as unknown,
      });
      expect(String(created['reference'])).toMatch(REFERENCE_PATTERN);
      expect(find('appointment', String(created['id']))).toMatchObject({
        createdById: ACCOUNTS.admin.id,
        requestId: null,
      });
      const confirmation = mail.last('appointment-confirmed', 'joel.nkoulou@example.com');
      expect(confirmation?.data).toMatchObject({
        reasonLabel: 'Recrutement',
        videoLink: 'https://meet.mamboproxi.com/agence',
      });
      expect(String(confirmation?.data['ics'])).toContain('URL:https://meet.mamboproxi.com/agence');
      const jobId = reminderJobId(String(created['id']), clock.at(clock.E, 15));
      const job = reminders.jobs.get(jobId);
      const expectedDelay = reminderTime(clock.at(clock.E, 15), 9).getTime() - Date.now();
      expect(job?.delay).toBeGreaterThan(expectedDelay - 60_000);
      expect(job?.delay).toBeLessThanOrEqual(expectedDelay + 1_000);
      expect(rows('auditLog').at(-1)).toMatchObject({ action: 'appointment.create', entity: 'Appointment' });
      expect(JSON.stringify(rows('auditLog').at(-1))).not.toContain('Joël');
    });

    it('assigne sur demande (notification, e-mail), applique l’adresse de l’agence, sans e-mail au client si demandé', async () => {
      const response = await sessions.manager.agent
        .post('/v1/admin/appointments')
        .set('X-CSRF-Token', sessions.manager.csrf)
        .send(input({ format: 'AGENCE', assignedToId: ACCOUNTS.agent.id, notifyClient: false }));

      expectContract('post', '/v1/admin/appointments', 201, response);
      expect(response.body).toMatchObject({ location: 'Agence Douala, Bonapriso', videoLink: null });
      expect(mail.last('appointment-confirmed', 'joel.nkoulou@example.com')).toBeUndefined();
      expect(mail.last('team-assignment', ACCOUNTS.agent.email)?.data['actionUrl']).toMatch(
        /\/admin\/rendez-vous\?id=/,
      );
      expect(rows('notification').find((row) => row['userId'] === ACCOUNTS.agent.id)).toMatchObject({
        kind: 'ASSIGNMENT',
        entityType: 'Appointment',
      });
    });

    it('refuse un chevauchement (409), une personne non assignable (422), les rôles sans droit et sans CSRF (403)', async () => {
      const overlap = await sessions.admin.agent
        .post('/v1/admin/appointments')
        .set('X-CSRF-Token', sessions.admin.csrf)
        .send(input({ startsAt: iso(clock.D, 9, 30) }));
      expectContract('post', '/v1/admin/appointments', 409, overlap);
      expect((overlap.body as Row)['detail']).toContain(clock.ref(139));

      const writer = await sessions.admin.agent
        .post('/v1/admin/appointments')
        .set('X-CSRF-Token', sessions.admin.csrf)
        .send(input({ assignedToId: ACCOUNTS.writer.id }));
      expectContract('post', '/v1/admin/appointments', 422, writer);

      const agent = await sessions.agent.agent
        .post('/v1/admin/appointments')
        .set('X-CSRF-Token', sessions.agent.csrf)
        .send(input());
      expectContract('post', '/v1/admin/appointments', 403, agent);

      const csrf = await sessions.admin.agent.post('/v1/admin/appointments').send(input());
      expectContract('post', '/v1/admin/appointments', 403, csrf);
      expect((csrf.body as Row)['type']).toBe(`${PROBLEMS}csrf-token-invalid`);

      const invalid = await sessions.admin.agent
        .post('/v1/admin/appointments')
        .set('X-CSRF-Token', sessions.admin.csrf)
        .send(input({ durationMinutes: 5, videoLink: 'pas-un-lien' }));
      expectContract('post', '/v1/admin/appointments', 422, invalid);
      expect(rows('appointment')).toHaveLength(5);
    });
  });

  describe('PATCH /v1/admin/appointments/{id}', () => {
    it('confirme une demande (e-mail avec invitation, rappel programmé), puis refuse de la confirmer de nouveau', async () => {
      const response = await patch(sessions.admin, 'apt_pending', { action: 'confirm' });

      expectContract('patch', '/v1/admin/appointments/{id}', 200, response);
      expect(response.body).toMatchObject({ status: 'CONFIRME', location: 'Agence Douala, Bonapriso' });
      const confirmation = mail.last('appointment-confirmed', 'aminata.diallo@example.com');
      expect(confirmation?.data).toMatchObject({
        startsAt: iso(clock.E, 10),
        place: 'Agence Douala, Bonapriso',
      });
      expect(reminders.jobs.has(reminderJobId('apt_pending', clock.at(clock.E, 10)))).toBe(true);

      const again = await patch(sessions.admin, 'apt_pending', { action: 'confirm' });
      expectContract('patch', '/v1/admin/appointments/{id}', 409, again);
    });

    it('reporte un rendez-vous confirmé : rappel retiré, lien d’acceptation, nouveau rappel à l’acceptation', async () => {
      const confirmedStart = clock.at(clock.D, 9);
      reminders.jobs.set(reminderJobId('apt_confirmed', confirmedStart), {
        data: { appointmentId: 'apt_confirmed', startsAt: confirmedStart.toISOString() },
        delay: 1_000,
      });

      // Paul (chargé de clientèle) agit sur son propre rendez-vous.
      const response = await patch(sessions.agent, 'apt_confirmed', {
        action: 'propose',
        proposedStartsAt: iso(clock.E, 11),
        message: 'Notre conseillère est absente ce jour-là.',
      });

      expectContract('patch', '/v1/admin/appointments/{id}', 200, response);
      expect(response.body).toMatchObject({
        status: 'AUTRE_CRENEAU_PROPOSE',
        proposedStartsAt: iso(clock.E, 11),
      });
      expect(reminders.removed).toContain(reminderJobId('apt_confirmed', confirmedStart));
      expect(reminders.jobs.size).toBe(0);
      const proposal = mail.last('appointment-proposed', 'ruth.a@example.com');
      expect(proposal).toMatchObject({
        lang: 'en',
        data: { startsAt: iso(clock.E, 11), reasonLabel: 'Real estate' },
      });
      expect(proposal?.data['message']).toBe('Notre conseillère est absente ce jour-là.');
      const link = new URL(String(proposal?.data['actionUrl']));
      expect(link.pathname).toBe('/en/rendez-vous/confirmer');
      expect(link.searchParams.get('ref')).toBe(clock.ref(139));
      // Le créneau d'origine est libéré, le créneau proposé est réservé.
      const free = await availability(`from=${clock.D}&to=${clock.E}`);
      const days = new Map((free.body as AvailabilityBody).days.map((day) => [day.date, day]));
      expect(starts(days.get(clock.D)?.slots ?? [])).toContain(iso(clock.D, 9));
      expect(starts(days.get(clock.E)?.slots ?? [])).not.toContain(iso(clock.E, 11));

      const accepted = await request(server)
        .post(`/v1/appointments/${clock.ref(139)}/accept-proposal`)
        .send({ token: link.searchParams.get('token') });
      expectContract('post', '/v1/appointments/{reference}/accept-proposal', 200, accepted);
      expect(accepted.body).toEqual({
        message: 'Great! Your appointment is confirmed. You will receive an invitation by e-mail.',
      });
      expect(find('appointment', 'apt_confirmed')).toMatchObject({
        status: 'CONFIRME',
        startsAt: clock.at(clock.E, 11),
      });
      expect(reminders.jobs.has(reminderJobId('apt_confirmed', clock.at(clock.E, 11)))).toBe(true);
    });

    it('refuse un créneau proposé passé (422) ou occupé (409)', async () => {
      const past = await patch(sessions.admin, 'apt_pending', {
        action: 'propose',
        proposedStartsAt: new Date(Date.now() - 3_600_000).toISOString(),
      });
      expectContract('patch', '/v1/admin/appointments/{id}', 422, past);
      expect((past.body as { errors: Row[] }).errors[0]).toMatchObject({ path: 'proposedStartsAt' });

      const busy = await patch(sessions.admin, 'apt_pending', {
        action: 'propose',
        proposedStartsAt: iso(clock.D, 11, 30),
      });
      expectContract('patch', '/v1/admin/appointments/{id}', 409, busy);
      expect(find('appointment', 'apt_pending')?.['status']).toBe('A_CONFIRMER');
    });

    it('annule (e-mail avec le message, rappel retiré), termine, annote ; refuse les transitions impossibles (409)', async () => {
      const cancel = await patch(sessions.manager, 'apt_confirmed', {
        action: 'cancel',
        message: 'Annulé à votre demande.',
      });
      expectContract('patch', '/v1/admin/appointments/{id}', 200, cancel);
      expect(cancel.body).toMatchObject({ status: 'ANNULE' });
      expect(reminders.removed).toEqual([reminderJobId('apt_confirmed', clock.at(clock.D, 9))]);
      const cancelled = mail.last('appointment-cancelled', 'ruth.a@example.com');
      expect(cancelled?.data).toMatchObject({ message: 'Annulé à votre demande.' });
      expect(String(cancelled?.data['actionUrl'])).toMatch(/\/en\/contact#rendez-vous$/);
      expectContract(
        'patch',
        '/v1/admin/appointments/{id}',
        409,
        await patch(sessions.manager, 'apt_confirmed', { action: 'cancel' }),
      );
      expectContract(
        'patch',
        '/v1/admin/appointments/{id}',
        409,
        await patch(sessions.manager, 'apt_confirmed', {
          action: 'propose',
          proposedStartsAt: iso(clock.E, 11),
        }),
      );

      expectContract(
        'patch',
        '/v1/admin/appointments/{id}',
        409,
        await patch(sessions.admin, 'apt_pending', { action: 'complete' }),
      );
      await patch(sessions.admin, 'apt_pending', { action: 'confirm' });
      const complete = await patch(sessions.admin, 'apt_pending', { action: 'complete' });
      expectContract('patch', '/v1/admin/appointments/{id}', 200, complete);
      expect(complete.body).toMatchObject({ status: 'TERMINE' });
      expect(reminders.jobs.has(reminderJobId('apt_pending', clock.at(clock.E, 10)))).toBe(false);

      const notes = await patch(sessions.admin, 'apt_pending', {
        action: 'notes',
        notes: '  Rappeler en janvier. ',
      });
      expectContract('patch', '/v1/admin/appointments/{id}', 200, notes);
      expect(notes.body).toMatchObject({ notes: 'Rappeler en janvier.' });
      expect(rows('auditLog').map((row) => row['action'])).toEqual(
        expect.arrayContaining(['appointment.cancel', 'appointment.confirm', 'appointment.complete']),
      );
    });

    it('assigne (responsable seulement) et limite le chargé de clientèle à ses rendez-vous', async () => {
      const assign = await patch(sessions.manager, 'apt_pending', {
        action: 'assign',
        assignedToId: ACCOUNTS.agent.id,
      });
      expectContract('patch', '/v1/admin/appointments/{id}', 200, assign);
      expect(assign.body).toMatchObject({
        assignedTo: { id: ACCOUNTS.agent.id, name: 'Paul Ngando', initials: 'PN' },
      });
      expect(mail.last('team-assignment', ACCOUNTS.agent.email)).toBeDefined();
      expect(rows('notification').filter((row) => row['userId'] === ACCOUNTS.agent.id)).toHaveLength(1);

      expectContract(
        'patch',
        '/v1/admin/appointments/{id}',
        422,
        await patch(sessions.manager, 'apt_pending', { action: 'assign', assignedToId: ACCOUNTS.invited.id }),
      );
      expectContract(
        'patch',
        '/v1/admin/appointments/{id}',
        403,
        await patch(sessions.agent, 'apt_confirmed', { action: 'assign', assignedToId: null }),
      );
      expectContract(
        'patch',
        '/v1/admin/appointments/{id}',
        404,
        await patch(sessions.agent, 'apt_proposed', { action: 'cancel' }),
      );
      expectContract(
        'patch',
        '/v1/admin/appointments/{id}',
        403,
        await patch(sessions.writer, 'apt_pending', { action: 'notes', notes: null }),
      );
      expectContract(
        'patch',
        '/v1/admin/appointments/{id}',
        422,
        await patch(sessions.admin, 'apt_pending', { action: 'reporter' }),
      );
      const csrf = await sessions.admin.agent
        .patch('/v1/admin/appointments/apt_pending')
        .send({ action: 'complete' });
      expectContract('patch', '/v1/admin/appointments/{id}', 403, csrf);
    });
  });

  describe('rappel de la veille (worker)', () => {
    it('envoie le rappel d’un rendez-vous confirmé une seule fois, et rien pour un rendez-vous changé', async () => {
      const service = app.get(AppointmentRemindersService);
      const job = { appointmentId: 'apt_confirmed', startsAt: iso(clock.D, 9) };

      expect(await service.deliver(job, new Date())).toBe('sent');
      expect(mail.last('appointment-reminder', 'ruth.a@example.com')).toMatchObject({
        lang: 'en',
        reference: clock.ref(139),
        data: { startsAt: iso(clock.D, 9), videoLink: 'https://meet.example.com/mambo-ruth' },
      });
      expect(find('appointment', 'apt_confirmed')?.['reminderSentAt']).toBeInstanceOf(Date);
      // Tâche rejouée : rien de plus.
      expect(await service.deliver(job, new Date())).toBe('skipped');
      expect(mail.jobs.filter((item) => item.template === 'appointment-reminder')).toHaveLength(1);

      // Rendez-vous déplacé ou annulé depuis la programmation : la tâche est caduque.
      expect(
        await service.deliver({ appointmentId: 'apt_pending', startsAt: iso(clock.E, 10) }, new Date()),
      ).toBe('skipped');
      expect(
        await service.deliver({ appointmentId: 'apt_cancelled', startsAt: iso(clock.D, 10) }, new Date()),
      ).toBe('skipped');
      expect(
        await service.deliver({ appointmentId: 'apt_proposed', startsAt: iso(clock.D, 11) }, new Date()),
      ).toBe('skipped');
    });

    it('ne programme pas de rappel quand la veille est déjà passée', async () => {
      const service = app.get(AppointmentRemindersService);
      const startsAt = new Date(Date.now() + 2 * 3_600_000);
      expect(await service.schedule({ id: 'apt_x', startsAt }, new Date())).toBe(false);
      expect(reminders.add).not.toHaveBeenCalled();
    });
  });

  describe('/v1/admin/availability', () => {
    it('renvoie les plages, fermetures et réglages (200), refusés au chargé de clientèle (403)', async () => {
      const response = await sessions.manager.agent.get('/v1/admin/availability');

      expectContract('get', '/v1/admin/availability', 200, response);
      const body = response.body as { rules: Row[]; exceptions: Row[] } & Row;
      expect(body.rules).toHaveLength(12);
      expect(body.rules[0]).toEqual({
        id: 'rul_1_am',
        weekday: 1,
        startTime: '09:00',
        endTime: '12:00',
        slotMinutes: 60,
        formats: ['AGENCE', 'TELEPHONE', 'VISIO'],
      });
      expect(body.exceptions).toEqual([
        {
          id: 'exc_fete',
          date: clock.F,
          closed: true,
          startTime: null,
          endTime: null,
          label: 'Fête nationale',
        },
      ]);
      expect(body).toMatchObject({
        minNoticeHours: 24,
        maxAdvanceDays: 60,
        agencyAddress: 'Agence Douala, Bonapriso',
        defaultVideoLink: 'https://meet.mamboproxi.com/agence',
      });
      expectContract(
        'get',
        '/v1/admin/availability',
        403,
        await sessions.agent.agent.get('/v1/admin/availability'),
      );
    });

    it('enregistre les plages et fermetures (ids conservés), appliquées aussitôt aux créneaux (200)', async () => {
      const response = await sessions.editor.agent
        .put('/v1/admin/availability')
        .set('X-CSRF-Token', sessions.editor.csrf)
        .send({
          rules: [
            {
              id: 'rul_1_am',
              weekday: 1,
              startTime: '08:00',
              endTime: '12:00',
              slotMinutes: 120,
              formats: ['VISIO'],
            },
            ...[2, 3, 4, 5, 6].map((weekday) => ({
              weekday,
              startTime: '08:00',
              endTime: '12:00',
              slotMinutes: 120,
              formats: ['VISIO', 'TELEPHONE'],
            })),
          ],
          exceptions: [
            { id: 'exc_fete', date: clock.F, closed: true, label: 'Fête nationale' },
            { date: clock.E, closed: false, startTime: '10:00', endTime: '12:00', label: 'Horaires réduits' },
          ],
          minNoticeHours: 12,
          maxAdvanceDays: 90,
        });

      expectContract('put', '/v1/admin/availability', 200, response);
      const body = response.body as { rules: Row[]; exceptions: Row[] } & Row;
      expect(body.rules).toHaveLength(6);
      expect(body.rules[0]).toMatchObject({ id: 'rul_1_am', startTime: '08:00', formats: ['VISIO'] });
      expect(body.rules[1]?.['id']).toEqual(expect.any(String));
      const exceptionIds: unknown[] = [clock.E, clock.F]
        .sort()
        .map((date): unknown => (date === clock.F ? 'exc_fete' : expect.any(String)));
      expect(ids(body.exceptions)).toEqual(exceptionIds);
      // Adresse et lien par défaut absents : conservés.
      expect(body).toMatchObject({
        minNoticeHours: 12,
        maxAdvanceDays: 90,
        agencyAddress: 'Agence Douala, Bonapriso',
      });
      expect(rows('auditLog').at(-1)).toMatchObject({
        action: 'availability.update',
        label: 'A modifié les disponibilités de la prise de rendez-vous',
      });

      const slots = await availability(`from=${clock.E}&to=${clock.E}`);
      // Horaires réduits 10:00–12:00 : un créneau de 2 h, déjà pris à 10:00 par la demande à confirmer.
      expect((slots.body as AvailabilityBody).days[0]).toMatchObject({
        available: false,
        closedReason: 'Horaires réduits',
      });
    });

    it('refuse des réglages incohérents (422) et les rôles sans droit (403)', async () => {
      const invalid = await sessions.admin.agent
        .put('/v1/admin/availability')
        .set('X-CSRF-Token', sessions.admin.csrf)
        .send({
          rules: [{ weekday: 8, startTime: '12:00', endTime: '09:00', slotMinutes: 90, formats: [] }],
          exceptions: [{ date: '2026-13-01', closed: false }],
          minNoticeHours: 24,
          maxAdvanceDays: 60,
        });
      expectContract('put', '/v1/admin/availability', 422, invalid);
      expect((invalid.body as { errors: Row[] }).errors.map((error) => error['path'])).toEqual(
        expect.arrayContaining(['rules.0.weekday', 'rules.0.formats', 'exceptions.0.date']),
      );

      const writer = await sessions.writer.agent
        .put('/v1/admin/availability')
        .set('X-CSRF-Token', sessions.writer.csrf)
        .send({ rules: [], exceptions: [], minNoticeHours: 24, maxAdvanceDays: 60 });
      expectContract('put', '/v1/admin/availability', 403, writer);
      expect(rows('availabilityRule')).toHaveLength(12);
    });
  });
});

describe.runIf(process.env['E2E_REAL_SERVICES'] === 'true')(
  'rendez-vous et disponibilités (avec la base réelle, remplie par le seed)',
  () => {
    const mail = new MailQueueDouble();
    const reminders = new ReminderQueueDouble();
    const throttler = new ResettableThrottlerStorage();
    const runId = String(Date.now());
    const adminEmail = `e2e.rdv.${runId}@example.com`;
    const clientEmails = ['a', 'b', 'c'].map((suffix) => `e2e.rdv.${suffix}.${runId}@example.com`);
    let app: NestExpressApplication;
    let server: Server;
    let prisma: PrismaService;
    let admin: TestSession;
    let adminId: string;
    let slots: string[] = [];

    const body = (startsAt: string, email: string): Row => ({
      reason: 'AUTRE',
      format: 'TELEPHONE',
      startsAt,
      contact: { fullName: 'Essai Rendez-vous', email, phone: '+237600000001' },
      message: null,
      consent: true,
      antiSpam: antiSpam(),
    });

    beforeAll(async () => {
      prepareContract(
        'AdminAppointment',
        'Availability',
        'AvailabilityConfig',
        'SubmissionAccepted',
        'Problem',
      );
      app = await createApp({ mail, throttler, reminders });
      server = app.getHttpServer();
      prisma = app.get(PrismaService);
      const now = new Date();
      const user = await prisma.user.create({
        data: {
          email: adminEmail,
          name: 'Admin Rendez-vous',
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
      const contacts = await prisma.contact.findMany({
        where: { email: { in: clientEmails } },
        select: { id: true },
      });
      const contactIds = contacts.map((contact) => contact.id);
      const appointments = await prisma.appointment.findMany({
        where: { contactId: { in: contactIds } },
        select: { id: true, requestId: true },
      });
      const requestIds = appointments.flatMap((row) => (row.requestId ? [row.requestId] : []));
      const entityIds = [...appointments.map((row) => row.id), ...requestIds];
      await prisma.notification.deleteMany({ where: { entityId: { in: entityIds } } });
      await prisma.appointment.deleteMany({ where: { contactId: { in: contactIds } } });
      await prisma.request.deleteMany({ where: { contactId: { in: contactIds } } });
      await prisma.contact.deleteMany({ where: { id: { in: contactIds } } });
      await prisma.auditLog.deleteMany({ where: { actorId: adminId } });
      await prisma.user.deleteMany({ where: { id: adminId } });
      await app.close();
    });

    beforeEach(() => {
      mail.reset();
      reminders.reset();
      throttler.reset();
    });

    it('lit l’agenda, les disponibilités et les créneaux du seed, conformes au contrat', async () => {
      const from = new Date(Date.now() - 30 * DAY).toISOString();
      const to = new Date(Date.now() + 60 * DAY).toISOString();
      const agenda = await admin.agent.get(
        `/v1/admin/appointments?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      );
      expectContract('get', '/v1/admin/appointments', 200, agenda);
      expect((agenda.body as Agenda).data.length).toBeGreaterThan(3);

      const config = await admin.agent.get('/v1/admin/availability');
      expectContract('get', '/v1/admin/availability', 200, config);
      // Réenregistrement à l'identique : mêmes identifiants, mêmes valeurs (colonnes `date` et tableaux de formats).
      const saved = await admin.agent
        .put('/v1/admin/availability')
        .set('X-CSRF-Token', admin.csrf)
        .send(config.body as Row);
      expectContract('put', '/v1/admin/availability', 200, saved);
      expect(saved.body).toEqual(config.body);

      const today = doualaDate(new Date());
      const free = await request(server).get(
        `/v1/appointments/availability?from=${today}&to=${addDays(today, 30)}&format=TELEPHONE`,
      );
      expectContract('get', '/v1/appointments/availability', 200, free);
      slots = (free.body as AvailabilityBody).days.flatMap((day) =>
        day.slots.map((slot) => String(slot['startsAt'])),
      );
      expect(slots.length).toBeGreaterThanOrEqual(2);
    });

    it('n’accepte qu’une réservation par créneau, y compris simultanée (verrou et index unique réels)', async () => {
      const [first = '', second = ''] = slots;
      const created = await request(server)
        .post('/v1/appointments')
        .send(body(first, clientEmails[0] ?? ''));
      expectContract('post', '/v1/appointments', 201, created);
      const again = await request(server)
        .post('/v1/appointments')
        .send(body(first, clientEmails[1] ?? ''));
      expectContract('post', '/v1/appointments', 409, again);

      const race = await Promise.all(
        [clientEmails[1] ?? '', clientEmails[2] ?? ''].map((email) =>
          request(server).post('/v1/appointments').send(body(second, email)),
        ),
      );
      expect(race.map((response) => response.status).sort()).toEqual([201, 409]);
      for (const response of race) expectContract('post', '/v1/appointments', response.status, response);

      // L'index unique partiel lui-même : un second rendez-vous actif au même instant est refusé par la base, et
      // l'erreur de l'adaptateur `pg` est reconnue comme une double réservation.
      const existing = await prisma.appointment.findFirstOrThrow({
        where: { startsAt: new Date(first), status: 'A_CONFIRMER' },
        select: { contactId: true, endsAt: true },
      });
      const duplicate = prisma.appointment.create({
        data: {
          reference: `MP-${String(referenceYear(new Date()))}-9${runId.slice(-6)}`,
          contactId: existing.contactId,
          reason: 'AUTRE',
          format: 'TELEPHONE',
          startsAt: new Date(first),
          endsAt: existing.endsAt,
          status: 'CONFIRME',
        },
      });
      const error: unknown = await duplicate.then(
        () => null,
        (caught: unknown) => caught,
      );
      expect(error).not.toBeNull();
      expect(isSlotTakenError(error)).toBe(true);
    });

    it('confirme, reporte, fait accepter et annule le rendez-vous de test', async () => {
      const [first = ''] = slots;
      const row = await prisma.appointment.findFirstOrThrow({
        where: { startsAt: new Date(first), status: 'A_CONFIRMER' },
        select: { id: true, reference: true },
      });
      const path = `/v1/admin/appointments/${row.id}`;
      const confirmed = await admin.agent
        .patch(path)
        .set('X-CSRF-Token', admin.csrf)
        .send({ action: 'confirm' });
      expectContract('patch', '/v1/admin/appointments/{id}', 200, confirmed);
      expect(mail.jobs.map((job) => job.template)).toContain('appointment-confirmed');

      // Créneau proposé hors des plages (la nuit, dans 200 jours) : libre.
      const later = new Date(Date.now() + 200 * DAY);
      later.setUTCHours(2, 0, 0, 0);
      const proposed = await admin.agent
        .patch(path)
        .set('X-CSRF-Token', admin.csrf)
        .send({ action: 'propose', proposedStartsAt: later.toISOString() });
      expectContract('patch', '/v1/admin/appointments/{id}', 200, proposed);
      const actionUrl = new URL(
        String(mail.last('appointment-proposed', clientEmails[0] ?? '')?.data['actionUrl']),
      );

      const accepted = await request(server)
        .post(`/v1/appointments/${row.reference}/accept-proposal`)
        .send({ token: actionUrl.searchParams.get('token') });
      expectContract('post', '/v1/appointments/{reference}/accept-proposal', 200, accepted);
      expect(
        await prisma.appointment.findUnique({
          where: { id: row.id },
          select: { status: true, startsAt: true },
        }),
      ).toEqual({
        status: 'CONFIRME',
        startsAt: later,
      });

      const cancelled = await admin.agent
        .patch(path)
        .set('X-CSRF-Token', admin.csrf)
        .send({ action: 'cancel', message: null });
      expectContract('patch', '/v1/admin/appointments/{id}', 200, cancelled);
      expect(reminders.removed).toContain(reminderJobId(row.id, later));
    });
  },
);
