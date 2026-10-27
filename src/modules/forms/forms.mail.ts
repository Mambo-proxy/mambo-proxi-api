import type { Lang } from '../../common/i18n/lang.js';
import type {
  ContactPreference,
  ContactProfile,
  PartnershipType,
  RequestType,
} from '../../generated/prisma/client.js';
import type { MailJob, MailTemplateKey } from '../mail/mail.types.js';
import type { RequestField } from '../requests/requests.service.js';
import { districtFromCity } from '../contacts/contact.mapper.js';
import { REQUEST_TYPE_LABELS } from './forms.mapper.js';

/**
 * Données (`MailJob.data`) des e-mails envoyés après un formulaire public. Dates en ISO 8601 UTC (le gabarit les
 * affiche à l'heure de Douala, dans la langue `lang` du message). Les libellés propres à la langue (rubrique,
 * service, formation, événement) sont déjà traduits ; les codes (`profile`, `partnershipType`…) sont fournis pour
 * que le gabarit choisisse ses propres textes.
 */

/** Champs communs à tous les accusés de réception. */
export interface AcknowledgementData {
  [key: string]: unknown;
  /** Prénom du demandeur (« Bonjour Aurélie »). */
  firstName: string;
  fullName: string;
  /** Référence `MP-AAAA-NNNN`, à rappeler dans toute réponse. */
  reference: string;
  /** Date de réception (ISO 8601). */
  receivedAt: string;
}

export interface QuoteAckData extends AcknowledgementData {
  categoryName: string;
  serviceName: string | null;
  /** Date souhaitée saisie (champ `eventDate` ou `arrivalDate` du devis, `AAAA-MM-JJ`), sinon `null`. */
  desiredDate: string | null;
  /** Ville du besoin (champ `city` du devis), sinon celle du contact. */
  city: string | null;
  contactPreference: ContactPreference;
}

export interface ContactAckData extends AcknowledgementData {
  /** `CONTACT` (message) ou `INFORMATION` (demande d'information sur un service). */
  messageType: 'CONTACT' | 'INFORMATION';
  /** Objet affiché : sujet saisi, sinon service concerné, sinon libellé générique (dans la langue). */
  subjectLabel: string;
  serviceName: string | null;
}

export interface RegistrationConfirmedData extends AcknowledgementData {
  profile: ContactProfile;
  organization: string | null;
  interestNames: string[];
  /** Case newsletter cochée et abonnement en attente : un e-mail de confirmation distinct suivra. */
  newsletterPending: boolean;
}

export interface TrainingRequestReceivedData extends AcknowledgementData {
  trainingName: string;
  organization: string | null;
  participants: number;
  period: string | null;
}

export interface PartnerRequestReceivedData extends AcknowledgementData {
  partnershipType: PartnershipType;
  /** Libellé du type de partenariat dans la langue (« Prestataire Expérience »). */
  partnershipLabel: string;
  organization: string;
  activity: string;
}

export interface AppointmentReceivedData extends AcknowledgementData {
  /** Créneau demandé (ISO 8601), affiché à l'heure de Douala. */
  startsAt: string;
  endsAt: string;
  /** Motif et format dans la langue de l'envoi (« Devis », « Visio »). */
  reasonLabel: string;
  formatLabel: string;
  serviceName: string;
}

export interface EventRegistrationData extends AcknowledgementData {
  eventName: string;
  startsAt: string;
  endsAt: string | null;
  /** Lieu affiché « Ville, lieu » (« Douala, Bonanjo »). */
  place: string;
  city: string;
  seats: number;
}

/** Alerte de l'équipe (`team-new-request`), toujours en français. */
export interface TeamNewRequestData {
  [key: string]: unknown;
  reference: string;
  requestType: RequestType;
  /** « Demande de devis », « Inscription à un événement »… */
  requestTypeLabel: string;
  subject: string;
  /** Service ou rubrique concernés (devis, information), sinon `null`. */
  serviceName: string | null;
  fullName: string;
  email: string;
  phone: string | null;
  country: string | null;
  city: string | null;
  /** Quartier déduit de « Quartier, Ville », sinon `null`. */
  quarterName: string | null;
  /** Identifiant de la demande (lien du back-office). */
  requestId: string;
  /** Informations saisies (libellé + valeur formatée), comme dans le détail du back-office. */
  fields: RequestField[];
  message: string | null;
  receivedAt: string;
  /** Échéance de traitement (réception + 24 h). */
  dueAt: string;
  /** Lien direct vers la demande dans le back-office. */
  adminUrl: string;
}

export interface AcknowledgementMail {
  template: Extract<
    MailTemplateKey,
    | 'quote-ack'
    | 'contact-ack'
    | 'registration-confirmed'
    | 'training-request-received'
    | 'partner-request-received'
    | 'event-registration'
    | 'appointment-received'
  >;
  to: string;
  lang: Lang;
  data: AcknowledgementData;
}

export interface TeamAlert {
  requestId: string;
  type: RequestType;
  subject: string;
  serviceName: string | null;
  contact: {
    fullName: string;
    email: string;
    phone: string | null;
    country: string | null;
    city: string | null;
  };
  fields: RequestField[];
  message: string | null;
  receivedAt: Date;
  dueAt: Date;
  adminUrl: string;
}

export function teamNewRequestData(reference: string, alert: TeamAlert): TeamNewRequestData {
  return {
    reference,
    requestType: alert.type,
    requestTypeLabel: REQUEST_TYPE_LABELS[alert.type],
    subject: alert.subject,
    serviceName: alert.serviceName,
    fullName: alert.contact.fullName,
    email: alert.contact.email,
    phone: alert.contact.phone,
    country: alert.contact.country,
    city: alert.contact.city,
    quarterName: districtFromCity(alert.contact.city),
    requestId: alert.requestId,
    fields: alert.fields,
    message: alert.message,
    receivedAt: alert.receivedAt.toISOString(),
    dueAt: alert.dueAt.toISOString(),
    adminUrl: alert.adminUrl,
  };
}

/** Accusé de réception au demandeur, puis une alerte par destinataire de l'équipe. */
export function submissionMailJobs(
  reference: string,
  acknowledgement: AcknowledgementMail,
  alert: TeamAlert,
  recipients: readonly string[],
): MailJob[] {
  const team = teamNewRequestData(reference, alert);
  return [
    {
      template: acknowledgement.template,
      to: acknowledgement.to,
      lang: acknowledgement.lang,
      data: acknowledgement.data,
      reference,
    },
    ...recipients.map((to): MailJob => ({
      template: 'team-new-request',
      to,
      lang: 'fr',
      data: team,
      reference,
    })),
  ];
}
