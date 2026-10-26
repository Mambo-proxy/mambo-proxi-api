import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAIL_JOB_OPTIONS, QUEUE_NAMES } from '../queue/queue.constants.js';
import {
  ENQUEUE_TIMEOUT_MS,
  mailJobId,
  MailQueueService,
  type MailQueueClient,
} from './mail-queue.service.js';
import type { MailJob } from './mail.types.js';

const JOB: MailJob = {
  template: 'quote-ack',
  to: 'Aurelie@Example.com',
  lang: 'fr',
  data: { firstName: 'Aurélie', serviceName: 'Chef privé' },
  reference: 'MP-2026-0142',
};

function fakeQueue(addBulk: MailQueueClient['addBulk'] = vi.fn().mockResolvedValue([])) {
  const queue = { addBulk: vi.fn(addBulk), close: vi.fn().mockResolvedValue(undefined) };
  const factory = vi.fn(() => queue);
  return { queue, factory, service: new MailQueueService(factory) };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('options de la file des e-mails', () => {
  it('file « mail », 5 tentatives à attente exponentielle, historique limité', () => {
    expect(QUEUE_NAMES.mail).toBe('mail');
    expect(MAIL_JOB_OPTIONS).toEqual({
      attempts: 5,
      backoff: { type: 'exponential', delay: 60_000 },
      removeOnComplete: { age: 7 * 24 * 3600, count: 1_000 },
      removeOnFail: { age: 30 * 24 * 3600, count: 5_000 },
    });
  });
});

describe('mailJobId', () => {
  it('est stable pour une même tâche, quel que soit l’ordre des données ou la casse de l’adresse', () => {
    const id = mailJobId(JOB);
    expect(id).toMatch(/^quote-ack-MP-2026-0142-[0-9a-f]{24}$/);
    expect(
      mailJobId({
        ...JOB,
        to: 'aurelie@example.com',
        data: { serviceName: 'Chef privé', firstName: 'Aurélie' },
      }),
    ).toBe(id);
  });

  it('diffère pour un autre destinataire ou d’autres données, et ne contient pas l’adresse', () => {
    const id = mailJobId(JOB);
    expect(mailJobId({ ...JOB, to: 'equipe@mamboproxi.com' })).not.toBe(id);
    expect(mailJobId({ ...JOB, data: { firstName: 'Paul' } })).not.toBe(id);
    expect(id).not.toContain('example');
    // BullMQ refuse « : » dans un identifiant personnalisé.
    expect(id).not.toContain(':');
  });

  it('n’existe pas sans référence (code de connexion, invitation…)', () => {
    expect(
      mailJobId({ template: 'otp-code', to: 'a@example.com', lang: 'fr', data: { code: '123456' } }),
    ).toBeUndefined();
  });
});

describe('MailQueueService', () => {
  it('ajoute les tâches en un lot, nommées par modèle, avec un identifiant stable', async () => {
    const { queue, factory, service } = fakeQueue();
    const otp: MailJob = {
      template: 'otp-code',
      to: 'mireille@mamboproxi.com',
      lang: 'fr',
      data: { code: '1' },
    };

    await service.enqueueMany([JOB, otp]);
    await service.enqueue(otp);

    expect(factory).toHaveBeenCalledTimes(1);
    expect(queue.addBulk).toHaveBeenNthCalledWith(1, [
      { name: 'quote-ack', data: JOB, opts: { jobId: mailJobId(JOB) } },
      { name: 'otp-code', data: otp, opts: {} },
    ]);
    expect(queue.addBulk).toHaveBeenCalledTimes(2);
  });

  it('ne crée pas la file tant qu’aucun e-mail n’est demandé', async () => {
    const { factory, service } = fakeQueue();

    await service.enqueueMany([]);
    await service.onModuleDestroy();

    expect(factory).not.toHaveBeenCalled();
  });

  it('refuse une tâche invalide sans rien mettre en file', async () => {
    const { queue, service } = fakeQueue();

    await expect(service.enqueue({ ...JOB, to: 'pas-une-adresse' })).rejects.toThrow();
    await expect(service.enqueue({ ...JOB, template: 'inconnu' as MailJob['template'] })).rejects.toThrow();
    expect(queue.addBulk).not.toHaveBeenCalled();
  });

  it('rend la main si Redis ne répond pas, et sans erreur si l’ajout échoue', async () => {
    vi.useFakeTimers();
    const pending = fakeQueue(() => new Promise(() => undefined));
    const enqueued = pending.service.enqueue(JOB);
    await vi.advanceTimersByTimeAsync(ENQUEUE_TIMEOUT_MS);
    await expect(enqueued).resolves.toBeUndefined();

    const failing = fakeQueue(() => Promise.reject(new Error('connexion refusée')));
    await expect(failing.service.enqueue(JOB)).resolves.toBeUndefined();
  });

  it('ferme la file à l’arrêt', async () => {
    const { queue, service } = fakeQueue();
    await service.enqueue(JOB);

    await service.onModuleDestroy();

    expect(queue.close).toHaveBeenCalledTimes(1);
  });
});
