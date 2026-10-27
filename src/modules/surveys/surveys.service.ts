import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { Lang } from '../../common/i18n/lang.js';
import { translationFor } from '../../common/i18n/translations.js';
import { ProblemException, notFoundException, type ProblemFieldError } from '../../common/problem/problem.js';
import { validationException } from '../../common/validation/validation-exception.js';
import { AppConfigService } from '../../config/app-config.service.js';
import type { Prisma, SurveyQuestionKind } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ROLES, hasAnyPermission } from '../auth/permissions.js';
import type { Visual } from '../media/visual.mapper.js';
import { MediaService } from '../media/media.service.js';
import {
  SURVEY_CONTEXT_SELECT,
  displayNameOf,
  isReachable,
  langOfLanguage,
  surveyService,
  type SurveyContextRow,
} from './survey-context.js';
import type { SubmitSurveyInput } from './survey.schemas.js';
import { SURVEY_TOKEN_PATTERN, surveyTokenHash } from './survey-token.js';

/** Schéma `SurveyQuestion` du contrat. */
export interface SurveyQuestion {
  id: string;
  order: number;
  kind: SurveyQuestionKind;
  label: string;
  helpText: string | null;
  options: string[];
  required: boolean;
}

/** Schéma `PublicSurvey` du contrat. */
export interface PublicSurvey {
  reference: string;
  firstName: string | null;
  service: { name: string; categoryName: string; visual: Visual };
  serviceDate: string | null;
  questions: SurveyQuestion[];
  expiresAt: string;
}

export interface MessageResponse {
  message: string;
}

export const SURVEY_NOT_FOUND = 'Ce lien de questionnaire n’est pas valide.';

/** 410 `survey-expired` (exemple du contrat). */
export function surveyExpiredException(): ProblemException {
  return new ProblemException({
    status: HttpStatus.GONE,
    type: 'survey-expired',
    title: 'Lien expiré',
    detail: 'Ce questionnaire n’est plus disponible. Merci pour votre confiance !',
  });
}

/** 410 `survey-completed` (exemple du contrat). */
export function surveyCompletedException(): ProblemException {
  return new ProblemException({
    status: HttpStatus.GONE,
    type: 'survey-completed',
    title: 'Déjà rempli',
    detail: 'Vous avez déjà répondu à ce questionnaire. Merci !',
  });
}

const THANKS: Record<Lang, string> = {
  fr: 'Merci pour votre retour !',
  en: 'Thank you for your feedback!',
};

/** Rôles prévenus d'un nouvel avis à valider (`reviews:moderate`). */
const MODERATOR_ROLES = ROLES.filter((role) => hasAnyPermission(role, ['reviews:moderate']));
/** Écran « Avis clients » du back-office, onglet « À valider ». */
export const ADMIN_REVIEWS_TO_VALIDATE_PATH = '/admin/avis?status=A_VALIDER';

export const SURVEY_QUESTION_SELECT = {
  id: true,
  order: true,
  kind: true,
  label: true,
  helpText: true,
  options: true,
  required: true,
  active: true,
  translations: true,
} as const satisfies Prisma.SurveyQuestionSelect;

export type SurveyQuestionRow = Prisma.SurveyQuestionGetPayload<{ select: typeof SURVEY_QUESTION_SELECT }>;

/** Question dans la langue du client (`translations.en` : `label`, `helpText`, `options`). */
export function toSurveyQuestion(row: SurveyQuestionRow, lang: Lang): SurveyQuestion {
  const translated = translationFor(row.translations, lang);
  const text = (key: string): string | undefined => {
    const value = translated?.[key];
    return typeof value === 'string' && value.trim() !== '' ? value : undefined;
  };
  const options = translated?.['options'];
  const localizedOptions =
    Array.isArray(options) &&
    options.length === row.options.length &&
    options.every((option) => typeof option === 'string')
      ? options
      : row.options;
  return {
    id: row.id,
    order: row.order,
    kind: row.kind,
    label: text('label') ?? row.label,
    helpText: text('helpText') ?? row.helpText,
    options: localizedOptions,
    required: row.required,
  };
}

/** Réponse validée : valeur enregistrée et libellé lisible du back-office (« 5/5 — Excellent »). */
interface CheckedAnswer {
  question: SurveyQuestionRow;
  value: number | string | null;
  display: string | null;
}

