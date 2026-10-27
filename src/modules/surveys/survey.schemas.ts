import { z } from 'zod';
import { idSchema, nullableText } from '../../common/validation/content.schemas.js';

/** Corps des opérations du questionnaire (schémas `SurveyAnswer`, `SurveyQuestionInput` du contrat). */

export const SURVEY_QUESTION_KINDS = ['STARS', 'CHOICE', 'NPS', 'TEXT'] as const;
/** Questions actives au plus (cahier des charges §7.2 : 5 questions, 2 minutes). */
export const MAX_ACTIVE_QUESTIONS = 5;

const answerValueSchema = z
  .union([z.number().int(), z.string().max(2000), z.null()], {
    error: 'Réponse invalide : une note ou un texte est attendu.',
  })
  .optional()
  .transform((value) => {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed === '' ? null : trimmed;
    }
    return value ?? null;
  });

export const surveyAnswerSchema = z.object({
  questionId: idSchema,
  value: answerValueSchema,
});
export type SurveyAnswerInput = z.output<typeof surveyAnswerSchema>;

export const submitSurveySchema = z.object({
  answers: z
    .array(surveyAnswerSchema)
    .min(1, { error: 'Répondez au moins à une question.' })
    .max(10, { error: '10 réponses au maximum.' }),
  publishConsent: z.boolean({ error: 'Indiquez si vous acceptez la publication de votre avis.' }),
  displayName: nullableText(60).optional(),
  city: nullableText(80).optional(),
});
export type SubmitSurveyInput = z.output<typeof submitSurveySchema>;

export const surveyQuestionInputSchema = z
  .object({
    id: idSchema.nullable().optional(),
    kind: z.enum(SURVEY_QUESTION_KINDS, { error: 'Type de question inconnu.' }),
    label: z.string().trim().min(1, { error: 'Saisissez l’intitulé de la question.' }).max(200),
    helpText: nullableText(200).optional(),
    options: z.array(z.string().trim().max(60)).max(10).optional(),
    required: z.boolean(),
    active: z.boolean(),
  })
  .transform((question) => ({
    ...question,
    options: question.kind === 'TEXT' ? [] : (question.options ?? []).filter((option) => option.length > 0),
  }))
  .superRefine((question, context) => {
    if (question.kind === 'CHOICE' && question.options.length < 2)
      context.addIssue({
        code: 'custom',
        path: ['options'],
        message: 'Proposez au moins deux choix de réponse.',
      });
    if (question.kind === 'STARS' && question.options.length > 0 && question.options.length !== 5)
      context.addIssue({
        code: 'custom',
        path: ['options'],
        message: 'Indiquez un libellé pour chacune des 5 notes, ou aucun.',
      });
    if (question.kind === 'NPS' && question.options.length > 0 && question.options.length !== 2)
      context.addIssue({
        code: 'custom',
        path: ['options'],
        message: 'Indiquez les deux bornes de l’échelle (gauche, droite), ou aucune.',
      });
  });

export const surveyQuestionsInputSchema = z
  .array(surveyQuestionInputSchema, { error: 'Liste de questions attendue.' })
  .max(10, { error: 'Le questionnaire compte 10 questions au maximum.' })
  .superRefine((questions, context) => {
    if (questions.filter((question) => question.active).length > MAX_ACTIVE_QUESTIONS)
      context.addIssue({
        code: 'custom',
        path: [],
        message: `Le questionnaire compte ${String(MAX_ACTIVE_QUESTIONS)} questions actives au maximum.`,
      });
    const seen = new Set<string>();
    questions.forEach((question, index) => {
      if (!question.id) return;
      if (seen.has(question.id))
        context.addIssue({ code: 'custom', path: [index, 'id'], message: 'Question en double.' });
      seen.add(question.id);
    });
  });
export type SurveyQuestionsInput = z.output<typeof surveyQuestionsInputSchema>;
