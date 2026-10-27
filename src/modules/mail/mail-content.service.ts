import { Inject, Injectable } from '@nestjs/common';
import { localize, localizeFields, translationFor } from '../../common/i18n/translations.js';
import { asObject, readNullableString, type JsonObject } from '../../common/json/json-read.js';
import { AppConfigService } from '../../config/app-config.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { DEFAULT_CONTENTS, type MailContent } from './default-contents.js';
import { formatPhone } from './mail-format.js';
import type { MailContext } from './mail-view.js';
import { ESSENTIAL_TEMPLATES, type MailLang, type MailTemplateKey } from './mail.types.js';

export interface ResolvedTemplate {
  /** `false` : modèle désactivé dans le back-office (jamais pour les modèles indispensables). */
  enabled: boolean;
  content: MailContent;
  source: 'database' | 'default';
}

/** Expéditeur et coordonnées de l'agence (groupes `site`, `coordonnees`, `whatsapp`, `emails` des paramètres). */
export interface MailSettings {
  context: MailContext;
  /** Nom d'expéditeur (`emails.senderName`) ; l'adresse reste celle de `MAIL_FROM` (SPF/DKIM). */
  senderName: string | undefined;
  replyTo: string | undefined;
}

const TRANSLATABLE_FIELDS = ['subject', 'preheader', 'title', 'paragraphs', 'buttonLabel'] as const;
const SETTING_GROUPS = ['site', 'coordonnees', 'whatsapp', 'emails'] as const;

/**
 * Contenu des e-mails lu en base : modèle modifiable dans le back-office (`email_templates`, contrat
 * `EmailTemplateFields`) et paramètres de l'agence. Lu à chaque envoi : une modification s'applique aussitôt.
 */
@Injectable()
export class MailContentService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AppConfigService) private readonly config: AppConfigService,
  ) {}

  /**
   * Textes du modèle dans la langue demandée. Anglais : la traduction du modèle (`translations.en`, complétée champ
   * par champ par le français) ; sans traduction en base, les textes anglais par défaut. Modèle absent : textes
   * par défaut.
   */
  async getTemplate(key: MailTemplateKey, lang: MailLang): Promise<ResolvedTemplate> {
    const row = await this.prisma.emailTemplate.findUnique({
      where: { key },
      select: {
        subject: true,
        preheader: true,
        title: true,
        paragraphs: true,
        buttonLabel: true,
        enabled: true,
        translations: true,
      },
    });
    if (row === null) return { enabled: true, content: DEFAULT_CONTENTS[lang][key], source: 'default' };

    const french: MailContent = {
      subject: row.subject,
      preheader: row.preheader,
      title: row.title,
      paragraphs: row.paragraphs,
      buttonLabel: row.buttonLabel,
    };
    const content =
      lang === 'fr'
        ? french
        : translationFor(row.translations, lang) === undefined
          ? DEFAULT_CONTENTS[lang][key]
          : localizeFields(french, row.translations, lang, TRANSLATABLE_FIELDS);
    return { enabled: row.enabled || ESSENTIAL_TEMPLATES.has(key), content, source: 'database' };
  }

  async getSettings(lang: MailLang): Promise<MailSettings> {
    const rows = await this.prisma.setting.findMany({
      where: { key: { in: [...SETTING_GROUPS] } },
      select: { key: true, value: true, translations: true },
    });
    const groups: Record<string, JsonObject> = {};
    for (const row of rows) groups[row.key] = asObject(localize(row.value, row.translations, lang));
    const site = groups['site'] ?? {};
    const contacts = groups['coordonnees'] ?? {};
    const agency = asObject(contacts['agency']);
    const whatsapp = groups['whatsapp'] ?? {};
    const emails = groups['emails'] ?? {};

    const phone =
      readNullableString(contacts, 'phoneCameroon') ?? readNullableString(contacts, 'phoneFrance');
    const phoneDisplay =
      readNullableString(contacts, 'phoneCameroonDisplay') ??
      readNullableString(agency, 'phoneDisplay') ??
      readNullableString(contacts, 'phoneFranceDisplay') ??
      formatPhone(phone ?? undefined);
    const whatsappEnabled = whatsapp['enabled'] !== false;
    const whatsappNumber = whatsappEnabled
      ? (readNullableString(whatsapp, 'number') ?? undefined)
      : undefined;

    return {
      context: {
        webUrl: this.config.get('WEB_URL').replace(/\/+$/, ''),
        siteName: readNullableString(site, 'siteName') ?? 'MAMBO Proxi',
        tagline: readNullableString(site, 'tagline') ?? undefined,
        email: readNullableString(contacts, 'email') ?? undefined,
        phoneDisplay: phoneDisplay ?? undefined,
        whatsappNumber,
        whatsappDisplay: whatsappEnabled
          ? (readNullableString(whatsapp, 'numberDisplay') ?? formatPhone(whatsappNumber))
          : undefined,
      },
      senderName: readNullableString(emails, 'senderName') ?? undefined,
      replyTo: readNullableString(emails, 'replyTo') ?? readNullableString(contacts, 'email') ?? undefined,
    };
  }
}
