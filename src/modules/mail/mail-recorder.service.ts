import { Inject, Injectable, Logger } from '@nestjs/common';
import type { RequestEventKind } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { readText } from './mail-format.js';
import type { MailJob, MailTemplateKey } from './mail.types.js';

/** Événement d'historique d'une demande pour un e-mail envoyé (contrat `RequestEvent.kind`). */
const EVENT_KINDS: Partial<Record<MailTemplateKey, RequestEventKind>> = {
  'quote-ack': 'ACK_SENT',
  'contact-ack': 'ACK_SENT',
  'appointment-received': 'ACK_SENT',
  'registration-confirmed': 'ACK_SENT',
  'application-received': 'ACK_SENT',
  'training-request-received': 'ACK_SENT',
  'partner-request-received': 'ACK_SENT',
  'event-registration': 'ACK_SENT',
  'team-new-request': 'TEAM_ALERT_SENT',
  'survey-invitation': 'SURVEY_SENT',
  'survey-reminder': 'SURVEY_REMINDED',
};

/** Une seule ligne d'historique pour ces événements (l'alerte part à plusieurs membres de l'équipe). */
const ONCE_PER_REQUEST: ReadonlySet<RequestEventKind> = new Set(['ACK_SENT', 'TEAM_ALERT_SENT']);

/** Envois sans demande associée : codes de connexion, invitations… (rien n'est enregistré). */
const NOT_RECORDED: ReadonlySet<MailTemplateKey> = new Set([
  'otp-code',
  'password-reset',
  'user-invite',
  'newsletter-confirm',
  'newsletter-campaign',
]);

/**
 * Trace des envois. Le schéma n'a pas de journal général des e-mails : on renseigne
 * - l'historique de la demande (`request_events`) quand la tâche porte une référence `MP-AAAA-NNNN` (demande, ou
 *   rendez-vous relié à sa demande) — `data` : `{ template, messageId }`, sans adresse e-mail ;
 * - l'envoi d'une campagne (`campaign_deliveries`) quand la tâche porte `data.deliveryId`.
 * Un échec d'écriture est journalisé sans faire échouer la tâche : l'e-mail est déjà parti, le réessai le
 * renverrait.
 */
@Injectable()
export class MailRecorder {
  private readonly logger = new Logger(MailRecorder.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async recordSent(job: MailJob, messageId: string | undefined): Promise<void> {
    try {
      const deliveryId = readText(job.data, 'deliveryId');
      if (deliveryId !== undefined) {
        await this.prisma.campaignDelivery.updateMany({
          where: { id: deliveryId },
          data: { status: 'SENT', messageId: messageId ?? null, sentAt: new Date(), error: null },
        });
        return;
      }
      if (job.reference === undefined || NOT_RECORDED.has(job.template)) return;
      const requestId = await this.findRequestId(job.reference);
      if (requestId === null) return;
      const kind = EVENT_KINDS[job.template] ?? 'EMAIL_SENT';
      if (ONCE_PER_REQUEST.has(kind)) {
        const existing = await this.prisma.requestEvent.findFirst({
          where: { requestId, kind },
          select: { id: true },
        });
        if (existing !== null) return;
      }
      await this.prisma.requestEvent.create({
        data: { requestId, kind, data: { template: job.template, messageId: messageId ?? null } },
      });
    } catch (error) {
      this.logger.error(
        `Envoi de « ${job.template} » non enregistré : ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** Échec définitif (après la dernière tentative) : visible dans le suivi de la campagne. */
  async recordFailure(job: MailJob, reason: string): Promise<void> {
    const deliveryId = readText(job.data, 'deliveryId');
    if (deliveryId === undefined) return;
    try {
      await this.prisma.campaignDelivery.updateMany({
        where: { id: deliveryId, status: { not: 'SENT' } },
        data: { status: 'FAILED', error: reason.slice(0, 500) },
      });
    } catch (error) {
      this.logger.error(
        `Échec de la campagne non enregistré : ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async findRequestId(reference: string): Promise<string | null> {
    const request = await this.prisma.request.findUnique({ where: { reference }, select: { id: true } });
    if (request !== null) return request.id;
    const appointment = await this.prisma.appointment.findUnique({
      where: { reference },
      select: { requestId: true },
    });
    return appointment?.requestId ?? null;
  }
}
