import type { Lang } from '../../common/i18n/lang.js';
import {
  asObjectArray,
  readNullableString,
  readString,
  readStringArray,
} from '../../common/json/json-read.js';
import type { ProblemFieldError } from '../../common/problem/problem.js';
import type { ContactPreference, PartnershipType, RequestType } from '../../generated/prisma/client.js';
import { AGENCY_TIME_ZONE } from '../requests/reference.js';
import type { RequestField } from '../requests/requests.service.js';

/** Champ dynamique d'un devis (schéma `QuoteField` du contrat, colonne `categories.quote_fields`). */
export interface QuoteFieldDefinition {
  name: string;
  label: string;
  type: string;
  required: boolean;
}

export type NeedValue = string | number | string[] | null;

/** Message de confirmation (`SubmissionAccepted.message`), dans la langue de l'envoi. */
export type SubmissionKind = 'quote' | 'contact' | 'registration' | 'training' | 'partner' | 'event';

const ACCEPTED_MESSAGES: Record<SubmissionKind, Record<Lang, string>> = {
  quote: {
    fr: 'Merci, votre demande est bien envoyée ! Vous recevrez un e-mail de confirmation dans quelques instants.',
    en: 'Thank you, your request has been sent! You will receive a confirmation email in a few moments.',
  },
  contact: {
    fr: 'Merci, votre message est bien envoyé ! Vous recevrez un e-mail de confirmation dans quelques instants.',
    en: 'Thank you, your message has been sent! You will receive a confirmation email in a few moments.',
  },
  registration: {
    fr: 'Merci, votre inscription est bien enregistrée ! Vous recevrez un e-mail de confirmation dans quelques instants.',
    en: 'Thank you, your registration is confirmed! You will receive a confirmation email in a few moments.',
  },
  training: {
    fr: 'Merci, votre demande est bien envoyée ! Vous recevrez un e-mail de confirmation dans quelques instants.',
    en: 'Thank you, your request has been sent! You will receive a confirmation email in a few moments.',
  },
  partner: {
    fr: 'Merci, votre demande est bien envoyée ! Vous recevrez un e-mail de confirmation dans quelques instants.',
    en: 'Thank you, your request has been sent! You will receive a confirmation email in a few moments.',
  },
  event: {
    fr: 'Merci, votre inscription est bien enregistrée ! Vous recevrez un e-mail de confirmation dans quelques instants.',
    en: 'Thank you, your registration is confirmed! You will receive a confirmation email in a few moments.',
  },
};

export function acceptedMessage(kind: SubmissionKind, lang: Lang): string {
  return ACCEPTED_MESSAGES[kind][lang];
}

/** Langue de l'envoi : `lang` du corps, sinon la première langue prise en charge de `Accept-Language`, sinon `fr`. */
export function resolveLang(bodyLang: Lang | undefined, acceptLanguage: string | undefined): Lang {
  if (bodyLang) return bodyLang;
  const preferred = acceptLanguage
    ?.split(',')
    .map((part) => part.split(';')[0]?.trim().toLowerCase().slice(0, 2))
    .find((code) => code === 'fr' || code === 'en');
  return preferred ?? 'fr';
}

/** Libellés français des types de demande (alerte de l'équipe, notifications). */
export const REQUEST_TYPE_LABELS: Record<RequestType, string> = {
  DEVIS: 'Demande de devis',
  CONTACT: 'Message de contact',
  INFORMATION: "Demande d'information",
  INSCRIPTION: 'Inscription',
  FORMATION: 'Demande de formation',
  CANDIDATURE: 'Candidature',
  PARTENARIAT: 'Demande de partenariat',
  EVENEMENT: 'Inscription à un événement',
  RENDEZ_VOUS: 'Demande de rendez-vous',
};

export const CONTACT_PREFERENCE_LABELS: Record<ContactPreference, string> = {
  WHATSAPP: 'WhatsApp',
  TELEPHONE: 'Téléphone',
  EMAIL: 'E-mail',
};

export const PARTNERSHIP_TYPE_LABELS: Record<PartnershipType, string> = {
  PRESTATAIRE_EXPERIENCE: 'Prestataire Expérience',
  IMMOBILIER: 'Immobilier',
  ENTREPRISE_PRESTATAIRE: 'Entreprise prestataire',
  AUTRE: 'Autre',
};

const PARTNERSHIP_TYPE_LABELS_EN: Record<PartnershipType, string> = {
  PRESTATAIRE_EXPERIENCE: 'Experience provider',
  IMMOBILIER: 'Real estate',
  ENTREPRISE_PRESTATAIRE: 'Service company',
  AUTRE: 'Other',
};

export function partnershipLabel(type: PartnershipType, lang: Lang): string {
  return (lang === 'en' ? PARTNERSHIP_TYPE_LABELS_EN : PARTNERSHIP_TYPE_LABELS)[type];
}

