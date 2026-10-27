import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { recordAudit, type AuditActor } from '../../common/audit/audit-log.js';
import { notFoundException, ProblemException, type ProblemFieldError } from '../../common/problem/problem.js';
import { nullableText } from '../../common/validation/content.schemas.js';
import { validationException } from '../../common/validation/validation-exception.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { DEFAULT_CONTENTS, type MailContent } from './default-contents.js';
import {
  TEMPLATE_ENTRIES,
  TEMPLATE_CATALOG,
  type TemplateAudience,
  type TemplateEntry,
} from './email-template-catalog.js';
import { normalizeVariableName, variablesIn } from './interpolate.js';
import { MailContentService } from './mail-content.service.js';
import { MailQueueService } from './mail-queue.service.js';
import { isMailTemplateKey, type MailTemplateKey } from './mail.types.js';
import { renderMail } from './render-mail.js';
import { SAMPLE_DATA } from './templates/sample-data.js';

export const EMAIL_TEMPLATE_NOT_FOUND = 'Ce modèle n’existe pas.';

/** Champs `EmailTemplateFields` du contrat (paragraphes vides retirés). */
const templateFieldsSchema = z.object({
  subject: z
    .string({ error: 'Indiquez l’objet de l’e-mail.' })
    .trim()
    .min(1, { error: 'Indiquez l’objet de l’e-mail.' })
    .max(150),
  preheader: nullableText(150),
  title: z.string({ error: 'Indiquez le titre.' }).trim().min(1, { error: 'Indiquez le titre.' }).max(150),
  paragraphs: z
    .array(z.string().trim().max(1500))
    .max(8, { error: '8 paragraphes au maximum.' })
    .transform((paragraphs) => paragraphs.filter((paragraph) => paragraph !== '')),
  buttonLabel: nullableText(60),
  enabled: z.boolean(),
});

/** `EmailTemplateInput` : au moins un champ (`PUT`). */
export const emailTemplateInputSchema = templateFieldsSchema
  .partial()
  .refine((input) => Object.values(input).some((value) => value !== undefined), {
    error: 'Aucune modification envoyée.',
  });
export type EmailTemplateInput = z.output<typeof emailTemplateInputSchema>;

/** Aperçu : contenu non enregistré facultatif (corps absent ou vide = modèle enregistré). */
export const emailPreviewInputSchema = z.preprocess(
  (value) => (value === undefined || value === null || value === '' ? {} : value),
  templateFieldsSchema.partial(),
);
export type EmailPreviewInput = z.output<typeof emailPreviewInputSchema>;

export const emailTestSchema = z.object({
  email: z.email({ error: 'Saisissez une adresse e-mail valide.' }).max(254),
});
export type EmailTestInput = z.output<typeof emailTestSchema>;

/** Schéma `EmailTemplate` du contrat. */
export interface EmailTemplate extends MailContent {
  key: MailTemplateKey;
  name: string;
  description: string;
  audience: TemplateAudience;
  enabled: boolean;
  canDisable: boolean;
  variables: string[];
  updatedAt: string;
}

/** Schéma `EmailPreview` du contrat. */
export interface EmailPreview {
  subject: string;
  html: string;
  text: string;
}

/** Date affichée pour un modèle jamais enregistré en base (textes par défaut). */
const NEVER_SAVED = new Date(0);

const templateSelect = {
  key: true,
  subject: true,
  preheader: true,
  title: true,
  paragraphs: true,
  buttonLabel: true,
  enabled: true,
  updatedAt: true,
} as const;

interface TemplateRow extends MailContent {
  key: string;
  enabled: boolean;
  updatedAt: Date;
}

function toEmailTemplate(entry: TemplateEntry, row: TemplateRow | undefined): EmailTemplate {
  const content = row ?? DEFAULT_CONTENTS.fr[entry.key];
  return {
    key: entry.key,
    name: entry.name,
    description: entry.description,
    audience: entry.audience,
    subject: content.subject,
    preheader: content.preheader,
    title: content.title,
    paragraphs: content.paragraphs,
    buttonLabel: content.buttonLabel,
    enabled: entry.canDisable ? (row?.enabled ?? true) : true,
    canDisable: entry.canDisable,
    variables: entry.variables,
    updatedAt: (row?.updatedAt ?? NEVER_SAVED).toISOString(),
  };
}

/** Variables inconnues de ce modèle dans les textes envoyés (une erreur par champ). */
function unknownVariableErrors(entry: TemplateEntry, input: EmailPreviewInput): ProblemFieldError[] {
  const fields: [string, string | null | undefined][] = [
    ['subject', input.subject],
    ['preheader', input.preheader],
    ['title', input.title],
    ['buttonLabel', input.buttonLabel],
    ...(input.paragraphs ?? []).map((paragraph, index): [string, string] => [
      `paragraphs.${String(index)}`,
      paragraph,
    ]),
  ];
  const available =
    entry.variables.length === 0
      ? 'Ce modèle n’utilise aucune variable.'
      : `Variables disponibles : ${entry.variables.join(', ')}.`;
  return fields.flatMap(([path, text]) => {
    if (typeof text !== 'string') return [];
    const unknown = variablesIn(text).filter((name) => !entry.allowed.has(normalizeVariableName(name)));
    if (unknown.length === 0) return [];
    return [
      {
        path,
        code: 'unknown_variable',
        message: `Variable inconnue : ${unknown.map((name) => `{${name}}`).join(', ')}. ${available}`,
      },
    ];
  });
}

