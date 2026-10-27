import type { MailVariables } from './interpolate.js';
import { normalizeVariableName } from './interpolate.js';
import {
  capitalize,
  formatLongDate,
  formatPhone,
  formatShortDate,
  formatTime,
  googleCalendarLink,
  readText,
  safeUrl,
  whatsappLink,
} from './mail-format.js';
import type { MailAudience, MailContext } from './mail-view.js';
import type { MailLang, MailTemplateKey } from './mail.types.js';

/**
 * Particularités de chaque modèle : données obligatoires, bloc récapitulatif, adresse du bouton, variantes
 * (étoiles du questionnaire, code OTP, corps de campagne). Les textes eux-mêmes viennent du modèle en base
 * (`email_templates`) ou des textes par défaut. Les données attendues sont listées dans `templates/README.md`.
 */

type Data = Record<string, unknown>;

export interface DefinitionInput {
  data: Data;
  lang: MailLang;
  context: MailContext;
}

/** Ligne du récapitulatif : libellé traduit (`LabelKey`) ou libellé déjà prêt (`{ text }`, champs d'un formulaire). */
export type SummaryEntry = readonly [label: LabelKey | { text: string }, value: string | undefined];

export interface TemplateDefinition {
  audience: MailAudience;
  /** Données sans lesquelles l'e-mail n'a pas de sens (`date` : `startsAt`, `date` ou `dateLabel`). */
  required: readonly string[];
  summary?: (input: DefinitionInput) => readonly SummaryEntry[];
  /** Adresse du bouton quand la tâche n'en fournit pas (`actionUrl`). */
  defaultButtonUrl?: (input: DefinitionInput) => string | undefined;
  rating?: boolean;
  code?: boolean;
  campaign?: boolean;
  /** Mention du pied de page propre au modèle (sinon celle du destinataire type). */
  notice?: (lang: MailLang, domain: string) => string;
}

const LABELS = {
  reference: { fr: 'Référence', en: 'Reference' },
  service: { fr: 'Service', en: 'Service' },
  desiredDate: { fr: 'Date souhaitée', en: 'Preferred date' },
  city: { fr: 'Ville', en: 'City' },
  client: { fr: 'Client', en: 'Client' },
  area: { fr: 'Quartier', en: 'Area' },
  phone: { fr: 'Téléphone', en: 'Phone' },
  email: { fr: 'E-mail', en: 'E-mail' },
  assignedBy: { fr: 'Assignée par', en: 'Assigned by' },
  subject: { fr: 'Sujet', en: 'Subject' },
  reason: { fr: 'Motif', en: 'Reason' },
  date: { fr: 'Date', en: 'Date' },
  time: { fr: 'Heure', en: 'Time' },
  format: { fr: 'Format', en: 'Format' },
  event: { fr: 'Événement', en: 'Event' },
  place: { fr: 'Lieu', en: 'Venue' },
  videoLink: { fr: 'Lien visio', en: 'Video link' },
  seats: { fr: 'Places', en: 'Seats' },
  training: { fr: 'Formation', en: 'Training' },
  participants: { fr: 'Participants', en: 'Participants' },
  position: { fr: 'Poste', en: 'Position' },
  partnership: { fr: 'Partenariat', en: 'Partnership' },
  organization: { fr: 'Structure', en: 'Organisation' },
  requestType: { fr: 'Type', en: 'Type' },
  country: { fr: 'Pays', en: 'Country' },
  message: { fr: 'Message', en: 'Message' },
  dueAt: { fr: 'À traiter avant le', en: 'To handle by' },
  period: { fr: 'Période', en: 'Period' },
} as const satisfies Record<string, Record<MailLang, string>>;

export type LabelKey = keyof typeof LABELS;

export function label(key: LabelKey, lang: MailLang): string {
  return LABELS[key][lang];
}

const DOUALA_TIME = { fr: 'heure de Douala', en: 'Douala time' } as const;

/** Date d'un rendez-vous ou d'un événement, pour le récapitulatif : « Jeudi 12 novembre 2026 ». */
function summaryDate({ data, lang }: DefinitionInput, isoKey = 'startsAt'): string | undefined {
  const formatted = formatLongDate(readText(data, isoKey) ?? readText(data, 'date'), lang);
  return readText(data, 'dateLabel') ?? (formatted === undefined ? undefined : capitalize(formatted));
}

/** Heure d'un rendez-vous : « 14:00 (heure de Douala) ». */
function summaryTime({ data, lang }: DefinitionInput): string | undefined {
  const time = readText(data, 'timeLabel') ?? formatTime(readText(data, 'startsAt'), lang);
  return time === undefined ? undefined : `${time} (${DOUALA_TIME[lang]})`;
}

