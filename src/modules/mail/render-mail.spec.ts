import { describe, expect, it } from 'vitest';
import { DEFAULT_CONTENTS } from './default-contents.js';
import { MAIL_TEMPLATE_KEYS, type MailLang, type MailTemplateKey } from './mail.types.js';
import { MailDataError, renderMail, type RenderMailInput } from './render-mail.js';
import { SAMPLE_DATA, sampleContext } from './templates/sample-data.js';

function input(
  template: MailTemplateKey,
  lang: MailLang = 'fr',
  data: Record<string, unknown> = SAMPLE_DATA[template],
): RenderMailInput {
  return { template, lang, data, content: DEFAULT_CONTENTS[lang][template], context: sampleContext(lang) };
}

describe('renderMail — chaque gabarit', () => {
  for (const template of MAIL_TEMPLATE_KEYS) {
    for (const lang of ['fr', 'en'] as const) {
      it(`${template} (${lang}) : HTML et texte brut complets`, async () => {
        const rendered = await renderMail(input(template, lang));

        expect(rendered.subject).not.toMatch(/[{}]/);
        expect(rendered.subject).not.toBe('');
        expect(rendered.html).toMatch(new RegExp(`<html[^>]*lang="${lang}"`));
        expect(rendered.html).toContain('https://mamboproxi.com/brand/logo-horizontal.png');
        expect(rendered.html).toContain('alt="MAMBO Proxi"');
        expect(rendered.html).toContain(lang === 'fr' ? 'L’équipe MAMBO Proxi' : 'The MAMBO Proxi team');
        expect(rendered.html).toContain('+237 6 00 00 00 00');
        expect(rendered.html).not.toMatch(/\{[\p{L}]+\}/u);
        expect(rendered.text).not.toMatch(/\{[\p{L}]+\}/u);
        expect(rendered.text).toContain('contact@mamboproxi.com');
        if (rendered.view.title !== null) {
          expect(rendered.text.startsWith(rendered.view.title)).toBe(true);
        }
        for (const row of rendered.view.summary) expect(rendered.text).toContain(row.value);
        if (rendered.view.button !== null) expect(rendered.text).toContain(rendered.view.button.url);
      });
    }
  }
});