/**
 * Questionnaire de satisfaction côté site (`/v1/surveys/{token}`) : lecture par le lien reçu par e-mail et envoi
 * des réponses. Le lien est à usage unique (seconde réponse → 410) et valable 30 jours après l'envoi. Un avis
 * « À valider », vérifié, n'est créé que si le client consent à la publication et a donné une note (docs/05 §7.2) ;
 * sinon les réponses restent consultables dans le suivi de la demande.
 */
@Injectable()
export class SurveysService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MediaService) private readonly media: MediaService,
    @Inject(AppConfigService) private readonly config: AppConfigService,
  ) {}

  /** `GET /v1/surveys/{token}` */
  async get(token: string, lang: Lang, now: Date): Promise<PublicSurvey> {
    const row = await this.findOpen(token, now, notFoundException(SURVEY_NOT_FOUND));
    const questions = await this.activeQuestions();
    const service = surveyService(row, lang);
    return {
      reference: row.request.reference,
      firstName: row.request.contact.firstName,
      service: {
        name: service.name,
        categoryName: service.categoryName,
        visual: this.media.visual(service.illustration, service.media),
      },
      serviceDate: row.request.completedAt?.toISOString() ?? null,
      questions: questions.map((question) => toSurveyQuestion(question, lang)),
      expiresAt: row.expiresAt.toISOString(),
    };
  }

  /** `POST /v1/surveys/{token}/responses` */
  async submit(token: string, input: SubmitSurveyInput, now: Date): Promise<MessageResponse> {
    // Lien inconnu : 410 « déjà utilisé ou expiré » (seule réponse d'erreur du contrat pour ce lien).
    const row = await this.findOpen(token, now, surveyExpiredException());
    const questions = await this.activeQuestions();
    const answers = checkAnswers(input, questions);
    const lang = langOfLanguage(row.language);

    const stars = answers.find(
      (answer) => answer.question.kind === 'STARS' && typeof answer.value === 'number',
    );
    const nps = answers.find((answer) => answer.question.kind === 'NPS' && typeof answer.value === 'number');
    const comment = answers.find(
      (answer) => answer.question.kind === 'TEXT' && typeof answer.value === 'string',
    );
    const rating = stars ? (stars.value as number) : null;
    const displayName = input.displayName ?? displayNameOf(row.request.contact);
    const city = input.city === undefined ? row.request.contact.city : input.city;
    const createReview = input.publishConsent && rating !== null;

    await this.prisma.$transaction(async (tx) => {
      // Réservation atomique : une seule réponse est enregistrée, même envoyée deux fois.
      const claimed = await tx.survey.updateMany({
        where: { id: row.id, completedAt: null, status: { in: ['SENT', 'REMINDED'] } },
        data: {
          status: 'ANSWERED',
          completedAt: now,
          answers: answers.map((answer) => ({
            questionId: answer.question.id,
            label: answer.question.label,
            kind: answer.question.kind,
            value: answer.value,
          })),
          rating,
          npsScore: nps ? (nps.value as number) : null,
          publishConsent: input.publishConsent,
          displayName,
          city,
        },
      });
      if (claimed.count === 0) throw surveyCompletedException();
      await tx.requestEvent.create({
        data: {
          requestId: row.request.id,
          kind: 'SURVEY_ANSWERED',
          data: { rating, publishConsent: input.publishConsent },
          actorId: null,
          createdAt: now,
        },
        select: { id: true },
      });
      if (!createReview) return;
      const review = await tx.review.create({
        data: {
          authorName: displayName,
          city,
          rating,
          text: typeof comment?.value === 'string' ? comment.value : '',
          serviceId: row.request.serviceId,
          surveyId: row.id,
          status: 'A_VALIDER',
          verified: true,
          featured: false,
          publishConsent: true,
          answersSnapshot: answers
            .filter((answer) => answer.display !== null)
            .map((answer) => ({ question: answer.question.label, answer: answer.display ?? '' })),
          serviceDate: row.request.completedAt,
          date: now,
          publishedAt: null,
          createdAt: now,
        },
        select: { id: true },
      });
      // Avis « À valider » : rien ne change sur le site, pas de demande de revalidation.
      await this.notifyModerators(tx, review.id, row.request.reference, now);
    });
    return { message: THANKS[lang] };
  }

  /** Questionnaire envoyé, ouvert : sinon `unknown` (lien inconnu), 410 déjà rempli ou expiré. */
  private async findOpen(token: string, now: Date, unknown: ProblemException): Promise<SurveyContextRow> {
    if (!SURVEY_TOKEN_PATTERN.test(token)) throw unknown;
    const row = await this.prisma.survey.findUnique({
      where: { tokenHash: surveyTokenHash(this.config.get('TOKEN_SIGNING_SECRET'), token) },
      select: SURVEY_CONTEXT_SELECT,
    });
    if (row === null || row.status === 'SCHEDULED' || !isReachable(row)) throw unknown;
    if (row.status === 'ANSWERED' || row.completedAt !== null) throw surveyCompletedException();
    if (row.status === 'EXPIRED' || row.expiresAt.getTime() <= now.getTime()) throw surveyExpiredException();
    return row;
  }

  private activeQuestions(): Promise<SurveyQuestionRow[]> {
    return this.prisma.surveyQuestion.findMany({
      where: { active: true },
      orderBy: [{ order: 'asc' }, { id: 'asc' }],
      select: SURVEY_QUESTION_SELECT,
    });
  }

  private async notifyModerators(
    tx: Prisma.TransactionClient,
    reviewId: string,
    reference: string,
    now: Date,
  ): Promise<void> {
    const users = await tx.user.findMany({
      where: { isActive: true, role: { in: [...MODERATOR_ROLES] } },
      select: { id: true },
    });
    if (users.length === 0) return;
    await tx.notification.createMany({
      data: users.map((user) => ({
        userId: user.id,
        kind: 'REVIEW' as const,
        title: `Nouvel avis à valider (${reference})`,
        link: ADMIN_REVIEWS_TO_VALIDATE_PATH,
        entityType: 'Review',
        entityId: reviewId,
        createdAt: now,
      })),
    });
  }
}

