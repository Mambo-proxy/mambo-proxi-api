/**
 * Clés des modèles d'e-mails : énumération `EmailTemplateKey` du contrat (`contracts/openapi.yaml`), clés de la
 * table `email_templates`. Un test vérifie que la liste correspond exactement au contrat.
 */
export const MAIL_TEMPLATE_KEYS = [
  'quote-ack',
  'team-new-request',
  'team-assignment',
  'contact-ack',
  'appointment-received',
  'appointment-confirmed',
  'appointment-proposed',
  'appointment-cancelled',
  'appointment-reminder',
  'survey-invitation',
  'survey-reminder',
  'registration-confirmed',
  'application-received',
  'training-request-received',
  'partner-request-received',
  'event-registration',
  'newsletter-confirm',
  'newsletter-campaign',
  'user-invite',
  'otp-code',
  'password-reset',
] as const;

export type MailTemplateKey =
  | 'quote-ack'
  | 'team-new-request'
  | 'team-assignment'
  | 'contact-ack'
  | 'appointment-received'
  | 'appointment-confirmed'
  | 'appointment-proposed'
  | 'appointment-cancelled'
  | 'appointment-reminder'
  | 'survey-invitation'
  | 'survey-reminder'
  | 'registration-confirmed'
  | 'application-received'
  | 'training-request-received'
  | 'partner-request-received'
  | 'event-registration'
  | 'newsletter-confirm'
  | 'newsletter-campaign'
  | 'user-invite'
  | 'otp-code'
  | 'password-reset';

// Contrôle à la compilation : la liste et l'union décrivent exactement les mêmes clés.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const _sameKeys: Same<(typeof MAIL_TEMPLATE_KEYS)[number], MailTemplateKey> = true;
void _sameKeys;

export type MailLang = 'fr' | 'en';

/**
 * Tâche d'envoi d'un e-mail. `data` : données propres au gabarit, décrites dans `templates/README.md`
 * (`firstName`, `reference`, `serviceName`…). Les données sont sérialisées en JSON dans Redis : n'y mettre que des
 * valeurs simples (dates en chaînes ISO 8601).
 */
export interface MailJob {
  template: MailTemplateKey;
  to: string;
  lang: 'fr' | 'en';
  data: Record<string, unknown>;
  /** référence MP-AAAA-NNNN pour le suivi */
  reference?: string;
}

export function isMailTemplateKey(value: unknown): value is MailTemplateKey {
  return typeof value === 'string' && (MAIL_TEMPLATE_KEYS as readonly string[]).includes(value);
}

/** Modèles de sécurité : ne peuvent pas être désactivés dans le back-office (`canDisable: false`). */
export const SECURITY_TEMPLATES: ReadonlySet<MailTemplateKey> = new Set(['otp-code', 'password-reset']);
