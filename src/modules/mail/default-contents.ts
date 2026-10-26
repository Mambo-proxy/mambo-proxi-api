import type { MailLang, MailTemplateKey } from './mail.types.js';

/** Textes d'un modèle d'e-mail (champs `EmailTemplateFields` du contrat, hors activation). */
export interface MailContent {
  subject: string;
  preheader: string | null;
  title: string;
  paragraphs: string[];
  buttonLabel: string | null;
}

/**
 * Textes par défaut, utilisés si le modèle est absent de la base. Le français reprend exactement le seed
 * (`prisma/seed/data/email-templates.json`, vérifié par un test) ; l'anglais sert quand le modèle en base n'a pas
 * de traduction (`translations.en`). Variables : `{prénom}`, `{référence}`… (voir `interpolate.ts`).
 */
export const DEFAULT_CONTENTS: Record<MailLang, Record<MailTemplateKey, MailContent>> = {
  fr: {
    'quote-ack': {
      subject: 'Nous avons bien reçu votre demande {référence}',
      preheader: null,
      title: 'Bonjour {prénom}, nous avons bien reçu votre demande.',
      paragraphs: [
        'Merci pour votre confiance. Un conseiller étudie votre besoin et vous envoie un devis personnalisé sous 24 h.',
      ],
      buttonLabel: 'Écrire à mon conseiller sur WhatsApp',
    },
    'contact-ack': {
      subject: 'Votre message est bien arrivé',
      preheader: null,
      title: 'Merci {prénom} pour votre message',
      paragraphs: ['Nous vous répondons dans les meilleurs délais, en général dans la journée.'],
      buttonLabel: null,
    },
    'registration-confirmed': {
      subject: 'Bienvenue chez Mambo Proxi',
      preheader: null,
      title: 'Bienvenue chez Mambo Proxi !',
      paragraphs: [
        'Votre inscription est enregistrée. Vos prochaines demandes seront plus rapides et mieux suivies.',
        'Découvrez dès maintenant nos services, à Douala et environs.',
      ],
      buttonLabel: 'Découvrir nos services',
    },
    'application-received': {
      subject: 'Votre candidature est bien arrivée',
      preheader: null,
      title: 'Merci {prénom} pour votre candidature',
      paragraphs: ['Nous étudions votre candidature « {offre} » et revenons vers vous sous 15 jours.'],
      buttonLabel: null,
    },
    'training-request-received': {
      subject: 'Votre demande de formation {référence}',
      preheader: null,
      title: 'Merci {prénom}, nous préparons votre formation',
      paragraphs: [
        'Votre demande pour « {formation} » est enregistrée. Nous vous proposons un programme sous 48 h.',
      ],
      buttonLabel: null,
    },
    'partner-request-received': {
      subject: 'Votre demande de partenariat',
      preheader: null,
      title: 'Merci {prénom} pour votre intérêt',
      paragraphs: ['Nous étudions votre proposition et revenons vers vous rapidement.'],
      buttonLabel: null,
    },
    'event-registration': {
      subject: 'Votre inscription à « {événement} »',
      preheader: null,
      title: 'À bientôt {prénom} !',
      paragraphs: ['Votre place pour « {événement} » le {date} est réservée.'],
      buttonLabel: null,
    },
    'appointment-received': {
      subject: 'Votre demande de rendez-vous {référence}',
      preheader: null,
      title: 'Merci {prénom}, nous confirmons votre créneau',
      paragraphs: ['Nous revenons vers vous rapidement pour confirmer le rendez-vous du {date}.'],
      buttonLabel: null,
    },
    'appointment-confirmed': {
      subject: 'Votre rendez-vous du {date} est confirmé',
      preheader: null,
      title: 'Votre rendez-vous est confirmé.',
      paragraphs: ['Nous avons hâte d’échanger avec vous. Vous recevrez un rappel la veille.'],
      buttonLabel: 'Ajouter à mon agenda',
    },
    'appointment-proposed': {
      subject: 'Un nouveau créneau vous est proposé',
      preheader: null,
      title: '{prénom}, ce créneau vous convient-il ?',
      paragraphs: ['Nous vous proposons le {date}. Confirmez-le ou choisissez-en un autre.'],
      buttonLabel: 'Répondre',
    },
    'appointment-cancelled': {
      subject: 'Votre rendez-vous du {date} est annulé',
      preheader: null,
      title: 'Rendez-vous annulé',
      paragraphs: ['Votre rendez-vous du {date} est annulé. Vous pouvez en reprendre un à tout moment.'],
      buttonLabel: null,
    },
    'appointment-reminder': {
      subject: 'Rappel : rendez-vous demain',
      preheader: null,
      title: 'À demain, {prénom}',
      paragraphs: ['Nous vous rappelons votre rendez-vous du {date} pour « {service} ».'],
      buttonLabel: null,
    },
    'survey-invitation': {
      subject: 'Comment s’est passée votre prestation ?',
      preheader: null,
      title: 'Votre avis compte, {prénom}.',
      paragraphs: [
        'Votre prestation « {service} » du {date} est terminée. Pouvez-vous nous dire comment elle s’est passée ? 5 questions, 2 minutes.',
      ],
      buttonLabel: 'Donner mon avis',
    },
    'survey-reminder': {
      subject: 'Il n’est pas trop tard pour donner votre avis',
      preheader: null,
      title: 'Un instant, {prénom} ?',
      paragraphs: ['Votre retour sur « {service} » nous aide à progresser.'],
      buttonLabel: 'Donner mon avis',
    },
    'newsletter-confirm': {
      subject: 'Confirmez votre inscription à la newsletter',
      preheader: null,
      title: 'Plus qu’un clic',
      paragraphs: ['Confirmez votre adresse pour recevoir la newsletter de Mambo Proxi.'],
      buttonLabel: 'Confirmer mon inscription',
    },
    'newsletter-campaign': {
      subject: '{objet}',
      preheader: null,
      title: 'Mambo Proxi',
      paragraphs: ['Vous recevez cet e-mail car vous êtes inscrit·e à la newsletter de Mambo Proxi.'],
      buttonLabel: null,
    },
    'team-new-request': {
      subject: 'Nouvelle demande {référence} · {service}',
      preheader: null,
      title: 'Nouvelle demande de {nom}',
      paragraphs: ['{nom} demande « {service} » à {quartier}.', 'Ouvrez la demande pour la qualifier.'],
      buttonLabel: 'Ouvrir la demande',
    },
    'team-assignment': {
      subject: '{référence} vous est assignée · {service}',
      preheader: null,
      title: 'Une demande vous est assignée',
      paragraphs: ['{nom} demande « {service} ».', 'Ouvrez la demande pour la prendre en charge.'],
      buttonLabel: 'Ouvrir la demande',
    },
    'user-invite': {
      subject: 'Votre accès au back-office Mambo Proxi',
      preheader: null,
      title: 'Bienvenue dans l’équipe, {prénom}',
      paragraphs: [
        'Vous êtes invité·e à rejoindre le back-office de Mambo Proxi. Le lien est valable 7 jours.',
      ],
      buttonLabel: 'Activer mon accès',
    },
    'otp-code': {
      subject: 'Votre code de connexion : {code}',
      preheader: null,
      title: 'Votre code de connexion',
      paragraphs: ['Saisissez le code {code}. Il expire dans 10 minutes.'],
      buttonLabel: null,
    },
    'password-reset': {
      subject: 'Réinitialisez votre mot de passe',
      preheader: null,
      title: 'Nouveau mot de passe',
      paragraphs: ['Choisissez un nouveau mot de passe. Le lien est valable 1 heure.'],
      buttonLabel: 'Choisir un mot de passe',
    },
  },
  en: {
    'quote-ack': {
      subject: 'We have received your request {référence}',
      preheader: null,
      title: 'Hello {prénom}, we have received your request.',
      paragraphs: [
        'Thank you for your trust. An advisor is reviewing your needs and will send you a personalised quote within 24 hours.',
      ],
      buttonLabel: 'Message my advisor on WhatsApp',
    },
    'contact-ack': {
      subject: 'Your message has arrived',
      preheader: null,
      title: 'Thank you {prénom} for your message',
      paragraphs: ['We will reply as soon as possible, usually within the day.'],
      buttonLabel: null,
    },
    'registration-confirmed': {
      subject: 'Welcome to Mambo Proxi',
      preheader: null,
      title: 'Welcome to Mambo Proxi!',
      paragraphs: [
        'Your registration is saved. Your next requests will be faster and better followed up.',
        'Discover our services now, in Douala and the surrounding area.',
      ],
      buttonLabel: 'Discover our services',
    },
    'application-received': {
      subject: 'Your application has arrived',
      preheader: null,
      title: 'Thank you {prénom} for your application',
      paragraphs: ['We are reviewing your application “{offre}” and will get back to you within 15 days.'],
      buttonLabel: null,
    },
    'training-request-received': {
      subject: 'Your training request {référence}',
      preheader: null,
      title: 'Thank you {prénom}, we are preparing your training',
      paragraphs: [
        'Your request for “{formation}” is registered. We will send you a programme within 48 hours.',
      ],
      buttonLabel: null,
    },
    'partner-request-received': {
      subject: 'Your partnership request',
      preheader: null,
      title: 'Thank you {prénom} for your interest',
      paragraphs: ['We are reviewing your proposal and will get back to you shortly.'],
      buttonLabel: null,
    },
    'event-registration': {
      subject: 'Your registration for “{événement}”',
      preheader: null,
      title: 'See you soon {prénom}!',
      paragraphs: ['Your place for “{événement}” on {date} is booked.'],
      buttonLabel: null,
    },
    'appointment-received': {
      subject: 'Your appointment request {référence}',
      preheader: null,
      title: 'Thank you {prénom}, we are confirming your slot',
      paragraphs: ['We will get back to you shortly to confirm the appointment on {date}.'],
      buttonLabel: null,
    },
    'appointment-confirmed': {
      subject: 'Your appointment on {date} is confirmed',
      preheader: null,
      title: 'Your appointment is confirmed.',
      paragraphs: ['We look forward to talking with you. You will receive a reminder the day before.'],
      buttonLabel: 'Add to my calendar',
    },
    'appointment-proposed': {
      subject: 'A new time slot is proposed to you',
      preheader: null,
      title: '{prénom}, does this slot suit you?',
      paragraphs: ['We suggest {date}. Confirm it or choose another one.'],
      buttonLabel: 'Reply',
    },
    'appointment-cancelled': {
      subject: 'Your appointment on {date} is cancelled',
      preheader: null,
      title: 'Appointment cancelled',
      paragraphs: ['Your appointment on {date} is cancelled. You can book a new one at any time.'],
      buttonLabel: null,
    },
    'appointment-reminder': {
      subject: 'Reminder: appointment tomorrow',
      preheader: null,
      title: 'See you tomorrow, {prénom}',
      paragraphs: ['This is a reminder of your appointment on {date} for “{service}”.'],
      buttonLabel: null,
    },
    'survey-invitation': {
      subject: 'How did your service go?',
      preheader: null,
      title: 'Your opinion matters, {prénom}.',
      paragraphs: [
        'Your “{service}” service on {date} is complete. Could you tell us how it went? 5 questions, 2 minutes.',
      ],
      buttonLabel: 'Give my opinion',
    },
    'survey-reminder': {
      subject: 'It is not too late to give your opinion',
      preheader: null,
      title: 'Just a moment, {prénom}?',
      paragraphs: ['Your feedback on “{service}” helps us improve.'],
      buttonLabel: 'Give my opinion',
    },
    'newsletter-confirm': {
      subject: 'Confirm your newsletter subscription',
      preheader: null,
      title: 'Just one more click',
      paragraphs: ['Confirm your address to receive the Mambo Proxi newsletter.'],
      buttonLabel: 'Confirm my subscription',
    },
    'newsletter-campaign': {
      subject: '{objet}',
      preheader: null,
      title: 'Mambo Proxi',
      paragraphs: ['You are receiving this e-mail because you subscribed to the Mambo Proxi newsletter.'],
      buttonLabel: null,
    },
    'team-new-request': {
      subject: 'New request {référence} · {service}',
      preheader: null,
      title: 'New request from {nom}',
      paragraphs: ['{nom} is requesting “{service}” in {quartier}.', 'Open the request to qualify it.'],
      buttonLabel: 'Open the request',
    },
    'team-assignment': {
      subject: '{référence} is assigned to you · {service}',
      preheader: null,
      title: 'A request is assigned to you',
      paragraphs: ['{nom} is requesting “{service}”.', 'Open the request to handle it.'],
      buttonLabel: 'Open the request',
    },
    'user-invite': {
      subject: 'Your access to the Mambo Proxi back office',
      preheader: null,
      title: 'Welcome to the team, {prénom}',
      paragraphs: ['You are invited to join the Mambo Proxi back office. The link is valid for 7 days.'],
      buttonLabel: 'Activate my access',
    },
    'otp-code': {
      subject: 'Your sign-in code: {code}',
      preheader: null,
      title: 'Your sign-in code',
      paragraphs: ['Enter the code {code}. It expires in 10 minutes.'],
      buttonLabel: null,
    },
    'password-reset': {
      subject: 'Reset your password',
      preheader: null,
      title: 'New password',
      paragraphs: ['Choose a new password. The link is valid for 1 hour.'],
      buttonLabel: 'Choose a password',
    },
  },
};
