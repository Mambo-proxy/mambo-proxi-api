import { createTransport } from 'nodemailer';
import { describe, expect, it, vi } from 'vitest';
import type { AppConfigService } from '../../config/app-config.service.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { MailContentService } from './mail-content.service.js';
import { MailRecorder } from './mail-recorder.service.js';
import { InvalidMailJobError, MailSender } from './mail-sender.service.js';
import type { MailJob } from './mail.types.js';
import { MailDataError } from './render-mail.js';
import { SAMPLE_DATA } from './templates/sample-data.js';

/** Paramètres du seed utiles aux e-mails. */
const SETTINGS = [
  {
    key: 'site',
    value: { siteName: 'MAMBO Proxi', tagline: 'Vos services, au plus près de vous' },
    translations: { en: { tagline: 'Your services, close at hand' } },
  },
  {
    key: 'coordonnees',
    value: {
      phoneCameroon: '+237600000000',
      email: 'contact@mamboproxi.com',
      agency: { phoneDisplay: '+237 6 00 00 00 00' },
    },
    translations: null,
  },
  { key: 'whatsapp', value: { enabled: true, number: '+237600000000' }, translations: null },
  {
    key: 'emails',
    value: { senderName: 'MAMBO Proxi', replyTo: 'contact@mamboproxi.com' },
    translations: null,
  },
];

interface TemplateRow {
  subject: string;
  preheader: string | null;
  title: string;
  paragraphs: string[];
  buttonLabel: string | null;
  enabled: boolean;
  translations: unknown;
}

function setup(options: { template?: TemplateRow | null; requestId?: string | null } = {}) {
  const prisma = {
    emailTemplate: { findUnique: vi.fn().mockResolvedValue(options.template ?? null) },
    setting: { findMany: vi.fn().mockResolvedValue(SETTINGS) },
    request: {
      findUnique: vi.fn().mockResolvedValue(options.requestId ? { id: options.requestId } : null),
    },
    appointment: { findUnique: vi.fn().mockResolvedValue(null) },
    requestEvent: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({}) },
    campaignDelivery: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  };
  const env: Record<string, unknown> = {
    WEB_URL: 'https://mamboproxi.com/',
    MAIL_FROM: 'MAMBO Proxi <contact@mamboproxi.com>',
  };
  const config = { get: (key: string) => env[key] } as unknown as AppConfigService;
  // Transport Nodemailer sans réseau : le message construit est renvoyé en JSON.
  const transport = createTransport({ jsonTransport: true });
  const sendMail = vi.spyOn(transport, 'sendMail');
  const db = prisma as unknown as PrismaService;
  const sender = new MailSender(transport, new MailContentService(db, config), new MailRecorder(db), config);
  return { sender, prisma, sendMail };
}

interface JsonMessage {
  from: { address: string; name: string };
  to: Array<{ address: string }>;
  replyTo: Array<{ address: string }>;
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
}

async function sentMessage(sendMail: ReturnType<typeof setup>['sendMail']): Promise<JsonMessage> {
  const info = (await sendMail.mock.results[0]?.value) as { message: string };
  return JSON.parse(info.message) as JsonMessage;
}

const QUOTE_JOB: MailJob = {
  template: 'quote-ack',
  to: 'aurelie@example.com',
  lang: 'fr',
  data: SAMPLE_DATA['quote-ack'],
  reference: 'MP-2026-0142',
};