/**
 * E-mails automatiques du back-office (`/v1/admin/email-templates*`) : textes modifiables (objet, titre,
 * paragraphes, bouton) et activation, aperçu rendu par les gabarits React Email avec des données d'exemple, envoi
 * de test. Les modèles indispensables (sécurité, invitation, double opt-in, gabarit de la newsletter) ne peuvent
 * pas être désactivés.
 */
@Injectable()
export class AdminEmailTemplatesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MailContentService) private readonly content: MailContentService,
    @Inject(MailQueueService) private readonly mailQueue: MailQueueService,
  ) {}

  private entry(key: string): TemplateEntry {
    const entry = isMailTemplateKey(key) ? TEMPLATE_ENTRIES.get(key) : undefined;
    if (entry === undefined) throw notFoundException(EMAIL_TEMPLATE_NOT_FOUND);
    return entry;
  }

  private async row(key: MailTemplateKey): Promise<TemplateRow | undefined> {
    return (
      (await this.prisma.emailTemplate.findUnique({ where: { key }, select: templateSelect })) ?? undefined
    );
  }

  /** `GET /v1/admin/email-templates` */
  async list(): Promise<EmailTemplate[]> {
    const rows = await this.prisma.emailTemplate.findMany({ select: templateSelect });
    const byKey = new Map(rows.map((row) => [row.key, row]));
    return TEMPLATE_CATALOG.map((entry) => toEmailTemplate(entry, byKey.get(entry.key)));
  }

  /** `GET /v1/admin/email-templates/{key}` */
  async get(key: string): Promise<EmailTemplate> {
    const entry = this.entry(key);
    return toEmailTemplate(entry, await this.row(entry.key));
  }

  /** `PUT /v1/admin/email-templates/{key}` : textes (variables du modèle seulement) et activation. */
  async save(key: string, input: EmailTemplateInput, actor: AuditActor): Promise<EmailTemplate> {
    const entry = this.entry(key);
    const errors = unknownVariableErrors(entry, input);
    if (input.enabled === false && !entry.canDisable)
      errors.push({
        path: 'enabled',
        code: 'cannot_disable',
        message: 'Cet e-mail est indispensable : il ne peut pas être désactivé.',
      });
    if (errors.length > 0) throw validationException(errors);

    const current = toEmailTemplate(entry, await this.row(entry.key));
    const next = {
      subject: input.subject ?? current.subject,
      preheader: input.preheader === undefined ? current.preheader : input.preheader,
      title: input.title ?? current.title,
      paragraphs: input.paragraphs ?? current.paragraphs,
      buttonLabel: input.buttonLabel === undefined ? current.buttonLabel : input.buttonLabel,
      enabled: input.enabled ?? current.enabled,
    };
    const changed = (Object.keys(next) as (keyof typeof next)[]).filter(
      (field) => JSON.stringify(next[field]) !== JSON.stringify(current[field]),
    );
    await this.prisma.$transaction(async (tx) => {
      await tx.emailTemplate.upsert({
        where: { key: entry.key },
        create: { key: entry.key, ...next, updatedById: actor.userId },
        update: { ...next, updatedById: actor.userId },
        select: { key: true },
      });
      await recordAudit(tx, actor, {
        action: 'email-template.update',
        entity: 'EmailTemplate',
        entityId: entry.key,
        label: `A modifié l’e-mail « ${entry.name} »`,
        before: { enabled: current.enabled },
        after: { enabled: next.enabled, fields: changed },
      });
    });
    return this.get(entry.key);
  }

  /** `POST /v1/admin/email-templates/{key}/preview` : rendu avec les données d'exemple et les coordonnées réelles. */
  async preview(key: string, input: EmailPreviewInput): Promise<EmailPreview> {
    const entry = this.entry(key);
    const errors = unknownVariableErrors(entry, input);
    if (errors.length > 0) throw validationException(errors);
    const saved = toEmailTemplate(entry, await this.row(entry.key));
    const settings = await this.content.getSettings('fr');
    const rendered = await renderMail({
      template: entry.key,
      lang: 'fr',
      data: SAMPLE_DATA[entry.key],
      content: {
        subject: input.subject ?? saved.subject,
        preheader: input.preheader === undefined ? saved.preheader : input.preheader,
        title: input.title ?? saved.title,
        paragraphs: input.paragraphs ?? saved.paragraphs,
        buttonLabel: input.buttonLabel === undefined ? saved.buttonLabel : input.buttonLabel,
      },
      context: settings.context,
    });
    return { subject: rendered.subject, html: rendered.html, text: rendered.text };
  }

  /**
   * `POST /v1/admin/email-templates/{key}/test` : met en file un envoi du modèle enregistré, avec les données
   * d'exemple, à l'adresse indiquée, objet préfixé « [TEST] ». Modèle désactivé : 409 (le worker ne l'enverrait pas).
   */
  async test(key: string, input: EmailTestInput, actor: AuditActor): Promise<{ message: string }> {
    const entry = this.entry(key);
    const saved = toEmailTemplate(entry, await this.row(entry.key));
    if (!saved.enabled) {
      throw new ProblemException({
        status: HttpStatus.CONFLICT,
        type: 'conflict',
        title: 'Conflit',
        detail: 'Ce modèle est désactivé : activez-le avant d’envoyer un test.',
      });
    }
    await this.mailQueue.enqueue({
      template: entry.key,
      to: input.email,
      lang: 'fr',
      data: SAMPLE_DATA[entry.key],
      subjectPrefix: '[TEST]',
    });
    await recordAudit(this.prisma, actor, {
      action: 'email-template.test',
      entity: 'EmailTemplate',
      entityId: entry.key,
      // L'adresse de destination n'est pas inscrite au journal.
      label: `A envoyé un test de l’e-mail « ${entry.name} »`,
    });
    return { message: `E-mail de test envoyé à ${input.email}.` };
  }
}
