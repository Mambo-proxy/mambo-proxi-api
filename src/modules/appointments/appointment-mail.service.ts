import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Lang } from '../../common/i18n/lang.js';
import { AppConfigService } from '../../config/app-config.service.js';
import type { AppointmentFormat, AppointmentReason, Language } from '../../generated/prisma/client.js';
import { MailQueueService } from '../mail/mail-queue.service.js';
import type { MailJob, MailTemplateKey } from '../mail/mail.types.js';
import { formatLabel, reasonLabel } from './appointment-labels.js';
import { buildInvitation } from './ics.js';

/** Rendez-vous lu pour composer les e-mails au client. */
export interface AppointmentMailRow {
  id: string;
  reference: string;
  reason: AppointmentReason;
  format: AppointmentFormat;
  startsAt: Date;
  endsAt: Date;
  location: string | null;
  videoLink: string | null;
  language: Language;
  contact: { email: string; fullName: string; firstName: string | null; anonymizedAt: Date | null };
}

export const APPOINTMENT_MAIL_SELECT = {
  id: true,
  reference: true,
  reason: true,
  format: true,
  startsAt: true,
  endsAt: true,
  location: true,
  videoLink: true,
  language: true,
  contact: { select: { email: true, fullName: true, firstName: true, anonymizedAt: true } },
} as const;

export const langOf = (language: Language): Lang => (language === 'EN' ? 'en' : 'fr');

/** Adresse publique localisée (le site anglais est sous `/en`). */
function sitePath(webUrl: string, lang: Lang, path: string): string {
  return `${webUrl.replace(/\/$/, '')}${lang === 'en' ? '/en' : ''}${path}`;
}

/** Page de prise de rendez-vous du site (`/contact#rendez-vous`). */
export const BOOKING_PATH = '/contact#rendez-vous';
/** Page d'acceptation d'un créneau proposé (lien de l'e-mail). */
export const ACCEPT_PROPOSAL_PATH = '/rendez-vous/confirmer';

/**
 * E-mails des rendez-vous au client (modèles `appointment-*`), dans sa langue : demande reçue, confirmation (avec
 * l'invitation `.ics`), autre créneau proposé (bouton d'acceptation), annulation, rappel. Données : dates ISO
 * (affichées à l'heure de Douala par le gabarit), motif et format traduits, lieu ou lien de visio. Aucun e-mail pour
 * une fiche anonymisée. Une erreur de mise en file est journalisée (référence seulement) sans faire échouer
 * l'action.
 */
@Injectable()
export class AppointmentMailService {
  private readonly logger = new Logger(AppointmentMailService.name);

  constructor(
    @Inject(MailQueueService) private readonly mailQueue: MailQueueService,
    @Inject(AppConfigService) private readonly config: AppConfigService,
  ) {}

  /** Données communes : prénom, référence, créneau, motif et format dans la langue du client. */
  baseData(row: AppointmentMailRow, startsAt: Date = row.startsAt): Record<string, string> {
    const lang = langOf(row.language);
    const duration = row.endsAt.getTime() - row.startsAt.getTime();
    const data: Record<string, string> = {
      firstName: row.contact.firstName ?? row.contact.fullName,
      fullName: row.contact.fullName,
      reference: row.reference,
      startsAt: startsAt.toISOString(),
      endsAt: new Date(startsAt.getTime() + duration).toISOString(),
      reasonLabel: reasonLabel(row.reason, lang),
      serviceName: reasonLabel(row.reason, lang),
      formatLabel: formatLabel(row.format, lang),
    };
    if (row.format === 'AGENCE' && row.location) {
      data['place'] = row.location;
      data['location'] = row.location;
    }
    if (row.format === 'VISIO' && row.videoLink) {
      data['videoLink'] = row.videoLink;
      data['location'] = row.videoLink;
    }
    return data;
  }

  /** `appointment-received` : demande en ligne enregistrée (statut « À confirmer »). */
  received(row: AppointmentMailRow): MailJob | null {
    return this.job('appointment-received', row, this.baseData(row));
  }

  /** `appointment-confirmed` avec l'invitation d'agenda. */
  async confirmed(row: AppointmentMailRow, now: Date): Promise<void> {
    const data = this.baseData(row);
    data['ics'] = buildInvitation({
      uid: `${row.id}@mamboproxi.com`,
      sequence: Math.floor(now.getTime() / 1000),
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      stampedAt: now,
      summary: `MAMBO Proxi · ${data['reasonLabel'] ?? ''}`,
      description: [
        `${langOf(row.language) === 'en' ? 'Reference' : 'Référence'} ${row.reference}`,
        data['formatLabel'],
        data['videoLink'],
      ]
        .filter(Boolean)
        .join('\n'),
      location: data['location'] ?? null,
      url: data['videoLink'] ?? null,
      organizer: { name: 'MAMBO Proxi', email: this.organizerEmail() },
      attendee: { name: row.contact.fullName, email: row.contact.email },
    });
    await this.send(this.job('appointment-confirmed', row, data));
  }

  /** `appointment-proposed` : nouveau créneau et bouton d'acceptation (`token` en clair, une seule fois). */
  async proposed(row: AppointmentMailRow, proposedStartsAt: Date, token: string, message: string | null) {
    const lang = langOf(row.language);
    const query = new URLSearchParams({ ref: row.reference, token });
    const data = this.baseData(row, proposedStartsAt);
    data['actionUrl'] = sitePath(
      this.config.get('WEB_URL'),
      lang,
      `${ACCEPT_PROPOSAL_PATH}?${query.toString()}`,
    );
    if (message) data['message'] = message;
    await this.send(this.job('appointment-proposed', row, data));
  }

  /** `appointment-cancelled` : lien pour reprendre un rendez-vous. */
  async cancelled(row: AppointmentMailRow, message: string | null): Promise<void> {
    const data = this.baseData(row);
    data['actionUrl'] = sitePath(this.config.get('WEB_URL'), langOf(row.language), BOOKING_PATH);
    if (message) data['message'] = message;
    await this.send(this.job('appointment-cancelled', row, data));
  }

  /** `appointment-reminder` (la veille). */
  async reminder(row: AppointmentMailRow): Promise<void> {
    await this.send(this.job('appointment-reminder', row, this.baseData(row)));
  }

  async send(job: MailJob | null): Promise<void> {
    if (job === null) return;
    try {
      await this.mailQueue.enqueue(job);
    } catch (error) {
      const reason = error instanceof Error ? error.name : 'erreur inconnue';
      this.logger.error(
        `E-mail « ${job.template} » du rendez-vous ${job.reference ?? ''} non mis en file (${reason}).`,
      );
    }
  }

  private job(
    template: MailTemplateKey,
    row: AppointmentMailRow,
    data: Record<string, string>,
  ): MailJob | null {
    if (row.contact.anonymizedAt !== null) return null;
    return { template, to: row.contact.email, lang: langOf(row.language), data, reference: row.reference };
  }

  /** Adresse d'expédition (`MAIL_FROM`, « Nom <adresse> ») : organisateur de l'invitation. */
  private organizerEmail(): string {
    const from = this.config.get('MAIL_FROM');
    return (/<([^>]+)>/.exec(from)?.[1] ?? from).trim();
  }
}