/**
 * Contrôle des réponses contre les questions actives : question connue et unique, note entière dans l'échelle
 * (STARS 1–5, NPS 0–10), choix parmi ceux proposés (français ou traduction), texte ; questions obligatoires
 * renseignées. Toutes les erreurs sont renvoyées d'un coup (422).
 */
export function checkAnswers(
  input: SubmitSurveyInput,
  questions: readonly SurveyQuestionRow[],
): CheckedAnswer[] {
  const byId = new Map(questions.map((question) => [question.id, question]));
  const errors: ProblemFieldError[] = [];
  const checked = new Map<string, CheckedAnswer>();
  input.answers.forEach((answer, index) => {
    const path = `answers.${String(index)}`;
    const question = byId.get(answer.questionId);
    if (question === undefined) {
      errors.push({ path: `${path}.questionId`, code: 'unknown_question', message: 'Question inconnue.' });
      return;
    }
    if (checked.has(question.id)) {
      errors.push({
        path: `${path}.questionId`,
        code: 'duplicate',
        message: 'Une seule réponse par question.',
      });
      return;
    }
    const result = checkValue(question, answer.value);
    if (typeof result === 'string') {
      errors.push({ path: `${path}.value`, code: 'invalid_answer', message: result });
      return;
    }
    checked.set(question.id, result);
  });
  questions.forEach((question) => {
    if (question.required && (checked.get(question.id)?.value ?? null) === null)
      errors.push({
        path: 'answers',
        code: 'required',
        message: `Répondez à la question « ${question.label} ».`,
      });
  });
  if (errors.length > 0) throw validationException(errors);
  // Ordre du questionnaire.
  return questions.flatMap((question) => {
    const answer = checked.get(question.id);
    return answer ? [answer] : [];
  });
}

function checkValue(question: SurveyQuestionRow, value: number | string | null): CheckedAnswer | string {
  if (value === null) return { question, value: null, display: null };
  switch (question.kind) {
    case 'STARS': {
      if (typeof value !== 'number' || value < 1 || value > 5) return 'Choisissez une note de 1 à 5 étoiles.';
      const label = question.options[value - 1];
      return { question, value, display: label ? `${String(value)}/5 — ${label}` : `${String(value)}/5` };
    }
    case 'NPS':
      if (typeof value !== 'number' || value < 0 || value > 10) return 'Choisissez une note de 0 à 10.';
      return { question, value, display: `${String(value)}/10` };
    case 'CHOICE': {
      if (typeof value !== 'string') return 'Choisissez une des réponses proposées.';
      const french = question.options.indexOf(value);
      const translatedOptions = translationFor(question.translations, 'en')?.['options'];
      const english = Array.isArray(translatedOptions) ? translatedOptions.indexOf(value) : -1;
      const index = french >= 0 ? french : english;
      const option = index >= 0 ? question.options[index] : undefined;
      if (option === undefined) return 'Choisissez une des réponses proposées.';
      return { question, value: option, display: option };
    }
    case 'TEXT':
      if (typeof value !== 'string') return 'Un texte est attendu.';
      return { question, value, display: value };
  }
}
