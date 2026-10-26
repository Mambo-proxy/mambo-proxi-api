// Paramètres, modèles d'e-mails, questions du questionnaire et disponibilités des rendez-vous.
// Données de référence : créées si absentes, jamais écrasées (elles sont modifiées dans le back-office).
import { logCount, nullableJson, readSeedData, type Tx } from '../support.js';
import type { AvailabilitySeed, EmailTemplateSeed, SettingSeed, SurveyQuestionSeed } from '../types.js';

/**
 * Groupes de `settings` : ceux du contrat (`coordonnees`, `whatsapp`, `reseaux`, `emails`, `seo`, `analytics`,
 * `chiffres`, `rgpd`, `securite`, sans la propriété `group`) et les groupes internes `site`, `navigation`, `zones`,
 * `availability`. Coordonnées provisoires des maquettes, à remplacer dans le back-office.
 */
export async function seedSettings(tx: Tx): Promise<void> {
  const settings = readSeedData<SettingSeed[]>('settings');
  for (const setting of settings)
    await tx.setting.upsert({
      where: { key: setting.key },
      update: {},
      create: { key: setting.key, value: setting.value, translations: nullableJson(setting.translations) },
    });
  logCount('Paramètres (groupes)', settings.length);

  const templates = readSeedData<EmailTemplateSeed[]>('email-templates');
  for (const template of templates)
    await tx.emailTemplate.upsert({ where: { key: template.key }, update: {}, create: template });
  logCount("Modèles d'e-mails", templates.length);

  const questions = readSeedData<SurveyQuestionSeed[]>('survey-questions');
  for (const question of questions)
    await tx.surveyQuestion.upsert({ where: { id: question.id }, update: {}, create: question });
  logCount('Questions du questionnaire', questions.length);

  const availability = readSeedData<AvailabilitySeed>('availability');
  for (const rule of availability.rules)
    await tx.availabilityRule.upsert({ where: { id: rule.id }, update: {}, create: rule });
  for (const exception of availability.exceptions)
    await tx.availabilityException.upsert({
      where: { id: exception.id },
      update: {},
      create: { ...exception, date: new Date(`${exception.date}T00:00:00.000Z`) },
    });
  logCount('Créneaux hebdomadaires', availability.rules.length);
  logCount('Fermetures exceptionnelles', availability.exceptions.length);
}
