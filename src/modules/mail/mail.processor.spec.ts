import { UnrecoverableError, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import { describe, expect, it, vi } from 'vitest';
import type { AppConfigService } from '../../config/app-config.service.js';
import type { MailRecorder } from './mail-recorder.service.js';
import type { MailSender, MailSendResult } from './mail-sender.service.js';
import { MailProcessor } from './mail.processor.js';
import type { MailJob } from './mail.types.js';
import { MailDataError } from './render-mail.js';

function processorWith(send: MailSender['send'], worker: 'on' | 'off' = 'off') {
  const sender = { send: vi.fn(send) } as unknown as MailSender;
  const config = { get: () => worker } as unknown as AppConfigService;
  return new MailProcessor({} as Redis, 'mambo', sender, {} as MailRecorder, config);
}

const job = {
  data: { template: 'otp-code', to: 'a@example.com', lang: 'fr', data: {} },
} as unknown as Job<MailJob, MailSendResult>;

describe('MailProcessor', () => {
  it('ne démarre pas de worker quand MAIL_WORKER=off', async () => {
    const processor = processorWith(() => Promise.resolve({ status: 'skipped' }));
    const start = vi.spyOn(processor, 'start');

    processor.onApplicationBootstrap();
    await processor.onModuleDestroy();

    expect(start).not.toHaveBeenCalled();
  });

  it('transforme une erreur de données en échec définitif (pas de réessai)', async () => {
    const processor = processorWith(() => Promise.reject(new MailDataError('otp-code', ['code'])));

    await expect(processor.process(job)).rejects.toBeInstanceOf(UnrecoverableError);
  });

  it('laisse réessayer une erreur passagère (SMTP)', async () => {
    const smtp = new Error('connect ECONNREFUSED 127.0.0.1:1025');
    const processor = processorWith(() => Promise.reject(smtp));

    await expect(processor.process(job)).rejects.toBe(smtp);
  });
});
