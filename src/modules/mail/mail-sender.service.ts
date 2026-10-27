import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import type { SendMailOptions } from 'nodemailer';
import { z } from 'zod';
import { AppConfigService } from '../../config/app-config.service.js';
import { MailContentService } from './mail-content.service.js';
import { readText, safeUrl } from './mail-format.js';
import { MailRecorder } from './mail-recorder.service.js';
import { MAIL_TEMPLATE_KEYS, type MailJob } from './mail.types.js';
import { MailDataError, renderMail } from './render-mail.js';

/** Jeton d'injection du transport Nodemailer (SMTP en fonctionnement, `jsonTransport` dans les tests). */
export const MAIL_TRANSPORT = Symbol('MAIL_TRANSPORT');

/** Ce que le service attend d'un transport Nodemailer (`Transporter`). */
export interface MailTransport {
  sendMail(options: SendMailOptions): Promise<{ messageId?: string }>;
  close?(): void;
}

export type MailSendResult = { status: 'sent'; messageId: string | undefined } | { status: 'skipped' };

/** Validation d'une tâche (elle a pu être écrite dans Redis par une autre version de l'API). */
export const mailJobSchema = z.object({
  template: z.enum(MAIL_TEMPLATE_KEYS),
  to: z.email(),
  lang: z.enum(['fr', 'en']),
  data: z.record(z.string(), z.unknown()),
  reference: z
    .string()
    .regex(/^MP-\d{4}-\d{4,}$/)
    .optional(),
  subjectPrefix: z.string().max(20).optional(),
});

/** Tâche invalide : inutile de réessayer. */
export class InvalidMailJobError extends Error {
  constructor(readonly paths: string[]) {
    super(`Tâche d'e-mail invalide (${paths.join(', ')}).`);
    this.name = 'InvalidMailJobError';
  }
}

/** Compose (modèle en base + gabarit React Email) et envoie un e-mail, puis enregistre l'envoi. */
@Injectable()
export class MailSender implements OnModuleDestroy {
  private readonly logger = new Logger(MailSender.name);

  constructor(
    @Inject(MAIL_TRANSPORT) private readonly transport: MailTransport,
    @Inject(MailContentService) private readonly content: MailContentService,
    @Inject(MailRecorder) private readonly recorder: MailRecorder,
    @Inject(AppConfigService) private readonly config: AppConfigService,
  ) {}

  async send(raw: MailJob): Promise<MailSendResult> {
    const parsed = mailJobSchema.safeParse(raw);
    if (!parsed.success) {
      throw new InvalidMailJobError(parsed.error.issues.map((issue) => issue.path.join('.') || '(racine)'));
    }
    const job: MailJob = parsed.data;

    const template = await this.content.getTemplate(job.template, job.lang);
    if (!template.enabled) {
      this.logger.log(`E-mail « ${job.template} » non envoyé : modèle désactivé.`);
      return { status: 'skipped' };
    }
    const settings = await this.content.getSettings(job.lang);
    const data = { ...job.data, reference: readText(job.data, 'reference') ?? job.reference };
    const rendered = await renderMail({
      template: job.template,
      lang: job.lang,
      data,
      content: template.content,
      context: settings.context,
    });

    const info = await this.transport.sendMail({
      from: this.sender(settings.senderName),
      to: job.to,
      replyTo: settings.replyTo,
      subject: job.subjectPrefix ? `${job.subjectPrefix} ${rendered.subject}` : rendered.subject,
      html: rendered.html,
      text: rendered.text,
      headers: this.headers(job),
      ...this.extras(job),
    });
    this.logger.log(
      `E-mail « ${job.template} » envoyé${job.reference === undefined ? '' : ` (${job.reference})`}.`,
    );
    await this.recorder.recordSent(job, info.messageId);
    return { status: 'sent', messageId: info.messageId };
  }

  onModuleDestroy(): void {
    this.transport.close?.();
  }

  /** Nom d'expéditeur des paramètres, adresse de `MAIL_FROM` (domaine authentifié SPF/DKIM). */
  private sender(senderName: string | undefined): SendMailOptions['from'] {
    const from = this.config.get('MAIL_FROM');
    if (senderName === undefined) return from;
    const address = /<([^>]+)>/.exec(from)?.[1] ?? from;
    return { name: senderName, address: address.trim() };
  }

  private headers(job: MailJob): Record<string, string> {
    const headers: Record<string, string> = { 'X-Mambo-Template': job.template };
    if (job.reference !== undefined) headers['X-Mambo-Reference'] = job.reference;
    if (job.template === 'newsletter-campaign') {
      // Désinscription en un clic (RFC 2369 et RFC 8058) : l'adresse `oneClickUnsubscribeUrl` doit accepter un POST.
      const oneClick = safeUrl(readText(job.data, 'oneClickUnsubscribeUrl'));
      const page = safeUrl(readText(job.data, 'unsubscribeUrl'));
      const target = oneClick ?? page;
      if (target !== undefined) headers['List-Unsubscribe'] = `<${target}>`;
      if (oneClick !== undefined) headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
      headers['Precedence'] = 'bulk';
    } else {
      // E-mail transactionnel (RFC 3834) : pas de réponse automatique (absence, vacances…).
      headers['Auto-Submitted'] = 'auto-generated';
    }
    return headers;
  }

  /** Invitation d'agenda jointe à la confirmation de rendez-vous (`data.ics`, contenu iCalendar). */
  private extras(job: MailJob): Partial<SendMailOptions> {
    const ics = readText(job.data, 'ics');
    if (job.template !== 'appointment-confirmed' || ics === undefined || !ics.startsWith('BEGIN:VCALENDAR')) {
      return {};
    }
    return { icalEvent: { filename: 'rendez-vous.ics', method: 'REQUEST', content: ics } };
  }
}

export function isPermanentMailError(error: unknown): boolean {
  return error instanceof MailDataError || error instanceof InvalidMailJobError;
}