const appointmentCard = (input: DefinitionInput): readonly SummaryEntry[] => [
  ['reason', readText(input.data, 'reasonLabel')],
  ['date', summaryDate(input)],
  ['time', summaryTime(input)],
  ['format', readText(input.data, 'formatLabel')],
  ['place', readText(input.data, 'place')],
  ['videoLink', readText(input.data, 'videoLink')],
];

/** Carte du rendez-vous suivie du message de l'agence (proposition d'un autre créneau, annulation). */
const appointmentCardWithMessage = (input: DefinitionInput): readonly SummaryEntry[] => [
  ...appointmentCard(input),
  ['message', readText(input.data, 'message')],
];

/** Lien du back-office vers une demande (`/admin/demandes?id=…`). */
function adminRequestUrl({ data, context }: DefinitionInput): string {
  const requestId = readText(data, 'requestId');
  const base = `${context.webUrl}/admin/demandes`;
  return requestId === undefined ? base : `${base}?id=${encodeURIComponent(requestId)}`;
}

/** Adresse publique localisée (le site anglais est sous `/en`). */
export function sitePath(context: MailContext, lang: MailLang, path: string): string {
  return `${context.webUrl}${lang === 'en' ? '/en' : ''}${path}`;
}

const WHATSAPP_ABOUT = {
  fr: (reference: string) => `Bonjour Mambo Proxi, je vous écris au sujet de ma demande ${reference}.`,
  en: (reference: string) => `Hello Mambo Proxi, I am writing about my request ${reference}.`,
} as const;

const NEWSLETTER_CONFIRM_NOTICE = {
  fr: (domain: string) =>
    `Vous recevez cet e-mail suite à votre inscription à la newsletter sur ${domain}. Sans confirmation, vous ne recevrez rien.`,
  en: (domain: string) =>
    `You are receiving this e-mail following your newsletter sign-up on ${domain}. Without confirmation, you will receive nothing.`,
} as const;

