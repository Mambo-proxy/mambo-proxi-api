/**
 * File des rappels de rendez-vous sur un vrai Redis (CI, ou en local après `pnpm services:up`) : la tâche
 * programmée est différée jusqu'à la veille (état `delayed`), n'est ajoutée qu'une fois, est retirée à
 * l'annulation ; le worker consomme une tâche échue et met le rappel en file d'envoi. La base et la file des e-mails
 * sont remplacées par des doubles. Activé par `E2E_REAL_SERVICES=true` ; préfixe Redis propre au test, purgé à la fin.
 */
import { Test, type TestingModule } from '@nestjs/testing';
import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppConfigModule } from '../src/config/app-config.module.js';
import { AppointmentMailService } from '../src/modules/appointments/appointment-mail.service.js';
import { AppointmentReminderProcessor } from '../src/modules/appointments/appointment-reminder.processor.js';
import {
  AppointmentRemindersService,
  reminderJobId,
  reminderQueueFactoryProvider,
  reminderTime,
} from '../src/modules/appointments/appointment-reminders.service.js';
import { MailQueueService } from '../src/modules/mail/mail-queue.service.js';
import { QUEUE_NAMES, QUEUE_PREFIX, REDIS_CONNECTION } from '../src/modules/queue/queue.constants.js';
import { QueueModule } from '../src/modules/queue/queue.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { MailQueueDouble } from './support/auth.js';

const DAY = 86_400_000;

describe.runIf(process.env['E2E_REAL_SERVICES'] === 'true')(
  'File des rappels de rendez-vous (Redis réel)',
  () => {
    const prefix = `mambo-test-rappels-${String(process.pid)}-${String(Date.now())}`;
    const mail = new MailQueueDouble();
    const startsAt = new Date(Math.ceil((Date.now() + 5 * DAY) / 3_600_000) * 3_600_000);
    const appointment = {
      id: 'apt_redis',
      reference: 'MP-2026-0999',
      reason: 'DEVIS',
      format: 'TELEPHONE',
      startsAt,
      endsAt: new Date(startsAt.getTime() + 3_600_000),
      location: null,
      videoLink: null,
      language: 'FR',
      contact: {
        email: 'client.rappel@example.com',
        fullName: 'Client Rappel',
        firstName: 'Client',
        anonymizedAt: null,
      },
    };
    const prisma = {
      setting: { findUnique: vi.fn().mockResolvedValue(null) },
      appointment: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUnique: vi.fn().mockResolvedValue(appointment),
      },
      $disconnect: vi.fn().mockResolvedValue(undefined),
    };
    let moduleRef: TestingModule;
    let queue: Queue;

    beforeAll(async () => {
      moduleRef = await Test.createTestingModule({
        imports: [AppConfigModule, QueueModule],
        providers: [
          { provide: PrismaService, useValue: prisma },
          { provide: MailQueueService, useValue: mail },
          AppointmentMailService,
          reminderQueueFactoryProvider,
          AppointmentRemindersService,
          AppointmentReminderProcessor,
        ],
      })
        .overrideProvider(QUEUE_PREFIX)
        .useValue(prefix)
        .compile();
      await moduleRef.init();
      queue = new Queue(QUEUE_NAMES.appointmentReminders, {
        connection: moduleRef.get<Redis>(REDIS_CONNECTION),
        prefix,
      });
    });

    afterAll(async () => {
      await queue.obliterate({ force: true });
      await queue.close();
      await moduleRef.close();
    });

    it('diffère le rappel jusqu’à la veille, une seule fois, et le retire à l’annulation', async () => {
      const service = moduleRef.get(AppointmentRemindersService);
      const now = new Date();
      expect(await service.schedule(appointment, now)).toBe(true);
      expect(await service.schedule(appointment, now)).toBe(true);

      const jobId = reminderJobId(appointment.id, startsAt);
      const job = await queue.getJob(jobId);
      expect(await job?.getState()).toBe('delayed');
      expect(job?.data).toEqual({ appointmentId: appointment.id, startsAt: startsAt.toISOString() });
      expect(job?.opts.delay).toBe(reminderTime(startsAt, 9).getTime() - now.getTime());
      expect((await queue.getJobCounts('delayed'))['delayed']).toBe(1);

      await service.cancel(appointment);
      expect(await queue.getJob(jobId)).toBeUndefined();
    });

    it('consomme une tâche échue : le rappel part en file d’envoi', async () => {
      moduleRef.get(AppointmentReminderProcessor).start();
      await queue.add(
        'appointment-reminder',
        { appointmentId: appointment.id, startsAt: startsAt.toISOString() },
        { jobId: reminderJobId(appointment.id, new Date(startsAt.getTime() + 1)), delay: 50 },
      );

      await vi.waitFor(() => expect(mail.enqueue).toHaveBeenCalledTimes(1), {
        timeout: 15_000,
        interval: 100,
      });
      expect(mail.jobs[0]).toMatchObject({
        template: 'appointment-reminder',
        to: 'client.rappel@example.com',
        reference: 'MP-2026-0999',
        data: { startsAt: startsAt.toISOString(), reasonLabel: 'Devis' },
      });
      expect(prisma.appointment.updateMany).toHaveBeenCalledWith({
        where: { id: appointment.id, status: 'CONFIRME', startsAt, reminderSentAt: null },
        data: { reminderSentAt: expect.any(Date) as Date },
      });
    });
  },
);
