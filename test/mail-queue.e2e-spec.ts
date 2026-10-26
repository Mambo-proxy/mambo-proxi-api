/**
 * File des e-mails sur un vrai Redis (CI, ou en local après `pnpm services:up`) : une tâche mise en file par
 * `MailQueueService` est consommée par le worker, rendue et « envoyée » par un transport Nodemailer
 * `jsonTransport` (aucun SMTP réel : pas de Mailpit en CI). La base est remplacée par un double minimal.
 * Activé par `E2E_REAL_SERVICES=true` ; les clés Redis portent un préfixe propre au test, purgé à la fin.
 */
import { Test, type TestingModule } from '@nestjs/testing';
import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { createTransport } from 'nodemailer';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppConfigModule } from '../src/config/app-config.module.js';
import { MailQueueService } from '../src/modules/mail/mail-queue.service.js';
import { MAIL_TRANSPORT } from '../src/modules/mail/mail-sender.service.js';
import { MailModule } from '../src/modules/mail/mail.module.js';
import { MailProcessor } from '../src/modules/mail/mail.processor.js';
import { QUEUE_NAMES, QUEUE_PREFIX, REDIS_CONNECTION } from '../src/modules/queue/queue.constants.js';
import { PrismaModule } from '../src/prisma/prisma.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

describe.runIf(process.env['E2E_REAL_SERVICES'] === 'true')('File des e-mails (Redis réel)', () => {
  const prefix = `mambo-test-${process.pid}-${Date.now()}`;
  const transport = createTransport({ jsonTransport: true });
  const sendMail = vi.spyOn(transport, 'sendMail');
  const prisma = {
    emailTemplate: { findUnique: vi.fn().mockResolvedValue(null) },
    setting: { findMany: vi.fn().mockResolvedValue([]) },
    request: { findUnique: vi.fn().mockResolvedValue(null) },
    appointment: { findUnique: vi.fn().mockResolvedValue(null) },
    requestEvent: { findFirst: vi.fn(), create: vi.fn() },
    campaignDelivery: { updateMany: vi.fn() },
    $disconnect: vi.fn().mockResolvedValue(undefined),
  };
  let moduleRef: TestingModule;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppConfigModule, PrismaModule, MailModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(MAIL_TRANSPORT)
      .useValue(transport)
      .overrideProvider(QUEUE_PREFIX)
      .useValue(prefix)
      .compile();
    await moduleRef.init();
    // MAIL_WORKER vaut « off » en test : le worker est démarré explicitement.
    moduleRef.get(MailProcessor).start();
  });

  afterAll(async () => {
    const connection = moduleRef.get<Redis>(REDIS_CONNECTION);
    const queue = new Queue(QUEUE_NAMES.mail, { connection, prefix });
    await queue.obliterate({ force: true });
    await queue.close();
    await moduleRef.close();
  });

  it('consomme une tâche mise en file et envoie l’e-mail rendu', async () => {
    await moduleRef.get(MailQueueService).enqueue({
      template: 'otp-code',
      to: 'mireille@mamboproxi.com',
      lang: 'fr',
      data: { code: '482913' },
    });

    await vi.waitFor(() => expect(sendMail).toHaveBeenCalledTimes(1), { timeout: 15_000, interval: 100 });
    const options = sendMail.mock.calls[0]?.[0];
    expect(options).toMatchObject({
      to: 'mireille@mamboproxi.com',
      subject: 'Votre code de connexion : 482913',
    });
    expect(options?.html).toEqual(expect.stringContaining('482913'));
    expect(options?.text).toEqual(expect.stringContaining('482913'));
  });
});
