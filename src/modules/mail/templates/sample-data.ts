import type { MailContext } from '../mail-view.js';
import type { MailLang, MailTemplateKey } from '../mail.types.js';

/**
 * Données d'exemple de chaque gabarit (celles des maquettes quand elles existent) : prévisualisation
 * (`pnpm mail:preview`) et tests de rendu. Elles illustrent aussi les clés attendues (`templates/README.md`).
 */
export const SAMPLE_DATA: Record<MailTemplateKey, Record<string, unknown>> = {
  'quote-ack': {
    firstName: 'Aurélie',
    reference: 'MP-2026-0142',
    serviceName: 'Chef privé',
    categoryName: 'Expérience',
    desiredDate: '2026-11-14T09:00:00.000Z',
    city: 'Douala',
  },
  'team-new-request': {
    fullName: 'Aurélie Mbarga',
    reference: 'MP-2026-0142',
    serviceName: 'Chef privé',
    quarterName: 'Bonapriso',
    city: 'Douala',
    phone: '+237699112233',
    email: 'aurelie@example.com',
    requestId: 'req_0142',
    requestTypeLabel: 'Demande de devis',
    fields: [
      { key: 'date', label: 'Date souhaitée', value: 'Samedi 14 novembre 2026' },
      { key: 'guests', label: 'Nombre de convives', value: '8' },
    ],
    message: 'Dîner d’anniversaire à la maison.',
    dueAt: '2026-11-06T09:00:00.000Z',
  },
  'team-assignment': {
    fullName: 'Aurélie Mbarga',
    reference: 'MP-2026-0142',
    serviceName: 'Chef privé',
    assignedByName: 'Mireille Bell',
    requestId: 'req_0142',
  },
  'contact-ack': { firstName: 'Aurélie', subjectLabel: 'Question sur un service' },
  'appointment-received': {
    firstName: 'Aurélie',
    reference: 'MP-2026-0143',
    startsAt: '2026-11-12T13:00:00.000Z',
    reasonLabel: 'Immobilier',
    formatLabel: 'Visio',
  },
  'appointment-confirmed': {
    firstName: 'Aurélie',
    reference: 'MP-2026-0143',
    startsAt: '2026-11-12T13:00:00.000Z',
    endsAt: '2026-11-12T13:30:00.000Z',
    reasonLabel: 'Immobilier',
    serviceName: 'Immobilier',
    formatLabel: 'Visio · lien envoyé la veille',
  },
  'appointment-proposed': {
    firstName: 'Aurélie',
    reference: 'MP-2026-0143',
    startsAt: '2026-11-13T09:30:00.000Z',
    reasonLabel: 'Immobilier',
    formatLabel: 'À l’agence',
    actionUrl: 'https://mamboproxi.com/rendez-vous/confirmer?token=exemple',
  },
  'appointment-cancelled': {
    firstName: 'Aurélie',
    reference: 'MP-2026-0143',
    startsAt: '2026-11-12T13:00:00.000Z',
  },
  'appointment-reminder': {
    firstName: 'Aurélie',
    reference: 'MP-2026-0143',
    startsAt: '2026-11-12T13:00:00.000Z',
    serviceName: 'Immobilier',
    reasonLabel: 'Immobilier',
    formatLabel: 'Visio',
  },
  'survey-invitation': {
    firstName: 'Aurélie',
    reference: 'MP-2026-0142',
    serviceName: 'Chef privé',
    serviceDate: '2026-11-14T09:00:00.000Z',
    actionUrl: 'https://mamboproxi.com/questionnaire/exemple',
  },
  'survey-reminder': {
    firstName: 'Aurélie',
    reference: 'MP-2026-0142',
    serviceName: 'Chef privé',
    actionUrl: 'https://mamboproxi.com/questionnaire/exemple',
  },
  'registration-confirmed': { firstName: 'Aurélie' },
  'application-received': { firstName: 'Paul', jobTitle: 'Chauffeur accompagnateur' },
  'training-request-received': {
    firstName: 'Paul',
    reference: 'MP-2026-0144',
    trainingName: 'Accueil et service client',
    participants: 8,
  },
  'partner-request-received': {
    firstName: 'Paul',
    partnershipLabel: 'Prestataire Expérience',
    organization: 'Saveurs du Wouri',
  },
  'event-registration': {
    firstName: 'Aurélie',
    eventName: 'Soirée jazz au bord du Wouri',
    startsAt: '2026-12-05T18:00:00.000Z',
    place: 'Douala, Bonanjo',
    seats: 2,
  },
  'newsletter-confirm': {
    firstName: 'Aurélie',
    actionUrl: 'https://mamboproxi.com/newsletter/confirmation?token=exemple',
  },
  'newsletter-campaign': {
    firstName: 'Aurélie',
    subject: 'Les nouveautés de novembre',
    preheader: 'Nos coups de cœur du mois à Douala',
    html: '<h2>Bonjour {prénom},</h2><p>Découvrez nos <strong>coups de cœur</strong> du mois.</p><p><a href="https://mamboproxi.com/services">Voir les services</a></p>',
    unsubscribeUrl: 'https://mamboproxi.com/newsletter/desinscription?token=exemple',
    oneClickUnsubscribeUrl: 'https://api.mamboproxi.com/v1/newsletter/unsubscribe?token=exemple',
  },
  'user-invite': {
    firstName: 'Mireille',
    actionUrl: 'https://mamboproxi.com/admin/invitation?token=exemple',
  },
  'otp-code': { code: '482913' },
  'password-reset': { actionUrl: 'https://mamboproxi.com/admin/nouveau-mot-de-passe?token=exemple' },
};

/** Coordonnées des paramètres du seed (`prisma/seed/data/settings.json`). */
export function sampleContext(lang: MailLang): MailContext {
  return {
    ...SAMPLE_CONTEXT,
    tagline: lang === 'fr' ? SAMPLE_CONTEXT.tagline : 'Your services, close at hand',
  };
}

export const SAMPLE_CONTEXT: MailContext = {
  webUrl: 'https://mamboproxi.com',
  siteName: 'MAMBO Proxi',
  tagline: 'Vos services, au plus près de vous',
  email: 'contact@mamboproxi.com',
  phoneDisplay: '+237 6 00 00 00 00',
  whatsappNumber: '+237600000000',
  whatsappDisplay: '+237 6 00 00 00 00',
};