export const TEMPLATE_DEFINITIONS: Record<MailTemplateKey, TemplateDefinition> = {
  'quote-ack': {
    audience: 'client',
    required: ['reference', 'serviceName'],
    summary: (input) => {
      const { data, lang } = input;
      const desired = formatLongDate(readText(data, 'desiredDate'), lang);
      return [
        ['reference', readText(data, 'reference')],
        ['service', readText(data, 'serviceName')],
        ['desiredDate', readText(data, 'desiredDateLabel') ?? (desired && capitalize(desired))],
        ['city', readText(data, 'city')],
      ];
    },
    // Pas d'espace client (lot 1) : le bouton ouvre WhatsApp avec la référence (maquette).
    defaultButtonUrl: ({ data, lang, context }) => {
      const reference = readText(data, 'reference') ?? '';
      return whatsappLink(context.whatsappNumber, WHATSAPP_ABOUT[lang](reference));
    },
  },
  'team-new-request': {
    audience: 'equipe',
    required: ['reference', 'serviceName'],
    summary: (input) => {
      const { data, lang } = input;
      const due = formatLongDate(readText(data, 'dueAt'), lang);
      const dueTime = formatTime(readText(data, 'dueAt'), lang);
      return [
        ['reference', readText(data, 'reference')],
        ['requestType', readText(data, 'requestTypeLabel')],
        ['service', readText(data, 'serviceName')],
        ['client', readText(data, 'fullName')],
        ['phone', formatPhone(readText(data, 'phone'))],
        ['email', readText(data, 'email')],
        ['area', readText(data, 'quarterName') ?? readText(data, 'city')],
        ['country', readText(data, 'country')],
        // Informations saisies dans le formulaire, avec leurs libellés (comme dans le back-office).
        ...formFields(data),
        ['message', readText(data, 'message')],
        ['dueAt', due && dueTime && `${due} ${AT[lang]} ${dueTime}`],
      ];
    },
    defaultButtonUrl: adminRequestUrl,
  },
  'team-assignment': {
    audience: 'equipe',
    required: ['reference', 'serviceName'],
    summary: ({ data }) => [
      ['reference', readText(data, 'reference')],
      ['service', readText(data, 'serviceName')],
      ['client', readText(data, 'fullName')],
      ['assignedBy', readText(data, 'assignedByName')],
    ],
    defaultButtonUrl: adminRequestUrl,
  },
  'contact-ack': {
    audience: 'client',
    required: [],
    summary: ({ data }) => [
      ['reference', readText(data, 'reference')],
      ['subject', readText(data, 'subjectLabel') ?? readText(data, 'subject')],
      ['service', readText(data, 'serviceName')],
    ],
  },
  'appointment-received': {
    audience: 'client',
    required: ['date'],
    summary: (input) => [['reference', readText(input.data, 'reference')], ...appointmentCard(input)],
  },
  'appointment-confirmed': {
    audience: 'client',
    required: ['date'],
    summary: appointmentCard,
    // Sans lien fourni (fichier .ics hébergé…), le bouton « Ajouter à mon agenda » ouvre Google Agenda.
    defaultButtonUrl: ({ data, context }) =>
      googleCalendarLink({
        title: [context.siteName, readText(data, 'reasonLabel') ?? readText(data, 'serviceName')]
          .filter(Boolean)
          .join(' · '),
        startsAt: readText(data, 'startsAt'),
        endsAt: readText(data, 'endsAt'),
        details: readText(data, 'reference'),
        location: readText(data, 'location'),
      }),
  },
  'appointment-proposed': {
    audience: 'client',
    required: ['date', 'actionUrl'],
    summary: appointmentCardWithMessage,
  },
  'appointment-cancelled': {
    audience: 'client',
    required: ['date'],
    summary: (input) => [
      ['date', summaryDate(input)],
      ['time', summaryTime(input)],
      ['message', readText(input.data, 'message')],
    ],
  },
  'appointment-reminder': {
    audience: 'client',
    required: ['date'],
    summary: appointmentCard,
  },
  'survey-invitation': {
    audience: 'client',
    required: ['actionUrl', 'serviceName'],
    rating: true,
  },
  'survey-reminder': {
    audience: 'client',
    required: ['actionUrl', 'serviceName'],
    rating: true,
  },
  'registration-confirmed': {
    audience: 'client',
    required: [],
    defaultButtonUrl: ({ lang, context }) => sitePath(context, lang, '/services'),
  },
  'application-received': {
    audience: 'client',
    required: ['jobTitle'],
    summary: ({ data }) => [['position', readText(data, 'jobTitle')]],
  },
  'training-request-received': {
    audience: 'client',
    required: ['trainingName'],
    summary: ({ data }) => [
      ['reference', readText(data, 'reference')],
      ['training', readText(data, 'trainingName')],
      ['participants', readText(data, 'participants')],
      ['period', readText(data, 'period')],
    ],
  },
  'partner-request-received': {
    audience: 'client',
    required: [],
    summary: ({ data, lang }) => [
      [
        'partnership',
        readText(data, 'partnershipLabel') ?? partnershipLabel(readText(data, 'partnershipType'), lang),
      ],
      ['organization', readText(data, 'organization')],
    ],
  },
  'event-registration': {
    audience: 'client',
    required: ['eventName'],
    summary: (input) => [
      ['event', readText(input.data, 'eventName')],
      ['date', summaryDate(input)],
      ['place', readText(input.data, 'place')],
      ['seats', readText(input.data, 'seats')],
    ],
  },
  'newsletter-confirm': {
    audience: 'client',
    required: ['actionUrl'],
    notice: (lang, domain) => NEWSLETTER_CONFIRM_NOTICE[lang](domain),
  },
  'newsletter-campaign': {
    audience: 'newsletter',
    required: ['subject', 'html', 'unsubscribeUrl'],
    campaign: true,
  },
  'user-invite': {
    audience: 'utilisateur',
    required: ['actionUrl'],
  },
  'otp-code': {
    audience: 'utilisateur',
    required: ['code'],
    code: true,
  },
  'password-reset': {
    audience: 'utilisateur',
    required: ['actionUrl'],
  },
};

const PARTNERSHIP_LABELS: Record<string, Record<MailLang, string>> = {
  PRESTATAIRE_EXPERIENCE: { fr: 'Prestataire Expérience', en: 'Experience provider' },
  IMMOBILIER: { fr: 'Immobilier', en: 'Real estate' },
  ENTREPRISE_PRESTATAIRE: { fr: 'Entreprise & prestataire', en: 'Company & provider' },
  AUTRE: { fr: 'Autre', en: 'Other' },
};

function partnershipLabel(code: string | undefined, lang: MailLang): string | undefined {
  return code === undefined ? undefined : (PARTNERSHIP_LABELS[code]?.[lang] ?? code);
}

