import { normalizeVariableName } from './interpolate.js';
import { ESSENTIAL_TEMPLATES, MAIL_TEMPLATE_KEYS, type MailTemplateKey } from './mail.types.js';
import { buildVariables, normalizeData, TEMPLATE_DEFINITIONS } from './template-definitions.js';
import { SAMPLE_DATA } from './templates/sample-data.js';

/**
 * Fiches des e-mails automatiques du back-office (`EmailTemplate` du contrat) : nom, description, destinataire,
 * désactivation possible et variables utilisables. Textes du back-office simulé du site ; les variables sont celles
 * que l'API sait remplir pour ce modèle (données d'exemple des gabarits, `templates/sample-data.ts`).
 */

export type TemplateAudience = 'client' | 'equipe' | 'utilisateur';

const TEXTS: Record<MailTemplateKey, { name: string; description: string }> = {
  'quote-ack': {
    name: 'Accusé de réception du devis',
    description: 'Envoyé dès qu’une demande de devis est reçue.',
  },
  'team-new-request': {
    name: 'Alerte « nouvelle demande »',
    description: 'Une notification par e-mail pour chaque nouvelle demande.',
  },
  'team-assignment': {
    name: 'Alerte « demande assignée »',
    description: 'Prévient la personne à qui une demande ou un rendez-vous vient d’être assigné.',
  },
  'contact-ack': {
    name: 'Accusé de réception du message',
    description: 'Envoyé après un message du formulaire de contact.',
  },
  'appointment-received': {
    name: 'Demande de rendez-vous reçue',
    description: 'Envoyé dès qu’une demande de rendez-vous est reçue.',
  },
  'appointment-confirmed': {
    name: 'Rendez-vous confirmé',
    description: 'Envoyé à la confirmation du rendez-vous.',
  },
  'appointment-proposed': {
    name: 'Nouveau créneau proposé',
    description: 'Envoyé quand l’équipe propose un autre créneau.',
  },
  'appointment-cancelled': {
    name: 'Rendez-vous annulé',
    description: 'Envoyé à l’annulation d’un rendez-vous.',
  },
  'appointment-reminder': { name: 'Rappel de rendez-vous', description: 'Envoyé la veille du rendez-vous.' },
  'survey-invitation': {
    name: 'Questionnaire de satisfaction',
    description: 'Envoyé après le passage au statut « Prestation réalisée ».',
  },
  'survey-reminder': {
    name: 'Relance du questionnaire',
    description: 'Relance si le questionnaire n’a pas été rempli.',
  },
  'registration-confirmed': {
    name: 'Confirmation d’inscription',
    description: 'Envoyé après une inscription (particulier ou professionnel).',
  },
  'application-received': {
    name: 'Candidature reçue',
    description: 'Envoyé après une candidature à une offre ou une candidature spontanée.',
  },
  'training-request-received': {
    name: 'Demande de formation reçue',
    description: 'Envoyé après une demande de formation.',
  },
  'partner-request-received': {
    name: 'Demande de partenariat reçue',
    description: 'Envoyé après une demande de partenariat.',
  },
  'event-registration': {
    name: 'Inscription à un événement',
    description: 'Envoyé après une inscription à un événement de l’agenda.',
  },
  'newsletter-confirm': {
    name: 'Confirmation d’inscription à la newsletter',
    description: 'Double validation de l’adresse : obligatoire.',
  },
  'newsletter-campaign': {
    name: 'Gabarit de la newsletter',
    description: 'En-tête et pied communs à tous les envois de la newsletter.',
  },
  'user-invite': { name: 'Invitation au back-office', description: 'Lien d’activation valable 7 jours.' },
  'otp-code': {
    name: 'Code de connexion',
    description: 'Code à usage unique de la double authentification.',
  },
  'password-reset': {
    name: 'Réinitialisation du mot de passe',
    description: 'Lien de réinitialisation valable 1 heure.',
  },
};

/** Variables nommées des modèles, dans l'ordre d'affichage (nom écrit avec ses accents). */
const NAMED_VARIABLES = [
  'prénom',
  'nom',
  'référence',
  'service',
  'rubrique',
  'offre',
  'poste',
  'formation',
  'événement',
  'objet',
  'quartier',
  'ville',
  'lieu',
  'date',
  'heure',
  'code',
] as const;

/**
 * Variables disponibles en plus de celles des données d'exemple : la référence `MP-AAAA-NNNN` accompagne chaque
 * accusé de réception d'un formulaire public (`MailJob.reference`).
 */
const EXTRA_VARIABLES: Partial<Record<MailTemplateKey, readonly (typeof NAMED_VARIABLES)[number][]>> = {
  'contact-ack': ['référence'],
  'registration-confirmed': ['référence'],
  'application-received': ['référence'],
  'partner-request-received': ['référence'],
  'event-registration': ['référence'],
};

export interface TemplateEntry {
  key: MailTemplateKey;
  name: string;
  description: string;
  audience: TemplateAudience;
  canDisable: boolean;
  /** Variables utilisables, telles qu'affichées (`{prénom}`). */
  variables: string[];
  /** Mêmes variables, normalisées (`prenom`) : contrôle des textes enregistrés. */
  allowed: ReadonlySet<string>;
}

function entry(key: MailTemplateKey): TemplateEntry {
  const available = buildVariables(normalizeData(key, SAMPLE_DATA[key]), 'fr');
  const extra = new Set<string>(EXTRA_VARIABLES[key] ?? []);
  const names = NAMED_VARIABLES.filter(
    (name) => available[normalizeVariableName(name)] !== undefined || extra.has(name),
  );
  const audience = TEMPLATE_DEFINITIONS[key].audience;
  return {
    key,
    ...TEXTS[key],
    audience: audience === 'newsletter' ? 'client' : audience,
    canDisable: !ESSENTIAL_TEMPLATES.has(key),
    variables: names.map((name) => `{${name}}`),
    allowed: new Set(names.map(normalizeVariableName)),
  };
}

/** Fiches des 21 modèles, dans l'ordre de l'énumération `EmailTemplateKey` du contrat. */
export const TEMPLATE_CATALOG: readonly TemplateEntry[] = MAIL_TEMPLATE_KEYS.map(entry);

export const TEMPLATE_ENTRIES: ReadonlyMap<MailTemplateKey, TemplateEntry> = new Map(
  TEMPLATE_CATALOG.map((item) => [item.key, item]),
);
