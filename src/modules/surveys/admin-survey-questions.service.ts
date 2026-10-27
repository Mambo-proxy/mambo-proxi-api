import { Inject, Injectable } from '@nestjs/common';
import { recordAudit, type AuditActor } from '../../common/audit/audit-log.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { SurveyQuestionsInput } from './survey.schemas.js';
import {
  SURVEY_QUESTION_SELECT,
  toSurveyQuestion,
  type SurveyQuestion,
  type SurveyQuestionRow,
} from './surveys.service.js';

/** Schéma `AdminSurveyQuestion` du contrat. */
export interface AdminSurveyQuestion extends SurveyQuestion {
  active: boolean;
}

function toAdminSurveyQuestion(row: SurveyQuestionRow): AdminSurveyQuestion {
  return { ...toSurveyQuestion(row, 'fr'), active: row.active };
}

/**
 * Questions du questionnaire de satisfaction (`/v1/admin/survey-questions`). `PUT` remplace la liste : l'ordre est
 * celui du corps, une question d'identifiant connu est mise à jour (traductions conservées), les autres sont
 * créées, celles qui ne figurent plus dans la liste sont supprimées. Les réponses déjà reçues gardent leur
 * instantané (intitulé et valeur), elles ne dépendent pas des questions.
 */
@Injectable()
export class AdminSurveyQuestionsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(): Promise<AdminSurveyQuestion[]> {
    const rows = await this.prisma.surveyQuestion.findMany({
      orderBy: [{ order: 'asc' }, { id: 'asc' }],
      select: SURVEY_QUESTION_SELECT,
    });
    return rows.map(toAdminSurveyQuestion);
  }

  async replace(input: SurveyQuestionsInput, actor: AuditActor, now: Date): Promise<AdminSurveyQuestion[]> {
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.surveyQuestion.findMany({ select: { id: true } });
      const known = new Set(existing.map((row) => row.id));
      const kept = new Set<string>();
      for (const [index, question] of input.entries()) {
        const data = {
          order: index + 1,
          kind: question.kind,
          label: question.label,
          helpText: question.helpText ?? null,
          options: question.options,
          required: question.required,
          active: question.active,
          updatedAt: now,
        };
        if (question.id && known.has(question.id)) {
          kept.add(question.id);
          await tx.surveyQuestion.update({ where: { id: question.id }, data, select: { id: true } });
        } else {
          await tx.surveyQuestion.create({ data: { ...data, createdAt: now }, select: { id: true } });
        }
      }
      const removed = [...known].filter((id) => !kept.has(id));
      if (removed.length > 0) await tx.surveyQuestion.deleteMany({ where: { id: { in: removed } } });
      await recordAudit(tx, actor, {
        action: 'survey-questions.update',
        entity: 'SurveyQuestion',
        entityId: null,
        label: `A modifié les questions du questionnaire de satisfaction (${String(
          input.filter((question) => question.active).length,
        )} actives)`,
        after: { count: input.length, removed: removed.length },
      });
    });
    return this.list();
  }
}