/** Champs `fields: [{ label, value }]` d'une demande (au plus 20 lignes). */
function formFields(data: Data): SummaryEntry[] {
  const fields = data['fields'];
  if (!Array.isArray(fields)) return [];
  const entries: SummaryEntry[] = [];
  for (const field of fields.slice(0, 20) as unknown[]) {
    if (typeof field !== 'object' || field === null) continue;
    const row = field as Data;
    const text = readText(row, 'label');
    const value = readText(row, 'value');
    if (text !== undefined && value !== undefined) entries.push([{ text }, value]);
  }
  return entries;
}

/**
 * Noms acceptés en plus des noms de référence (`templates/README.md`), tels qu'envoyés par les formulaires
 * publics (`src/modules/forms/forms.mail.ts`) : la donnée de référence, si elle est fournie, l'emporte.
 */
const COMMON_ALIASES: Record<string, readonly string[]> = {
  fullName: ['contactName'],
  email: ['contactEmail'],
  phone: ['contactPhone'],
  city: ['contactCity'],
  country: ['contactCountry'],
  actionUrl: ['adminUrl'],
};

const TEMPLATE_ALIASES: Partial<Record<MailTemplateKey, Record<string, readonly string[]>>> = {
  'quote-ack': { serviceName: ['categoryName'] },
  'team-new-request': { serviceName: ['subject', 'requestTypeLabel'] },
  'training-request-received': { trainingName: ['trainingTitle'] },
  'event-registration': {
    eventName: ['eventTitle'],
    startsAt: ['eventStartsAt'],
    endsAt: ['eventEndsAt'],
    place: ['eventPlace', 'eventCity'],
  },
};

/** Complète les données avec les noms de référence (voir les tables d'alias ci-dessus). */
export function normalizeData(template: MailTemplateKey, data: Data): Data {
  const result: Data = { ...data };
  for (const table of [COMMON_ALIASES, TEMPLATE_ALIASES[template] ?? {}]) {
    for (const [key, aliases] of Object.entries(table)) {
      if (readText(result, key) !== undefined) continue;
      const alias = aliases.find((name) => readText(data, name) !== undefined);
      if (alias !== undefined) result[key] = data[alias];
    }
  }
  return result;
}

/** Données obligatoires manquantes (une adresse invalide compte comme absente). */
export function missingData(definition: TemplateDefinition, data: Data): string[] {
  return definition.required.filter((key) => {
    if (key === 'date') {
      return ['startsAt', 'date', 'dateLabel'].every((candidate) => readText(data, candidate) === undefined);
    }
    if (key.endsWith('Url')) return safeUrl(readText(data, key)) === undefined;
    return readText(data, key) === undefined;
  });
}

const AT = { fr: 'à', en: 'at' } as const;

/**
 * Valeurs des variables des modèles (`{prénom}`, `{référence}`…), à partir des données de la tâche.
 * Toute donnée texte est aussi disponible sous son propre nom (`{firstName}`).
 */
export function buildVariables(data: Data, lang: MailLang): MailVariables {
  const variables: Record<string, string> = {};
  for (const key of Object.keys(data)) {
    const value = readText(data, key);
    if (value !== undefined) variables[normalizeVariableName(key)] = value;
  }

  const firstName = readText(data, 'firstName');
  const fullName =
    readText(data, 'fullName') ??
    ([firstName, readText(data, 'lastName')].filter(Boolean).join(' ') || undefined);
  const startsAt = readText(data, 'startsAt');
  const longDate = formatLongDate(startsAt ?? readText(data, 'date'), lang);
  const time = readText(data, 'timeLabel') ?? formatTime(startsAt, lang);
  const date =
    readText(data, 'dateLabel') ??
    (longDate !== undefined && startsAt !== undefined && time !== undefined
      ? `${longDate} ${AT[lang]} ${time}`
      : longDate) ??
    formatShortDate(readText(data, 'serviceDate'), lang);

  const named: Record<string, string | undefined> = {
    prenom: firstName,
    nom: fullName,
    reference: readText(data, 'reference'),
    service: readText(data, 'serviceName'),
    rubrique: readText(data, 'categoryName'),
    offre: readText(data, 'jobTitle'),
    poste: readText(data, 'jobTitle'),
    formation: readText(data, 'trainingName'),
    evenement: readText(data, 'eventName'),
    objet: readText(data, 'subject'),
    quartier: readText(data, 'quarterName') ?? readText(data, 'city'),
    ville: readText(data, 'city'),
    lieu: readText(data, 'place'),
    code: readText(data, 'code'),
    date,
    heure: time,
  };
  for (const [name, value] of Object.entries(named)) {
    if (value !== undefined) variables[name] = value;
  }
  return variables;
}
