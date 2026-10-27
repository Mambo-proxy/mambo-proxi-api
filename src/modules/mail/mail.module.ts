import { Global, Module } from '@nestjs/common';
import { createTransport } from 'nodemailer';
import { AppConfigService } from '../../config/app-config.service.js';
import { QueueModule } from '../queue/queue.module.js';
import { AdminEmailTemplatesController } from './admin-email-templates.controller.js';
import { AdminEmailTemplatesService } from './admin-email-templates.service.js';
import { MailContentService } from './mail-content.service.js';
import { MailQueueService, mailQueueFactoryProvider } from './mail-queue.service.js';
import { MailRecorder } from './mail-recorder.service.js';
import { MAIL_TRANSPORT, MailSender, type MailTransport } from './mail-sender.service.js';
import { MailProcessor } from './mail.processor.js';

/** Transport SMTP de la configuration (Mailpit en local, fournisseur SMTP en production). */
function createSmtpTransport(config: AppConfigService): MailTransport {
  const user = config.get('SMTP_USER');
  const password = config.get('SMTP_PASSWORD');
  return createTransport({
    host: config.get('SMTP_HOST'),
    port: config.get('SMTP_PORT'),
    secure: config.get('SMTP_SECURE'),
    auth: user === undefined ? undefined : { user, pass: password },
    // Délais courts : une tâche bloquée est réessayée par la file plutôt que d'immobiliser le worker.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
  });
}

/**
 * E-mails : file d'attente (producteur `MailQueueService`, seul service exporté), worker d'envoi (Nodemailer +
 * gabarits React Email) et modèles du back-office (`/v1/admin/email-templates*`). Global : tout module peut
 * injecter `MailQueueService`.
 */
@Global()
@Module({
  imports: [QueueModule],
  controllers: [AdminEmailTemplatesController],
  providers: [
    AdminEmailTemplatesService,
    { provide: MAIL_TRANSPORT, inject: [AppConfigService], useFactory: createSmtpTransport },
    mailQueueFactoryProvider,
    MailQueueService,
    MailContentService,
    MailRecorder,
    MailSender,
    MailProcessor,
  ],
  // `MailContentService` : aperçu réel des campagnes de la newsletter (modèle et coordonnées en base).
  exports: [MailQueueService, MailContentService],
})
export class MailModule {}
