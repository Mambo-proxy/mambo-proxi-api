import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { frenchErrorMap, issuesToProblemErrors } from '../../common/validation/zod-issues.js';
import { submissionMailJobs, type TeamAlert } from './forms.mail.js';
import {
  acceptedMessage,
  formatDoualaDateTime,
  formatNeed,
  missingRequiredNeeds,
  quoteRequestFields,
  readQuoteFields,
  resolveLang,
  teamRecipients,
  type QuoteFieldDefinition,
} from './forms.mapper.js';
import {
  CONSENT_MESSAGE,
  quoteRequestInputSchema,
  registrationInputSchema,
  trainingRequestInputSchema,
} from './forms.schemas.js';

const DEFINITIONS: QuoteFieldDefinition[] = [
  { name: 'eventDate', label: 'Date souhaitée', type: 'date', required: false },
  { name: 'city', label: 'Ville', type: 'city', required: true },
  { name: 'guests', label: 'Nombre de personnes', type: 'number', required: false },
  { name: 'options', label: 'Options', type: 'chips', required: false },
];

const ANTI_SPAM = {
  turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX',
  honeypot: '',
  startedAt: '2026-10-05T08:09:30.000Z',
};

describe('readQuoteFields', () => {
  it('lit les champs dynamiques valides de la rubrique', () => {
    expect(
      readQuoteFields([
        { name: 'city', label: 'Ville', type: 'city', required: true, width: 'half' },
        { label: 'Sans nom' },
        'invalide',
      ]),
    ).toEqual([{ name: 'city', label: 'Ville', type: 'city', required: true }]);
    expect(readQuoteFields(null)).toEqual([]);
  });
});

describe('missingRequiredNeeds', () => {
  it('signale les champs obligatoires vides sur needs.<name>', () => {
    expect(missingRequiredNeeds(DEFINITIONS, { city: '  ' })).toEqual([
      { path: 'needs.city', code: 'required', message: 'Ce champ est obligatoire.' },
    ]);
    expect(missingRequiredNeeds(DEFINITIONS, { city: 'Douala' })).toEqual([]);
  });
});

describe('formatNeed', () => {
  it('met en forme dates, nombres et listes', () => {
    expect(formatNeed(DEFINITIONS[0], '2026-11-14')).toBe('14 novembre 2026');
    expect(formatNeed(DEFINITIONS[2], 12)).toBe('12');
    expect(formatNeed(DEFINITIONS[3], ['Végétarien', ' ', 'Sans gluten'])).toBe('Végétarien, Sans gluten');
    expect(formatNeed(DEFINITIONS[1], '')).toBeNull();
    expect(formatNeed(undefined, null)).toBeNull();
  });
});

describe('quoteRequestFields', () => {
  it('liste rubrique, service, champs renseignés dans l’ordre de la rubrique et préférence de contact', () => {
    const fields = quoteRequestFields(
      'Expérience',
      'Chef privé',
      DEFINITIONS,
      { guests: 12, city: 'Douala', eventDate: '2026-11-14', unknown: 'ignoré' },
      'WHATSAPP',
    );

    expect(fields).toEqual([
      { key: 'rubrique', label: 'Rubrique', value: 'Expérience' },
      { key: 'service', label: 'Service', value: 'Chef privé' },
      { key: 'eventDate', label: 'Date souhaitée', value: '14 novembre 2026' },
      { key: 'city', label: 'Ville', value: 'Douala' },
      { key: 'guests', label: 'Nombre de personnes', value: '12' },
      { key: 'preference.contact', label: 'Préférence de contact', value: 'WhatsApp' },
    ]);
  });
});

describe('resolveLang', () => {
  it('préfère lang du corps, puis Accept-Language, puis le français', () => {
    expect(resolveLang('en', 'fr-FR')).toBe('en');
    expect(resolveLang(undefined, 'en-GB,en;q=0.9,fr;q=0.8')).toBe('en');
    expect(resolveLang(undefined, 'de-DE,fr;q=0.5')).toBe('fr');
    expect(resolveLang(undefined, 'de-DE')).toBe('fr');
    expect(resolveLang(undefined, undefined)).toBe('fr');
  });
});

describe('acceptedMessage', () => {
  it('reprend le message du contrat pour un devis', () => {
    expect(acceptedMessage('quote', 'fr')).toBe(
      'Merci, votre demande est bien envoyée ! Vous recevrez un e-mail de confirmation dans quelques instants.',
    );
  });
});

describe('formatDoualaDateTime', () => {
  it('affiche la date à l’heure de Douala', () => {
    expect(formatDoualaDateTime(new Date('2026-11-14T18:00:00.000Z'))).toMatch(
      /^samedi 14 novembre 2026 .*19:00$/,
    );
  });
});

describe('teamRecipients', () => {
  it('prend les destinataires des paramètres e-mails, sans doublon', () => {
    expect(
      teamRecipients(
        {
          teamRecipients: [
            'equipe.douala@mamboproxi.com',
            'Mireille@mamboproxi.com',
            'mireille@mamboproxi.com',
          ],
        },
        { email: 'contact@mamboproxi.com' },
      ),
    ).toEqual(['equipe.douala@mamboproxi.com', 'mireille@mamboproxi.com']);
  });

  it('se replie sur l’adresse de contact de l’agence', () => {
    expect(teamRecipients({ teamRecipients: [] }, { email: 'contact@mamboproxi.com' })).toEqual([
      'contact@mamboproxi.com',
    ]);
    expect(teamRecipients(undefined, undefined)).toEqual([]);
  });
});

