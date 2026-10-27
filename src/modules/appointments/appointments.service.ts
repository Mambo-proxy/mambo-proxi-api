import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { Lang } from '../../common/i18n/lang.js';
import { ProblemException } from '../../common/problem/problem.js';
import { AppConfigService } from '../../config/app-config.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { TOKEN_PURPOSES, hmacDigest } from '../auth/tokens.js';
import { formatDoualaDateTime } from '../forms/forms.mapper.js';
import { reasonLabel } from './appointment-labels.js';
import { APPOINTMENT_MAIL_SELECT, AppointmentMailService, langOf } from './appointment-mail.service.js';
import { AppointmentRemindersService } from './appointment-reminders.service.js';
import {
  blockingAppointments,
  isSlotTakenError,
  lockSlots,
  slotTakenException,
} from './appointment-slots.js';
import { adminAppointmentPath } from './admin-appointments.service.js';

/** Réponse `MessageResponse` du contrat. */
export interface MessageResponse {
  message: string;
}

const ACCEPTED: Record<Lang, string> = {
  fr: 'Parfait ! Votre rendez-vous est confirmé. Vous allez recevoir une invitation par e-mail.',
  en: 'Great! Your appointment is confirmed. You will receive an invitation by e-mail.',
};

/** 410 : lien inconnu, remplacé par une nouvelle proposition, ou expiré. */
export function proposalExpiredException(): ProblemException {
  return new ProblemException({
    status: HttpStatus.GONE,
    type: 'proposal-expired',
    title: 'Proposition expirée',
    detail: 'Cette proposition a expiré ou n’est plus valable. Choisissez un nouveau créneau.',
  });
}

function closedException(): ProblemException {
  return new ProblemException({
    status: HttpStatus.CONFLICT,
    type: 'conflict',
    title: 'Conflit',
    detail: 'Ce rendez-vous a été annulé ou modifié entre-temps. Choisissez un nouveau créneau.',
  });
}

/**
 * Acceptation par le client du créneau proposé par l'agence (lien de l'e-mail `appointment-proposed`) : le
 * rendez-vous passe sur le créneau proposé, confirmé ; invitation d'agenda et rappel de la veille comme pour une
 * confirmation du back-office. Le lien reste valable pour une seconde ouverture (même réponse) tant qu'aucune autre
 * proposition ne le remplace.
 */
@Injectable()
export class AppointmentsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AppointmentMailService) private readonly mails: AppointmentMailService,
    @Inject(AppointmentRemindersService) private readonly reminders: AppointmentRemindersService,
    @Inject(AppConfigService) private readonly config: AppConfigService,
  ) {}

  /** `POST /v1/appointments/{reference}/accept-proposal` */
  async acceptProposal(reference: string, token: string, now: Date): Promise<MessageResponse> {
    const tokenHash = hmacDigest(
      this.config.get('TOKEN_SIGNING_SECRET'),
      TOKEN_PURPOSES.appointmentProposal,
      token,
    );
    const current = await this.prisma.appointment.findFirst({
      where: { reference, proposalTokenHash: tokenHash },
      select: {
        ...APPOINTMENT_MAIL_SELECT,
        status: true,
        proposedStartsAt: true,
        proposalExpiresAt: true,
        assignedToId: true,
      },
    });
    if (!current) throw proposalExpiredException();
    const lang = langOf(current.language);
    // Déjà accepté (ou confirmé par l'agence) : même réponse.
    if (current.status === 'CONFIRME' && current.proposedStartsAt === null)
      return { message: ACCEPTED[lang] };
    if (current.status !== 'AUTRE_CRENEAU_PROPOSE' || current.proposedStartsAt === null)
      throw closedException();
    if (current.proposalExpiresAt === null || current.proposalExpiresAt.getTime() <= now.getTime())
      throw proposalExpiredException();

    const startsAt = current.proposedStartsAt;
    const endsAt = new Date(startsAt.getTime() + current.endsAt.getTime() - current.startsAt.getTime());
    try {
      await this.prisma.$transaction(async (tx) => {
        await lockSlots(tx);
        const [clash] = await blockingAppointments(
          tx,
          { start: startsAt.getTime(), end: endsAt.getTime() },
          current.id,
        );
        if (clash) throw slotTakenException();
        const updated = await tx.appointment.updateMany({
          where: { id: current.id, status: 'AUTRE_CRENEAU_PROPOSE', proposalTokenHash: tokenHash },
          data: {
            status: 'CONFIRME',
            startsAt,
            endsAt,
            proposedStartsAt: null,
            proposalExpiresAt: null,
            confirmedAt: now,
            reminderSentAt: null,
            updatedAt: now,
          },
        });
        if (updated.count === 0) throw closedException();
        if (current.assignedToId !== null)
          await tx.notification.create({
            data: {
              userId: current.assignedToId,
              kind: 'APPOINTMENT',
              title: `Créneau accepté — ${reasonLabel(current.reason)}, ${formatDoualaDateTime(startsAt)} (${current.reference})`,
              link: adminAppointmentPath(current.id),
              entityType: 'Appointment',
              entityId: current.id,
              readAt: null,
              createdAt: now,
            },
            select: { id: true },
          });
      });
    } catch (error) {
      if (isSlotTakenError(error)) throw slotTakenException();
      throw error;
    }

    const row = await this.prisma.appointment.findUnique({
      where: { id: current.id },
      select: APPOINTMENT_MAIL_SELECT,
    });
    if (row) {
      await this.mails.confirmed(row, now);
      await this.reminders.schedule(row, now);
    }
    return { message: ACCEPTED[lang] };
  }
}