describe('renderMail — contenus attendus', () => {
  it('accusé de réception du devis : titre, récapitulatif et bouton WhatsApp avec la référence', async () => {
    const rendered = await renderMail(input('quote-ack'));

    expect(rendered.subject).toBe('Nous avons bien reçu votre demande MP-2026-0142');
    expect(rendered.view.title).toBe('Bonjour Aurélie, nous avons bien reçu votre demande.');
    expect(rendered.view.summary).toEqual([
      { label: 'Référence', value: 'MP-2026-0142' },
      { label: 'Service', value: 'Chef privé' },
      { label: 'Date souhaitée', value: 'Samedi 14 novembre 2026' },
      { label: 'Ville', value: 'Douala' },
    ]);
    expect(rendered.view.button?.label).toBe('Écrire à mon conseiller sur WhatsApp');
    expect(rendered.view.button?.url).toMatch(/^https:\/\/wa\.me\/237600000000\?text=.*MP-2026-0142/);
    expect(rendered.text).toContain('Référence : MP-2026-0142');
    expect(rendered.view.notice).toBe('Vous recevez cet e-mail suite à votre demande sur mamboproxi.com.');
  });

  it('confirmation de rendez-vous : carte du rendez-vous à l’heure de Douala et lien d’agenda', async () => {
    const rendered = await renderMail(input('appointment-confirmed'));

    expect(rendered.subject).toBe('Votre rendez-vous du jeudi 12 novembre 2026 à 14:00 est confirmé');
    expect(rendered.view.summary).toEqual([
      { label: 'Motif', value: 'Immobilier' },
      { label: 'Date', value: 'Jeudi 12 novembre 2026' },
      { label: 'Heure', value: '14:00 (heure de Douala)' },
      { label: 'Format', value: 'Visio · lien envoyé la veille' },
    ]);
    expect(rendered.view.button?.url).toMatch(/^https:\/\/calendar\.google\.com\/calendar\/render\?/);
  });

  it('invitation au questionnaire : étoiles et bouton vers le questionnaire', async () => {
    const rendered = await renderMail(input('survey-invitation'));

    expect(rendered.view.title).toBe('Votre avis compte, Aurélie.');
    expect(rendered.view.ratingUrl).toBe('https://mamboproxi.com/questionnaire/exemple');
    expect(rendered.html).toContain('☆ ☆ ☆ ☆ ☆');
    expect(rendered.view.button).toEqual({
      label: 'Donner mon avis',
      url: 'https://mamboproxi.com/questionnaire/exemple',
    });
  });

  it('inscription confirmée : bouton vers les services, localisé en anglais', async () => {
    expect((await renderMail(input('registration-confirmed'))).view.button?.url).toBe(
      'https://mamboproxi.com/services',
    );
    expect((await renderMail(input('registration-confirmed', 'en'))).view.button?.url).toBe(
      'https://mamboproxi.com/en/services',
    );
  });

  it('code de connexion : code en grand, dans l’objet et le texte', async () => {
    const rendered = await renderMail(input('otp-code'));

    expect(rendered.subject).toBe('Votre code de connexion : 482913');
    expect(rendered.view.code).toBe('482913');
    expect(rendered.text).toContain('482913');
    expect(rendered.view.notice).toMatch(/^E-mail de sécurité/);
  });

  it('campagne : corps HTML avec prénom échappé et lien de désinscription', async () => {
    const rendered = await renderMail(
      input('newsletter-campaign', 'fr', {
        ...SAMPLE_DATA['newsletter-campaign'],
        firstName: '<b>Aurélie</b>',
      }),
    );

    expect(rendered.subject).toBe('Les nouveautés de novembre');
    expect(rendered.view.title).toBeNull();
    expect(rendered.html).toContain('Bonjour &lt;b&gt;Aurélie&lt;/b&gt;,');
    expect(rendered.html).toContain('https://mamboproxi.com/newsletter/desinscription?token=exemple');
    expect(rendered.text).toContain(
      'Se désinscrire : https://mamboproxi.com/newsletter/desinscription?token=exemple',
    );
    expect(rendered.text).toContain('Voir les services (https://mamboproxi.com/services)');
  });

  it('alerte équipe : accepte les données des formulaires publics (contactName, fields, adminUrl…)', async () => {
    const rendered = await renderMail(
      input('team-new-request', 'fr', {
        reference: 'MP-2026-0150',
        requestTypeLabel: 'Demande de devis',
        subject: 'Chef privé',
        contactName: 'Paul Ekambi',
        contactEmail: 'paul@example.com',
        contactPhone: '+237699000000',
        contactCity: 'Douala',
        fields: [{ key: 'guests', label: 'Nombre de convives', value: '6' }],
        message: null,
        adminUrl: 'https://mamboproxi.com/admin/demandes?id=req_1',
      }),
    );

    expect(rendered.subject).toBe('Nouvelle demande MP-2026-0150 · Chef privé');
    expect(rendered.view.title).toBe('Nouvelle demande de Paul Ekambi');
    expect(rendered.view.paragraphs[0]).toBe('Paul Ekambi demande « Chef privé » à Douala.');
    expect(rendered.view.summary).toContainEqual({ label: 'Nombre de convives', value: '6' });
    expect(rendered.view.summary).toContainEqual({ label: 'Téléphone', value: '+237 6 99 00 00 00' });
    expect(rendered.view.button?.url).toBe('https://mamboproxi.com/admin/demandes?id=req_1');
  });

  it('formulaires publics : alias de l’événement et de la formation, rubrique à défaut de service', async () => {
    const event = await renderMail(
      input('event-registration', 'fr', {
        firstName: 'Paul',
        eventTitle: 'Soirée jazz',
        eventStartsAt: '2026-12-05T18:00:00.000Z',
        eventCity: 'Douala',
        eventPlace: null,
        seats: 2,
      }),
    );
    expect(event.subject).toBe('Votre inscription à « Soirée jazz »');
    expect(event.view.summary).toContainEqual({ label: 'Lieu', value: 'Douala' });

    const training = await renderMail(
      input('training-request-received', 'fr', { firstName: 'Paul', trainingTitle: 'Accueil client' }),
    );
    expect(training.view.paragraphs[0]).toContain('« Accueil client »');

    const quote = await renderMail(
      input('quote-ack', 'fr', {
        firstName: 'Paul',
        reference: 'MP-2026-0151',
        categoryName: 'Immobilier',
        serviceName: null,
      }),
    );
    // Sans service, la rubrique le remplace dans le récapitulatif.
    expect(quote.view.summary).toContainEqual({ label: 'Service', value: 'Immobilier' });
  });

  it('échappe les données saisies par l’internaute dans le HTML', async () => {
    const rendered = await renderMail(
      input('quote-ack', 'fr', { ...SAMPLE_DATA['quote-ack'], firstName: '<script>alert("x")</script>' }),
    );

    expect(rendered.html).not.toContain('<script>');
    expect(rendered.html).toContain('&lt;script&gt;');
  });

  it('n’accepte pas un lien autre que http(s)', async () => {
    await expect(
      renderMail(input('password-reset', 'fr', { actionUrl: 'javascript:alert(1)' })),
    ).rejects.toBeInstanceOf(MailDataError);
  });

  it('refuse une tâche sans les données obligatoires', async () => {
    await expect(renderMail(input('otp-code', 'fr', {}))).rejects.toThrow(
      "Données manquantes pour l'e-mail « otp-code » : code.",
    );
  });

  it('retire le bouton quand le modèle n’a pas de libellé', async () => {
    const rendered = await renderMail({
      ...input('quote-ack'),
      content: { ...DEFAULT_CONTENTS.fr['quote-ack'], buttonLabel: null },
    });

    expect(rendered.view.button).toBeNull();
  });
});