describe('MailSender', () => {
  it('envoie le HTML et le texte brut, avec expéditeur, réponse et en-têtes de suivi', async () => {
    const { sender, sendMail } = setup();

    const result = await sender.send(QUOTE_JOB);

    expect(result.status).toBe('sent');
    const message = await sentMessage(sendMail);
    expect(message.from).toEqual({ address: 'contact@mamboproxi.com', name: 'MAMBO Proxi' });
    expect(message.to).toEqual([{ address: 'aurelie@example.com', name: '' }]);
    expect(message.replyTo).toEqual([{ address: 'contact@mamboproxi.com', name: '' }]);
    expect(message.subject).toBe('Nous avons bien reçu votre demande MP-2026-0142');
    expect(message.html).toContain('Bonjour Aurélie, nous avons bien reçu votre demande.');
    expect(message.html).toContain('https://mamboproxi.com/brand/logo-horizontal.png');
    expect(message.text).toContain('Référence : MP-2026-0142');
    expect(message.headers).toMatchObject({
      'X-Mambo-Template': 'quote-ack',
      'X-Mambo-Reference': 'MP-2026-0142',
      'Auto-Submitted': 'auto-generated',
    });
    expect(message.headers).not.toHaveProperty('List-Unsubscribe');
  });

  it('utilise les textes du modèle en base, et sa traduction anglaise', async () => {
    const template: TemplateRow = {
      subject: 'Bien reçu {référence}',
      preheader: null,
      title: 'Bonjour {prénom}',
      paragraphs: ['Texte modifié dans le back-office.'],
      buttonLabel: null,
      enabled: true,
      translations: { en: { subject: 'Received {référence}', title: 'Hello {prénom}' } },
    };
    const fr = setup({ template });
    await fr.sender.send(QUOTE_JOB);
    const french = await sentMessage(fr.sendMail);
    expect(french.subject).toBe('Bien reçu MP-2026-0142');
    expect(french.text).toContain('Texte modifié dans le back-office.');

    const en = setup({ template });
    await en.sender.send({ ...QUOTE_JOB, lang: 'en' });
    const english = await sentMessage(en.sendMail);
    expect(english.subject).toBe('Received MP-2026-0142');
    expect(english.html).toContain('Hello Aurélie');
    // Paragraphe non traduit : repli sur le français, champ par champ.
    expect(english.text).toContain('Texte modifié dans le back-office.');
    expect(english.html).toMatch(/<html[^>]*lang="en"/);
  });

  it('n’envoie pas un modèle désactivé, sauf un e-mail de sécurité', async () => {
    const disabled = (subject: string): TemplateRow => ({
      subject,
      preheader: null,
      title: 'Titre',
      paragraphs: [],
      buttonLabel: null,
      enabled: false,
      translations: null,
    });
    const quote = setup({ template: disabled('Objet') });
    expect(await quote.sender.send(QUOTE_JOB)).toEqual({ status: 'skipped' });
    expect(quote.sendMail).not.toHaveBeenCalled();

    const otp = setup({ template: disabled('Code {code}') });
    const result = await otp.sender.send({
      template: 'otp-code',
      to: 'mireille@mamboproxi.com',
      lang: 'fr',
      data: { code: '123456' },
    });
    expect(result.status).toBe('sent');
    expect((await sentMessage(otp.sendMail)).subject).toBe('Code 123456');
  });

  it('ajoute la désinscription en un clic à une campagne et en note l’envoi', async () => {
    const { sender, sendMail, prisma } = setup();

    await sender.send({
      template: 'newsletter-campaign',
      to: 'aurelie@example.com',
      lang: 'fr',
      data: { ...SAMPLE_DATA['newsletter-campaign'], deliveryId: 'dlv_1' },
    });

    const message = await sentMessage(sendMail);
    expect(message.headers).toMatchObject({
      'List-Unsubscribe': '<https://api.mamboproxi.com/v1/newsletter/unsubscribe?token=exemple>',
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      Precedence: 'bulk',
    });
    expect(prisma.campaignDelivery.updateMany).toHaveBeenCalledWith({
      where: { id: 'dlv_1' },
      data: expect.objectContaining({ status: 'SENT', error: null }) as unknown,
    });
  });

  it('inscrit l’accusé de réception dans l’historique de la demande, une seule fois', async () => {
    const { sender, prisma } = setup({ requestId: 'req_0142' });

    await sender.send(QUOTE_JOB);

    expect(prisma.request.findUnique).toHaveBeenCalledWith({
      where: { reference: 'MP-2026-0142' },
      select: { id: true },
    });
    expect(prisma.requestEvent.create).toHaveBeenCalledWith({
      data: {
        requestId: 'req_0142',
        kind: 'ACK_SENT',
        data: { template: 'quote-ack', messageId: expect.any(String) as unknown },
      },
    });

    prisma.requestEvent.findFirst.mockResolvedValue({ id: 'evt_1' });
    await sender.send(QUOTE_JOB);
    expect(prisma.requestEvent.create).toHaveBeenCalledTimes(1);
  });

  it('n’échoue pas si l’enregistrement de l’envoi échoue (l’e-mail est parti)', async () => {
    const { sender, prisma } = setup({ requestId: 'req_0142' });
    prisma.requestEvent.create.mockRejectedValue(new Error('base indisponible'));

    await expect(sender.send(QUOTE_JOB)).resolves.toMatchObject({ status: 'sent' });
  });

  it('refuse une tâche invalide ou incomplète (erreurs définitives)', async () => {
    const { sender, sendMail } = setup();

    await expect(sender.send({ ...QUOTE_JOB, to: 'pas-une-adresse' })).rejects.toBeInstanceOf(
      InvalidMailJobError,
    );
    await expect(
      sender.send({ template: 'password-reset', to: 'mireille@mamboproxi.com', lang: 'fr', data: {} }),
    ).rejects.toBeInstanceOf(MailDataError);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('joint l’invitation d’agenda à la confirmation de rendez-vous', async () => {
    const { sender, sendMail } = setup();
    const ics = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR';

    await sender.send({
      template: 'appointment-confirmed',
      to: 'aurelie@example.com',
      lang: 'fr',
      data: { ...SAMPLE_DATA['appointment-confirmed'], ics },
    });

    expect(sendMail.mock.calls[0]?.[0]).toMatchObject({
      icalEvent: { filename: 'rendez-vous.ics', method: 'REQUEST', content: ics },
    });
  });
});
