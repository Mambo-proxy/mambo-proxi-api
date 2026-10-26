import type { MailLang } from './mail.types.js';

/** Destinataire type d'un modèle (`audience` du contrat, plus la newsletter) : règle la mention du pied de page. */
export type MailAudience = 'client' | 'equipe' | 'utilisateur' | 'newsletter';

/** Coordonnées de l'agence et adresses du site, lues dans les paramètres (`settings`) et la configuration. */
export interface MailContext {
  /** Adresse du site, sans barre finale (`WEB_URL`). */
  webUrl: string;
  siteName: string;
  tagline: string | undefined;
  email: string | undefined;
  phoneDisplay: string | undefined;
  whatsappNumber: string | undefined;
  whatsappDisplay: string | undefined;
}

export interface SummaryRow {
  label: string;
  value: string;
}

export interface MailLink {
  label: string;
  url: string;
}

/** Tout ce qu'affiche un e-mail, textes remplacés : rendu à l'identique en HTML (React Email) et en texte brut. */
export interface MailView {
  lang: MailLang;
  audience: MailAudience;
  /** Texte d'aperçu (affiché par la messagerie après l'objet). */
  preheader: string;
  /** `null` : pas de titre (campagne de newsletter, dont le corps porte ses propres titres). */
  title: string | null;
  paragraphs: string[];
  /** Bloc récapitulatif clé / valeur (référence, service, date…) ; vide = pas de bloc. */
  summary: SummaryRow[];
  /** Code à usage unique, affiché en grand (OTP). */
  code: string | null;
  /** Étoiles d'invitation au questionnaire (lien du questionnaire). */
  ratingUrl: string | null;
  button: MailLink | null;
  /** Corps HTML assaini d'une campagne (variables déjà remplacées et échappées). */
  bodyHtml: string | null;
  /** Version texte du corps d'une campagne. */
  bodyText: string | null;
  signature: string;
  logoUrl: string;
  logoAlt: string;
  webUrl: string;
  /** Lignes de coordonnées du pied de page. */
  footerLines: string[];
  /** Mention finale du pied de page (« Vous recevez cet e-mail… »). */
  notice: string;
  unsubscribe: MailLink | null;
}