describe('submissionMailJobs', () => {
  it('produit l’accusé de réception puis une alerte en français par destinataire', () => {
    const alert: TeamAlert = {
      requestId: 'req_1',
      type: 'DEVIS',
      subject: 'Chef privé',
      serviceName: 'Chef privé',
      contact: {
        fullName: 'Aurélie Kamga',
        email: 'aurelie.k@example.com',
        phone: '+237612345678',
        country: 'CM',
        city: 'Bonapriso, Douala',
      },
      fields: [{ key: 'rubrique', label: 'Rubrique', value: 'Expérience' }],
      message: 'Dîner pour 12 personnes.',
      receivedAt: new Date('2026-10-26T09:00:00.000Z'),
      dueAt: new Date('2026-10-27T09:00:00.000Z'),
      adminUrl: 'http://localhost:3000/admin/demandes?id=req_1',
    };
    const jobs = submissionMailJobs(
      'MP-2026-0143',
      {
        template: 'quote-ack',
        to: 'aurelie.k@example.com',
        lang: 'en',
        data: { firstName: 'Aurélie', fullName: 'Aurélie Kamga', reference: 'MP-2026-0143', receivedAt: 'x' },
      },
      alert,
      ['equipe@mamboproxi.com', 'mireille@mamboproxi.com'],
    );

    expect(jobs.map((job) => [job.template, job.to, job.lang, job.reference])).toEqual([
      ['quote-ack', 'aurelie.k@example.com', 'en', 'MP-2026-0143'],
      ['team-new-request', 'equipe@mamboproxi.com', 'fr', 'MP-2026-0143'],
      ['team-new-request', 'mireille@mamboproxi.com', 'fr', 'MP-2026-0143'],
    ]);
    expect(jobs[1]?.data).toMatchObject({
      reference: 'MP-2026-0143',
      requestType: 'DEVIS',
      requestTypeLabel: 'Demande de devis',
      fullName: 'Aurélie Kamga',
      quarterName: 'Bonapriso',
      requestId: 'req_1',
      receivedAt: '2026-10-26T09:00:00.000Z',
      dueAt: '2026-10-27T09:00:00.000Z',
      adminUrl: 'http://localhost:3000/admin/demandes?id=req_1',
    });
  });
});

describe('schémas des formulaires', () => {
  function errorsOf(schema: z.ZodType, value: unknown) {
    const result = schema.safeParse(value, { error: frenchErrorMap, reportInput: true });
    return result.success ? [] : issuesToProblemErrors(result.error.issues);
  }

  it('accepte l’exemple du contrat (devis « Chef privé ») et normalise l’e-mail', () => {
    const result = quoteRequestInputSchema.safeParse({
      categorySlug: 'experience',
      serviceSlug: 'chef-prive',
      needs: { eventDate: '2026-11-14', city: 'Douala', guests: 12, occasion: 'Anniversaire' },
      description: 'Dîner pour les 60 ans de ma mère, cuisine camerounaise revisitée, un invité végétarien.',
      contact: {
        fullName: 'Aurélie Kamga',
        email: ' Aurelie.K@example.com ',
        phone: '+237612345678',
        country: 'CM',
        city: 'Bonapriso, Douala',
      },
      contactPreference: 'WHATSAPP',
      consent: true,
      antiSpam: ANTI_SPAM,
    });
    expect(result.success).toBe(true);
    expect(result.data?.contact.email).toBe('aurelie.k@example.com');
  });

  it('signale e-mail invalide et consentement manquant avec les textes du contrat', () => {
    const errors = errorsOf(quoteRequestInputSchema, {
      categorySlug: 'experience',
      needs: {},
      description: 'Une description suffisamment longue.',
      contact: { fullName: 'Aurélie Kamga', email: 'pas-un-email', phone: '+237612345678', country: 'CM' },
      contactPreference: 'EMAIL',
      antiSpam: ANTI_SPAM,
    });

    expect(errors).toEqual([
      { path: 'contact.email', code: 'invalid_email', message: 'Saisissez une adresse e-mail valide.' },
      { path: 'consent', code: 'required', message: CONSENT_MESSAGE },
    ]);
  });

  it('exige structure et activité d’un professionnel', () => {
    const errors = errorsOf(registrationInputSchema, {
      profile: 'PROFESSIONNEL',
      firstName: 'Paul',
      lastName: 'Ekotto',
      email: 'paul@example.com',
      phone: '+33600000000',
      consent: true,
      antiSpam: ANTI_SPAM,
    });

    expect(errors.map((error) => [error.path, error.code])).toEqual([
      ['organization', 'required'],
      ['activity', 'required'],
    ]);
  });

  it('exige la précision d’une formation « autre »', () => {
    const errors = errorsOf(trainingRequestInputSchema, {
      trainingSlug: 'autre',
      participants: 3,
      contact: { fullName: 'Paul Ekotto', email: 'paul@example.com', phone: '+33600000000' },
      consent: true,
      antiSpam: ANTI_SPAM,
    });

    expect(errors).toEqual([
      { path: 'otherTraining', code: 'required', message: 'Précisez la formation souhaitée.' },
    ]);
  });
});