/** Objet générique d'un message de contact, quand ni sujet ni service ne sont indiqués. */
export function defaultContactSubject(type: 'CONTACT' | 'INFORMATION', lang: Lang): string {
  if (type === 'INFORMATION') return lang === 'en' ? 'Information request' : "Demande d'information";
  return 'Message';
}

/** Valeur texte d'un champ dynamique (`eventDate`, `city`…), sinon `null`. */
export function needText(needs: Readonly<Record<string, NeedValue>>, ...names: string[]): string | null {
  for (const name of names) {
    const value = needs[name];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  return null;
}

/** Champs dynamiques d'une rubrique, lus prudemment dans la colonne JSON. */
export function readQuoteFields(value: unknown): QuoteFieldDefinition[] {
  return asObjectArray(value)
    .map((field) => ({
      name: readString(field, 'name', ''),
      label: readString(field, 'label', ''),
      type: readString(field, 'type', 'text'),
      required: field['required'] === true,
    }))
    .filter((field) => field.name !== '');
}

function isEmptyNeed(value: NeedValue | undefined): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.every((item) => item.trim() === '');
  return false;
}

/** Champs obligatoires de la rubrique laissés vides → erreurs 422 sur `needs.<name>`. */
export function missingRequiredNeeds(
  fields: readonly QuoteFieldDefinition[],
  needs: Readonly<Record<string, NeedValue>>,
): ProblemFieldError[] {
  return fields
    .filter((field) => field.required && isEmptyNeed(needs[field.name]))
    .map((field) => ({
      path: `needs.${field.name}`,
      code: 'required',
      message: 'Ce champ est obligatoire.',
    }));
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const frenchDate = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

/** Valeur affichée d'un champ dynamique (date « 14 novembre 2026 », liste séparée par des virgules). */
export function formatNeed(field: QuoteFieldDefinition | undefined, value: NeedValue): string | null {
  if (isEmptyNeed(value) || value === null) return null;
  if (Array.isArray(value))
    return value
      .map((item) => item.trim())
      .filter((item) => item !== '')
      .join(', ');
  if (typeof value === 'number') return String(value);
  const text = value.trim();
  if (field?.type === 'date' && DATE_ONLY.test(text)) {
    const date = new Date(`${text}T00:00:00.000Z`);
    if (!Number.isNaN(date.getTime())) return frenchDate.format(date);
  }
  return text;
}

const doualaDateTime = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'full',
  timeStyle: 'short',
  timeZone: AGENCY_TIME_ZONE,
});

/** Date et heure affichées à l'heure de Douala (« samedi 14 novembre 2026 à 19:00 »). */
export function formatDoualaDateTime(date: Date): string {
  return doualaDateTime.format(date);
}

/**
 * Champs du devis pour le back-office : rubrique, service, puis les champs dynamiques renseignés dans l'ordre de la
 * rubrique. Les valeurs sans définition (champ retiré entre-temps) restent dans `payload.needs` sans être affichées.
 */
export function quoteRequestFields(
  categoryName: string,
  serviceName: string | null,
  definitions: readonly QuoteFieldDefinition[],
  needs: Readonly<Record<string, NeedValue>>,
  contactPreference: ContactPreference,
): RequestField[] {
  const fields: RequestField[] = [{ key: 'rubrique', label: 'Rubrique', value: categoryName }];
  if (serviceName) fields.push({ key: 'service', label: 'Service', value: serviceName });
  for (const definition of definitions) {
    const value = needs[definition.name];
    const formatted = value === undefined ? null : formatNeed(definition, value);
    if (formatted !== null) fields.push({ key: definition.name, label: definition.label, value: formatted });
  }
  fields.push({
    key: 'preference.contact',
    label: 'Préférence de contact',
    value: CONTACT_PREFERENCE_LABELS[contactPreference],
  });
  return fields;
}

/** Ajoute un champ s'il a une valeur. */
export function pushField(
  fields: RequestField[],
  key: string,
  label: string,
  value: string | number | null,
): void {
  if (value === null || value === '') return;
  fields.push({ key, label, value: String(value) });
}

/** Nom des rubriques d'intérêt d'un inscrit, dans l'ordre de saisie. */
export function interestNames(slugs: readonly string[], names: ReadonlyMap<string, string>): string[] {
  return slugs.map((slug) => names.get(slug)).filter((name): name is string => name !== undefined);
}

/** Paramètre `emails` : destinataires des alertes, à défaut l'adresse de contact de l'agence (`coordonnees`). */
export function teamRecipients(emails: unknown, coordonnees: unknown): string[] {
  const fromEmails =
    typeof emails === 'object' && emails !== null
      ? readStringArray(emails as Record<string, unknown>, 'teamRecipients')
      : [];
  const recipients = fromEmails.map((email) => email.trim()).filter((email) => email.includes('@'));
  if (recipients.length > 0) return [...new Set(recipients.map((email) => email.toLowerCase()))];
  const fallback =
    typeof coordonnees === 'object' && coordonnees !== null
      ? readNullableString(coordonnees as Record<string, unknown>, 'email')
      : null;
  return fallback ? [fallback.toLowerCase()] : [];
}
