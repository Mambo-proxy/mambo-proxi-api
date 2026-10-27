import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { AntiSpamService } from '../../common/anti-spam/anti-spam.service.js';
import type { AntiSpamInput } from '../../common/anti-spam/anti-spam.schema.js';
import type { Lang } from '../../common/i18n/lang.js';
import { translationFor } from '../../common/i18n/translations.js';
import { ProblemException, type ProblemFieldError } from '../../common/problem/problem.js';
import { validationException } from '../../common/validation/validation-exception.js';
import { AppConfigService } from '../../config/app-config.service.js';
import type { Language, NotificationKind, Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { adminAppointmentPath } from '../appointments/admin-appointments.service.js';
import { formatLabel, reasonLabel } from '../appointments/appointment-labels.js';
import { isSlotTakenError, lockSlots, slotTakenException } from '../appointments/appointment-slots.js';
import type { AppointmentInput } from '../appointments/appointment.schemas.js';
import { AvailabilityService } from '../appointments/availability.service.js';
import { publishedServiceWhere } from '../catalog/catalog.selects.js';
import { shortName, type ContactSubmission } from '../contacts/contact.mapper.js';
import { ContactsService, type SavedContact } from '../contacts/contacts.service.js';
import { adminApplicationPath, visibleJobWhere } from '../jobs/job.mapper.js';
import type { JobApplicationInput } from '../jobs/job.schemas.js';
import { MailQueueService } from '../mail/mail-queue.service.js';
import { NewsletterSubscriptionsService } from '../newsletter/newsletter-subscriptions.service.js';
import { decoyReference } from '../requests/reference.js';
import {
  RequestsService,
  adminRequestPath,
  type CreatedRequest,
  type ReceivedRequestDraft,
  type RequestField,
} from '../requests/requests.service.js';
import { SETTING_KEYS } from '../settings/settings.constants.js';
import { StorageService } from '../storage/storage.service.js';
import {
  submissionMailJobs,
  type AcknowledgementMail,
  type ApplicationReceivedData,
  type AppointmentReceivedData,
  type ContactAckData,
  type EventRegistrationData,
  type PartnerRequestReceivedData,
  type QuoteAckData,
  type RegistrationConfirmedData,
  type TeamAlert,
  type TrainingRequestReceivedData,
} from './forms.mail.js';
import {
  PARTNERSHIP_TYPE_LABELS,
  acceptedMessage,
  defaultContactSubject,
  formatDoualaDateTime,
  interestNames,
  missingRequiredNeeds,
  needText,
  partnershipLabel,
  pushField,
  quoteRequestFields,
  readQuoteFields,
  resolveLang,
  teamRecipients,
  type SubmissionKind,
} from './forms.mapper.js';
import {
  OTHER_TRAINING_SLUG,
  type ContactMessageInput,
  type EventRegistrationInput,
  type PartnerRequestInput,
  type QuoteRequestInput,
  type RegistrationInput,
  type TrainingRequestInput,
} from './forms.schemas.js';

/** Réponse `SubmissionAccepted` du contrat. */
export interface SubmissionAccepted {
  reference: string;
  message: string;
}

/** Informations techniques de l'envoi (preuve du consentement, langue par défaut). */
export interface SubmissionMeta {
  ip?: string;
  userAgent?: string;
  acceptLanguage?: string;
}

export const CATEGORY_UNKNOWN = "Cette rubrique n'existe pas ou n'est plus disponible.";
export const SERVICE_UNKNOWN = "Ce service n'existe pas ou n'est plus disponible.";
export const TRAINING_UNKNOWN = "Cette formation n'existe pas ou n'est plus proposée.";
export const EVENT_UNKNOWN = "Cet événement n'existe pas ou n'est plus disponible.";
export const EVENT_CLOSED = 'Les inscriptions à cet événement sont closes.';
export const JOB_UNAVAILABLE =
  'Cette offre n’est plus disponible. Choisissez un autre poste ou une candidature spontanée.';

/** 409 `event-full` de `POST /v1/event-registrations`. */
export function eventFullException(): ProblemException {
  return new ProblemException({
    status: HttpStatus.CONFLICT,
    type: 'event-full',
    title: 'Complet',
    detail: 'Il ne reste plus assez de places pour cet événement.',
  });
}

const PUBLISHED = 'PUBLISHED' as const;
const MAX_USER_AGENT_LENGTH = 500;

function fieldError(path: string, message: string): ProblemFieldError {
  return { path, code: 'not_found', message };
}

/** Libellé traduit d'une colonne `translations` (`{ en: { name } }`), sinon le français. */
function localizedText(french: string, translations: unknown, field: string, lang: Lang): string {
  const value = translationFor(translations, lang)?.[field];
  return typeof value === 'string' && value.trim() !== '' ? value : french;
}

function toLanguage(lang: Lang): Language {
  return lang === 'en' ? 'EN' : 'FR';
}

/** Ce qu'un formulaire enregistre dans la transaction, et ce qu'il envoie ensuite. */
interface Submission {
  contact: ContactSubmission;
  /** Service (ou rubrique) concerné, pour l'alerte de l'équipe. */
  serviceName?: string | null;
  draft: Omit<ReceivedRequestDraft, 'contactId' | 'language' | 'consentAt' | 'ip' | 'userAgent'>;
  notification: { kind: NotificationKind; title: string };
  /** Accusé de réception (sans la référence, connue après l'enregistrement). */
  acknowledgement: (
    contact: SavedContact,
    request: CreatedRequest,
    extra: TransactionExtra,
  ) => Omit<AcknowledgementMail, 'to' | 'lang'>;
  /** Écritures propres au formulaire, dans la même transaction (places, centres d'intérêt, newsletter). */
  before?: (tx: Prisma.TransactionClient) => Promise<void>;
  after?: (tx: Prisma.TransactionClient, contact: SavedContact) => Promise<TransactionExtra>;
  /** Après l'enregistrement et les e-mails (confirmation de la newsletter) ; ne doit pas échouer. */
  afterCommit?: (contact: SavedContact, extra: TransactionExtra) => Promise<void>;
  /** Écritures qui dépendent de la demande créée (rendez-vous relié à sa demande). */
  afterRequest?: (
    tx: Prisma.TransactionClient,
    contact: SavedContact,
    request: CreatedRequest,
  ) => Promise<TransactionExtra>;
}

interface TransactionExtra {
  newsletterPending?: boolean;
  /** Lien du back-office de l'alerte de l'équipe (par défaut : la demande). */
  adminPath?: string;
}

export const SLOT_UNAVAILABLE =
  'Ce créneau n’est pas proposé. Choisissez un horaire parmi les créneaux disponibles.';

/**
 * Formulaires publics : anti-spam, contrôle des références (rubrique, service, formation, événement), puis, dans une
 * transaction, fiche contact, demande (`MP-AAAA-NNNN`, statut `NOUVELLE`, échéance + 24 h), historique « reçue » et
 * notifications de l'équipe. Les e-mails (accusé de réception, alerte de l'équipe) sont mis en file après
 * l'enregistrement ; leur échec ne fait pas échouer l'envoi.
 */
@Injectable()
export class FormsService {
  private readonly logger = new Logger(FormsService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AntiSpamService) private readonly antiSpam: AntiSpamService,
    @Inject(ContactsService) private readonly contacts: ContactsService,
    @Inject(RequestsService) private readonly requests: RequestsService,
    @Inject(MailQueueService) private readonly mailQueue: MailQueueService,
    @Inject(AppConfigService) private readonly config: AppConfigService,
    @Inject(AvailabilityService) private readonly availability: AvailabilityService,
    @Inject(StorageService) private readonly storage: StorageService,
    @Inject(NewsletterSubscriptionsService) private readonly newsletter: NewsletterSubscriptionsService,
  ) {}

  /** `POST /v1/quote-requests`. */
  async createQuoteRequest(input: QuoteRequestInput, meta: SubmissionMeta): Promise<SubmissionAccepted> {
    const lang = resolveLang(input.lang, meta.acceptLanguage);
    const now = new Date();
    if (await this.isTrapped(input.antiSpam, meta, now)) return this.decoy('quote', lang, now);

    const errors: ProblemFieldError[] = [];
    const category = await this.prisma.category.findFirst({
      where: { slug: input.categorySlug, status: PUBLISHED },
      select: { id: true, name: true, translations: true, quoteFields: true },
    });
    if (!category) throw validationException([fieldError('categorySlug', CATEGORY_UNKNOWN)]);
    const service = input.serviceSlug
      ? await this.prisma.service.findFirst({
          where: { slug: input.serviceSlug, categoryId: category.id, ...publishedServiceWhere(now) },
          select: { id: true, name: true, translations: true },
        })
      : null;
    if (input.serviceSlug && !service) errors.push(fieldError('serviceSlug', SERVICE_UNKNOWN));
    const definitions = readQuoteFields(category.quoteFields);
    errors.push(...missingRequiredNeeds(definitions, input.needs));
    if (errors.length > 0) throw validationException(errors);

    const subject = service?.name ?? category.name;
    const fields = quoteRequestFields(
      category.name,
      service?.name ?? null,
      definitions,
      input.needs,
      input.contactPreference,
    );
    return this.submit('quote', lang, now, meta, {
      serviceName: subject,
      contact: {
        ...input.contact,
        preferredChannel: input.contactPreference,
        source: 'devis',
        language: toLanguage(lang),
      },
      draft: {
        type: 'DEVIS',
        categoryId: category.id,
        serviceId: service?.id ?? null,
        contactPreference: input.contactPreference,
        subject,
        payload: {
          categorySlug: input.categorySlug,
          serviceSlug: input.serviceSlug,
          needs: input.needs,
          fields: toJsonFields(fields),
        },
        message: input.description,
      },
      notification: { kind: 'REQUEST', title: `Nouvelle demande de devis — ${subject}` },
      acknowledgement: (contact, request) => ({
        template: 'quote-ack',
        data: {
          ...acknowledgementBase(contact, request),
          categoryName: localizedText(category.name, category.translations, 'name', lang),
          serviceName: service ? localizedText(service.name, service.translations, 'name', lang) : null,
          desiredDate: needText(input.needs, 'eventDate', 'arrivalDate'),
          city: needText(input.needs, 'city') ?? input.contact.city,
          contactPreference: input.contactPreference,
        } satisfies QuoteAckData,
      }),
    });
  }

  /** `POST /v1/contact-messages`. */
  async createContactMessage(input: ContactMessageInput, meta: SubmissionMeta): Promise<SubmissionAccepted> {
    const lang = resolveLang(input.lang, meta.acceptLanguage);
    const now = new Date();
    if (await this.isTrapped(input.antiSpam, meta, now)) return this.decoy('contact', lang, now);

    const service = input.serviceSlug
      ? await this.prisma.service.findFirst({
          where: { slug: input.serviceSlug, ...publishedServiceWhere(now), category: { status: PUBLISHED } },
          select: { id: true, name: true, translations: true, categoryId: true },
        })
      : null;
    if (input.serviceSlug && !service)
      throw validationException([fieldError('serviceSlug', SERVICE_UNKNOWN)]);

    const type = input.type;
    const subject =
      input.subject ??
      (service ? service.name : type === 'INFORMATION' ? "Demande d'information" : 'Message');
    const fields: RequestField[] = [];
    pushField(fields, 'sujet', 'Sujet', input.subject);
    pushField(fields, 'service', 'Service', service?.name ?? null);
    pushField(fields, 'ville', 'Ville', input.contact.city);
    return this.submit('contact', lang, now, meta, {
      serviceName: service?.name ?? null,
      contact: { ...input.contact, source: 'contact', language: toLanguage(lang) },
      draft: {
        type,
        categoryId: service?.categoryId ?? null,
        serviceId: service?.id ?? null,
        subject,
        payload: { serviceSlug: input.serviceSlug, fields: toJsonFields(fields) },
        message: input.message,
      },
      notification: {
        kind: 'REQUEST',
        title:
          type === 'INFORMATION'
            ? `Nouvelle demande d'information — ${subject}`
            : `Nouveau message de contact — ${subject}`,
      },
      acknowledgement: (contact, request) => ({
        template: 'contact-ack',
        data: {
          ...acknowledgementBase(contact, request),
          messageType: type,
          subjectLabel:
            input.subject ??
            (service ? localizedText(service.name, service.translations, 'name', lang) : null) ??
            defaultContactSubject(type, lang),
          serviceName: service ? localizedText(service.name, service.translations, 'name', lang) : null,
        } satisfies ContactAckData,
      }),
    });
  }

  /** `POST /v1/registrations`. */
  async createRegistration(input: RegistrationInput, meta: SubmissionMeta): Promise<SubmissionAccepted> {
    const lang = resolveLang(input.lang, meta.acceptLanguage);
    const now = new Date();
    if (await this.isTrapped(input.antiSpam, meta, now)) return this.decoy('registration', lang, now);

    const categories =
      input.interests.length > 0
        ? await this.prisma.category.findMany({
            where: { slug: { in: input.interests }, status: PUBLISHED },
            select: { id: true, slug: true, name: true, translations: true },
          })
        : [];
    const bySlug = new Map(categories.map((category) => [category.slug, category]));
    const unknown = input.interests
      .map((slug, index) =>
        bySlug.has(slug) ? null : fieldError(`interests.${String(index)}`, CATEGORY_UNKNOWN),
      )
      .filter((error): error is ProblemFieldError => error !== null);
    if (unknown.length > 0) throw validationException(unknown);

    const professional = input.profile === 'PROFESSIONNEL';
    const fullName = `${input.firstName} ${input.lastName}`;
    const frenchInterests = interestNames(input.interests, new Map(categories.map((c) => [c.slug, c.name])));
    const localizedInterests = interestNames(
      input.interests,
      new Map(categories.map((c) => [c.slug, localizedText(c.name, c.translations, 'name', lang)])),
    );
    const fields: RequestField[] = [];
    pushField(fields, 'profil', 'Profil', professional ? 'Professionnel / partenaire' : 'Particulier');
    pushField(fields, 'structure', 'Structure', input.organization);
    pushField(fields, 'activite', 'Activité', input.activity);
    pushField(fields, 'ville', 'Ville', input.city);
    pushField(fields, 'interets', "Rubriques d'intérêt", frenchInterests.join(', '));
    pushField(fields, 'newsletter', 'Newsletter', input.newsletter ? 'Oui (confirmation en attente)' : 'Non');
    const subject = professional
      ? `Inscription professionnel — ${input.organization ?? fullName}`
      : 'Inscription particulier';

    return this.submit('registration', lang, now, meta, {
      contact: {
        email: input.email,
        fullName,
        firstName: input.firstName,
        lastName: input.lastName,
        phone: input.phone,
        country: input.country,
        city: input.city,
        profile: input.profile,
        organization: input.organization,
        activity: input.activity,
        source: 'inscription',
        language: toLanguage(lang),
      },
      draft: {
        type: 'INSCRIPTION',
        organization: input.organization,
        subject,
        payload: {
          profile: input.profile,
          interests: input.interests,
          newsletter: input.newsletter,
          fields: toJsonFields(fields),
        },
      },
      notification: {
        kind: 'REGISTRATION',
        title: `Nouvelle inscription ${professional ? 'professionnel' : 'particulier'} — ${shortName(fullName, { firstName: input.firstName, lastName: input.lastName })}`,
      },
      after: async (tx, contact) => {
        await this.contacts.replaceInterests(
          tx,
          contact.id,
          categories.map((category) => category.id),
        );
        if (!input.newsletter) return { newsletterPending: false };
        const status = await this.contacts.prepareNewsletter(
          tx,
          contact.id,
          {
            email: contact.email,
            fullName,
            phone: input.phone,
            country: input.country,
            source: 'INSCRIPTION',
            language: toLanguage(lang),
          },
          now,
        );
        return { newsletterPending: status === 'EN_ATTENTE' };
      },
      // Double opt-in : lien de confirmation envoyé par le module de la newsletter.
      afterCommit: async (contact, extra) => {
        if (extra.newsletterPending === true)
          await this.newsletter.sendPendingConfirmation(contact.email, now);
      },
      acknowledgement: (contact, request, extra) => ({
        template: 'registration-confirmed',
        data: {
          ...acknowledgementBase(contact, request),
          profile: input.profile,
          organization: input.organization,
          interestNames: localizedInterests,
          newsletterPending: extra.newsletterPending === true,
        } satisfies RegistrationConfirmedData,
      }),
    });
  }

  /** `POST /v1/training-requests`. */
  async createTrainingRequest(
    input: TrainingRequestInput,
    meta: SubmissionMeta,
  ): Promise<SubmissionAccepted> {
    const lang = resolveLang(input.lang, meta.acceptLanguage);
    const now = new Date();
    if (await this.isTrapped(input.antiSpam, meta, now)) return this.decoy('training', lang, now);

    const other = input.trainingSlug === OTHER_TRAINING_SLUG;
    const training = other
      ? null
      : await this.prisma.training.findFirst({
          where: { slug: input.trainingSlug, status: PUBLISHED },
          select: { id: true, title: true, translations: true },
        });
    if (!other && !training) throw validationException([fieldError('trainingSlug', TRAINING_UNKNOWN)]);

    const title = training?.title ?? input.otherTraining ?? '';
    const fields: RequestField[] = [];
    pushField(fields, 'formation.souhaitee', 'Formation souhaitée', title);
    pushField(fields, 'structure', 'Structure', input.organization);
    pushField(fields, 'participants', 'Participants', input.participants);
    pushField(fields, 'periode.souhaitee', 'Période souhaitée', input.period);
    return this.submit('training', lang, now, meta, {
      contact: {
        ...input.contact,
        organization: input.organization,
        source: 'formation',
        language: toLanguage(lang),
      },
      draft: {
        type: 'FORMATION',
        trainingId: training?.id ?? null,
        otherTraining: other ? input.otherTraining : null,
        participants: input.participants,
        period: input.period,
        organization: input.organization,
        subject: title,
        payload: {
          trainingSlug: input.trainingSlug,
          otherTraining: input.otherTraining,
          organization: input.organization,
          participants: input.participants,
          period: input.period,
          fields: toJsonFields(fields),
        },
        message: input.message,
      },
      notification: { kind: 'REQUEST', title: `Nouvelle demande de formation — ${title}` },
      acknowledgement: (contact, request) => ({
        template: 'training-request-received',
        data: {
          ...acknowledgementBase(contact, request),
          trainingName: training
            ? localizedText(training.title, training.translations, 'title', lang)
            : title,
          organization: input.organization,
          participants: input.participants,
          period: input.period,
        } satisfies TrainingRequestReceivedData,
      }),
    });
  }

  /** `POST /v1/partner-requests`. */
  async createPartnerRequest(input: PartnerRequestInput, meta: SubmissionMeta): Promise<SubmissionAccepted> {
    const lang = resolveLang(input.lang, meta.acceptLanguage);
    const now = new Date();
    if (await this.isTrapped(input.antiSpam, meta, now)) return this.decoy('partner', lang, now);

    const fields: RequestField[] = [];
    pushField(
      fields,
      'type.de.partenariat',
      'Type de partenariat',
      PARTNERSHIP_TYPE_LABELS[input.partnershipType],
    );
    pushField(fields, 'structure', 'Structure', input.organization);
    pushField(fields, 'activite', 'Activité', input.activity);
    pushField(fields, 'ville', 'Ville', input.contact.city);
    return this.submit('partner', lang, now, meta, {
      contact: {
        ...input.contact,
        profile: 'PROFESSIONNEL',
        organization: input.organization,
        activity: input.activity,
        source: 'partenariat',
        language: toLanguage(lang),
      },
      draft: {
        type: 'PARTENARIAT',
        partnershipType: input.partnershipType,
        organization: input.organization,
        subject: input.organization,
        payload: {
          partnershipType: input.partnershipType,
          organization: input.organization,
          activity: input.activity,
          fields: toJsonFields(fields),
        },
        message: input.presentation,
      },
      notification: { kind: 'PARTNERSHIP', title: `Nouvelle demande de partenariat — ${input.organization}` },
      acknowledgement: (contact, request) => ({
        template: 'partner-request-received',
        data: {
          ...acknowledgementBase(contact, request),
          partnershipType: input.partnershipType,
          partnershipLabel: partnershipLabel(input.partnershipType, lang),
          organization: input.organization,
          activity: input.activity,
        } satisfies PartnerRequestReceivedData,
      }),
    });
  }

  /** `POST /v1/event-registrations` : 409 `event-full` s'il ne reste pas assez de places. */
  async createEventRegistration(
    input: EventRegistrationInput,
    meta: SubmissionMeta,
  ): Promise<SubmissionAccepted> {
    const lang = resolveLang(input.lang, meta.acceptLanguage);
    const now = new Date();
    if (await this.isTrapped(input.antiSpam, meta, now)) return this.decoy('event', lang, now);

    const event = await this.prisma.event.findFirst({
      where: {
        slug: input.eventSlug,
        status: PUBLISHED,
        OR: [{ publishedAt: null }, { publishedAt: { lte: now } }],
      },
      select: {
        id: true,
        title: true,
        startsAt: true,
        endsAt: true,
        city: true,
        place: true,
        capacity: true,
        translations: true,
      },
    });
    if (!event) throw validationException([fieldError('eventSlug', EVENT_UNKNOWN)]);
    if ((event.endsAt ?? event.startsAt).getTime() < now.getTime()) {
      throw validationException([{ path: 'eventSlug', code: 'closed', message: EVENT_CLOSED }]);
    }

    const seatsLabel = `${String(input.seats)} ${input.seats > 1 ? 'personnes' : 'personne'}`;
    const fields: RequestField[] = [];
    pushField(fields, 'evenement', 'Événement', event.title);
    pushField(fields, 'date', 'Date', formatDoualaDateTime(event.startsAt));
    pushField(fields, 'lieu', 'Lieu', [event.place, event.city].filter(Boolean).join(', '));
    pushField(fields, 'places', 'Places', input.seats);
    return this.submit('event', lang, now, meta, {
      contact: { ...input.contact, source: 'evenement', language: toLanguage(lang) },
      draft: {
        type: 'EVENEMENT',
        eventId: event.id,
        seats: input.seats,
        subject: event.title,
        payload: { eventSlug: input.eventSlug, seats: input.seats, fields: toJsonFields(fields) },
        message: `Inscription pour ${seatsLabel}.`,
      },
      notification: { kind: 'REQUEST', title: `Nouvelle inscription à un événement — ${event.title}` },
      // Places restantes vérifiées sous verrou de la ligne de l'événement : deux inscriptions simultanées ne peuvent
      // pas dépasser la jauge.
      before: async (tx) => {
        if (event.capacity === null) return;
        await tx.$queryRaw`SELECT id FROM events WHERE id = ${event.id} FOR UPDATE`;
        const taken = await tx.request.aggregate({
          where: { eventId: event.id, type: 'EVENEMENT' },
          _sum: { seats: true },
        });
        if (input.seats > event.capacity - (taken._sum.seats ?? 0)) throw eventFullException();
      },
      acknowledgement: (contact, request) => ({
        template: 'event-registration',
        data: {
          ...acknowledgementBase(contact, request),
          eventName: localizedText(event.title, event.translations, 'title', lang),
          startsAt: event.startsAt.toISOString(),
          endsAt: event.endsAt?.toISOString() ?? null,
          place: [event.city, localizedNullable(event.place, event.translations, 'place', lang)]
            .filter(Boolean)
            .join(', '),
          city: event.city,
          seats: input.seats,
        } satisfies EventRegistrationData,
      }),
    });
  }

  /**
   * `POST /v1/appointments` : demande de rendez-vous (statut « À confirmer »), reliée à une demande `RENDEZ_VOUS`
   * de même référence. Le créneau doit être l'un de ceux proposés par `GET /v1/appointments/availability` pour ce
   * format (sinon 422 sur `startsAt`) et encore libre : vérifié sous le verrou des créneaux, dans la transaction de
   * l'enregistrement (pris entre-temps → 409 `slot-taken`, comme une violation de l'index unique du créneau).
   */
  async createAppointment(input: AppointmentInput, meta: SubmissionMeta): Promise<SubmissionAccepted> {
    const lang = resolveLang(input.lang, meta.acceptLanguage);
    const now = new Date();
    if (await this.isTrapped(input.antiSpam, meta, now)) return this.decoy('appointment', lang, now);

    const startsAt = new Date(input.startsAt);
    const reason = reasonLabel(input.reason);
    const when = formatDoualaDateTime(startsAt);
    let endsAt = startsAt;
    const fields: RequestField[] = [];
    pushField(fields, 'motif', 'Motif', reason);
    pushField(fields, 'format', 'Format', formatLabel(input.format));
    pushField(fields, 'creneau', 'Créneau', when);
    pushField(fields, 'ville', 'Ville', input.contact.city);
    try {
      return await this.submit('appointment', lang, now, meta, {
        serviceName: `Rendez-vous — ${reason}`,
        contact: { ...input.contact, source: 'rendez-vous', language: toLanguage(lang) },
        draft: {
          type: 'RENDEZ_VOUS',
          subject: `Rendez-vous — ${reason}`,
          payload: {
            reason: input.reason,
            format: input.format,
            startsAt: startsAt.toISOString(),
            fields: toJsonFields(fields),
          },
          message: input.message,
        },
        notification: { kind: 'APPOINTMENT', title: `Nouvelle demande de rendez-vous — ${reason}, ${when}` },
        before: async (tx) => {
          await lockSlots(tx);
          const found = await this.availability.lookup(tx, startsAt, input.format, now);
          if (found.status === 'taken') throw slotTakenException();
          if (found.status === 'invalid')
            throw validationException([{ path: 'startsAt', code: 'unavailable', message: SLOT_UNAVAILABLE }]);
          endsAt = new Date(found.slot.endsAt);
        },
        afterRequest: async (tx, contact, request) => {
          const appointment = await tx.appointment.create({
            data: {
              reference: request.reference,
              requestId: request.id,
              contactId: contact.id,
              reason: input.reason,
              format: input.format,
              startsAt,
              endsAt,
              status: 'A_CONFIRMER',
              proposedStartsAt: null,
              proposalTokenHash: null,
              proposalExpiresAt: null,
              location: null,
              videoLink: null,
              message: input.message,
              notes: null,
              language: toLanguage(lang),
              assignedToId: null,
              createdById: null,
              confirmedAt: null,
              cancelledAt: null,
              completedAt: null,
              reminderSentAt: null,
              isDemo: false,
              createdAt: now,
              updatedAt: now,
            },
            select: { id: true },
          });
          // Notifications de l'équipe : vers le rendez-vous plutôt que vers la demande.
          const adminPath = adminAppointmentPath(appointment.id);
          await tx.notification.updateMany({
            where: { entityType: 'Request', entityId: request.id },
            data: { link: adminPath, entityType: 'Appointment', entityId: appointment.id },
          });
          return { adminPath };
        },
        acknowledgement: (contact, request) => ({
          template: 'appointment-received',
          data: {
            ...acknowledgementBase(contact, request),
            startsAt: startsAt.toISOString(),
            endsAt: endsAt.toISOString(),
            reasonLabel: reasonLabel(input.reason, lang),
            formatLabel: formatLabel(input.format, lang),
            serviceName: reasonLabel(input.reason, lang),
          } satisfies AppointmentReceivedData,
        }),
      });
    } catch (error) {
      if (isSlotTakenError(error)) throw slotTakenException();
      throw error;
    }
  }

  /**
   * `POST /v1/job-applications` : candidature à une offre publiée et non expirée (`jobSlug`, sinon 422) ou
   * spontanée. Le CV est contrôlé (5 Mo → 413, type réel PDF/DOC/DOCX → 415) puis enregistré sous une clé aléatoire
   * avant la transaction ; il est supprimé si l'enregistrement échoue. Demande `CANDIDATURE`, pièce jointe `CV` et
   * candidature `NOUVEAU` sont créées ensemble ; l'équipe est notifiée vers l'écran Recrutement.
   */
  async createJobApplication(input: JobApplicationInput, meta: SubmissionMeta): Promise<SubmissionAccepted> {
    const lang = resolveLang(input.lang, meta.acceptLanguage);
    const now = new Date();
    if (await this.isTrapped(input.antiSpam, meta, now)) return this.decoy('application', lang, now);

    const job = input.jobSlug
      ? await this.prisma.jobOffer.findFirst({
          where: { AND: [{ slug: input.jobSlug }, visibleJobWhere(now)] },
          select: { id: true, slug: true, title: true, translations: true },
        })
      : null;
    if (input.jobSlug && !job)
      throw validationException([{ path: 'jobSlug', code: 'unavailable', message: JOB_UNAVAILABLE }]);

    const stored = await this.storage.storeDocument(input.cv, 'cv', now);
    const spontaneous = lang === 'en' ? 'Unsolicited application' : 'Candidature spontanée';
    const subject = job?.title ?? 'Candidature spontanée';
    const fields: RequestField[] = [];
    pushField(fields, 'poste', 'Poste visé', subject);
    pushField(fields, 'ville', 'Ville', input.city);
    pushField(fields, 'cv', 'CV', stored.fileName);
    try {
      return await this.submit('application', lang, now, meta, {
        serviceName: subject,
        contact: {
          fullName: input.fullName,
          email: input.email,
          phone: input.phone,
          city: input.city,
          source: 'candidature',
          language: toLanguage(lang),
        },
        draft: {
          type: 'CANDIDATURE',
          jobOfferId: job?.id ?? null,
          subject,
          payload: { jobSlug: job?.slug ?? null, fields: toJsonFields(fields) },
          message: input.message,
        },
        notification: { kind: 'APPLICATION', title: `Nouvelle candidature — ${subject}` },
        afterRequest: async (tx, _contact, request) => {
          const attachment = await tx.attachment.create({
            data: {
              requestId: request.id,
              kind: 'CV',
              storageKey: stored.storageKey,
              fileName: stored.fileName,
              mimeType: stored.mimeType,
              size: stored.size,
              checksum: stored.checksum,
              scanStatus: stored.scanStatus,
              createdAt: now,
            },
            select: { id: true },
          });
          const application = await tx.jobApplication.create({
            data: {
              requestId: request.id,
              jobOfferId: job?.id ?? null,
              status: 'NOUVEAU',
              cvAttachmentId: attachment.id,
              notes: null,
              readAt: null,
              createdAt: now,
              updatedAt: now,
            },
            select: { id: true },
          });
          const adminPath = adminApplicationPath(application.id);
          await tx.notification.updateMany({
            where: { entityType: 'Request', entityId: request.id },
            data: { link: adminPath, entityType: 'JobApplication', entityId: application.id },
          });
          return { adminPath };
        },
        acknowledgement: (contact, request) => ({
          template: 'application-received',
          data: {
            ...acknowledgementBase(contact, request),
            jobTitle: job ? localizedText(job.title, job.translations, 'title', lang) : spontaneous,
            jobSlug: job?.slug ?? null,
          } satisfies ApplicationReceivedData,
        }),
      });
    } catch (error) {
      await this.storage.deleteQuietly([stored.storageKey]);
      throw error;
    }
  }

  /** Champ piège rempli → succès factice ; délai trop court ou jeton refusé → 400 (levé par `AntiSpamService`). */
  private async isTrapped(antiSpam: AntiSpamInput, meta: SubmissionMeta, now: Date): Promise<boolean> {
    return (await this.antiSpam.check(antiSpam, meta.ip, now)) === 'trapped';
  }

  private decoy(kind: SubmissionKind, lang: Lang, now: Date): SubmissionAccepted {
    this.logger.log(`Envoi ignoré (champ piège rempli) : formulaire « ${kind} ».`);
    return { reference: decoyReference(now), message: acceptedMessage(kind, lang) };
  }

  /** Enregistrement transactionnel puis mise en file des e-mails. */
  private async submit(
    kind: SubmissionKind,
    lang: Lang,
    now: Date,
    meta: SubmissionMeta,
    submission: Submission,
  ): Promise<SubmissionAccepted> {
    const { contact, request, extra } = await this.prisma.$transaction(async (tx) => {
      await submission.before?.(tx);
      const saved = await this.contacts.upsert(tx, submission.contact, now);
      const extraValues = (await submission.after?.(tx, saved)) ?? {};
      const created = await this.requests.createReceived(
        tx,
        {
          ...submission.draft,
          contactId: saved.id,
          language: toLanguage(lang),
          consentAt: now,
          ip: meta.ip ?? null,
          userAgent: meta.userAgent?.slice(0, MAX_USER_AGENT_LENGTH) ?? null,
        },
        submission.notification,
        now,
      );
      const late = (await submission.afterRequest?.(tx, saved, created)) ?? {};
      return { contact: saved, request: created, extra: { ...extraValues, ...late } };
    });

    const acknowledgement = submission.acknowledgement(contact, request, extra);
    await this.enqueueMails(
      request.reference,
      { ...acknowledgement, to: contact.email, lang },
      {
        requestId: request.id,
        type: submission.draft.type,
        subject: submission.draft.subject,
        serviceName: submission.serviceName ?? null,
        contact: {
          fullName: contact.fullName,
          email: contact.email,
          phone: submission.contact.phone ?? null,
          country: submission.contact.country ?? null,
          city: submission.contact.city ?? null,
        },
        fields: readFields(submission.draft.payload),
        message: submission.draft.message ?? null,
        receivedAt: request.createdAt,
        dueAt: request.dueAt,
        adminUrl: new URL(
          extra.adminPath ?? adminRequestPath(request.id),
          this.config.get('WEB_URL'),
        ).toString(),
      },
    );
    await submission.afterCommit?.(contact, extra);
    return { reference: request.reference, message: acceptedMessage(kind, lang) };
  }

  /** Accusé de réception et alertes de l'équipe ; une erreur est journalisée (référence seulement) sans échouer. */
  private async enqueueMails(
    reference: string,
    acknowledgement: AcknowledgementMail,
    alert: TeamAlert,
  ): Promise<void> {
    try {
      const settings = await this.prisma.setting.findMany({
        where: { key: { in: [SETTING_KEYS.emails, SETTING_KEYS.coordonnees] } },
        select: { key: true, value: true },
      });
      const values = new Map(settings.map((setting) => [setting.key, setting.value]));
      const recipients = teamRecipients(
        values.get(SETTING_KEYS.emails),
        values.get(SETTING_KEYS.coordonnees),
      );
      if (recipients.length === 0) {
        this.logger.warn(`Aucun destinataire pour l'alerte de l'équipe (demande ${reference}).`);
      }
      await this.mailQueue.enqueueMany(submissionMailJobs(reference, acknowledgement, alert, recipients));
    } catch (error) {
      const reason = error instanceof Error ? error.name : 'erreur inconnue';
      this.logger.error(`E-mails de la demande ${reference} non mis en file (${reason}).`);
    }
  }
}

function acknowledgementBase(contact: SavedContact, request: CreatedRequest) {
  return {
    firstName: contact.firstName ?? contact.fullName,
    fullName: contact.fullName,
    reference: request.reference,
    receivedAt: request.createdAt.toISOString(),
  };
}

function localizedNullable(
  french: string | null,
  translations: unknown,
  field: string,
  lang: Lang,
): string | null {
  return french === null ? null : localizedText(french, translations, field, lang);
}

function toJsonFields(fields: readonly RequestField[]): Prisma.InputJsonArray {
  return fields.map((field) => ({ key: field.key, label: field.label, value: field.value }));
}

function isRequestField(value: unknown): value is RequestField {
  if (typeof value !== 'object' || value === null) return false;
  const field = value as Record<string, unknown>;
  return typeof field['label'] === 'string' && typeof field['value'] === 'string';
}

function readFields(payload: Prisma.InputJsonObject): RequestField[] {
  const fields: unknown = payload['fields'];
  return Array.isArray(fields) ? fields.filter(isRequestField) : [];
}
