import type { Lang } from '../../common/i18n/lang.js';
import { localizeFields } from '../../common/i18n/translations.js';
import type { IllustrationScene, Language, Prisma } from '../../generated/prisma/client.js';
import { mediaImageSelect, type MediaRecord } from '../media/visual.mapper.js';

/**
 * Questionnaire lu avec sa demande : prestation (service, sinon rubrique, sinon sujet), client et date de la
 * prestation. Commun à l'invitation (e-mails) et à la page publique du questionnaire.
 */
const nameSelect = { name: true, translations: true } as const;

export const SURVEY_CONTEXT_SELECT = {
  id: true,
  requestId: true,
  status: true,
  language: true,
  scheduledFor: true,
  sentAt: true,
  remindedAt: true,
  expiresAt: true,
  completedAt: true,
  request: {
    select: {
      id: true,
      reference: true,
      type: true,
      status: true,
      subject: true,
      language: true,
      serviceId: true,
      completedAt: true,
      anonymizedAt: true,
      service: {
        select: {
          ...nameSelect,
          illustration: true,
          coverImage: { select: mediaImageSelect },
          category: { select: nameSelect },
        },
      },
      category: { select: { ...nameSelect, illustration: true } },
      contact: {
        select: {
          email: true,
          fullName: true,
          firstName: true,
          lastName: true,
          city: true,
          anonymizedAt: true,
        },
      },
    },
  },
} satisfies Prisma.SurveySelect;

export type SurveyContextRow = Prisma.SurveyGetPayload<{ select: typeof SURVEY_CONTEXT_SELECT }>;

export const langOfLanguage = (language: Language): Lang => (language === 'EN' ? 'en' : 'fr');

function localizedName(record: { name: string; translations: unknown }, lang: Lang): string {
  return localizeFields(record, record.translations, lang, ['name'] as const).name;
}

/** Prestation évaluée : nom, rubrique et visuel (illustration de la rubrique à défaut de service). */
export interface SurveyService {
  name: string;
  categoryName: string;
  illustration: IllustrationScene | null;
  media: MediaRecord | null;
}

const FALLBACK_SERVICE: Record<Lang, string> = { fr: 'Votre prestation', en: 'Your service' };

export function surveyService(row: SurveyContextRow, lang: Lang): SurveyService {
  const { service, category, subject } = row.request;
  if (service !== null)
    return {
      name: localizedName(service, lang),
      categoryName: localizedName(service.category, lang),
      illustration: service.illustration,
      media: service.coverImage,
    };
  if (category !== null) {
    const name = localizedName(category, lang);
    return { name: subject ?? name, categoryName: name, illustration: category.illustration, media: null };
  }
  return { name: subject ?? FALLBACK_SERVICE[lang], categoryName: '', illustration: null, media: null };
}

/** Le questionnaire peut encore être envoyé ou rempli : demande et fiche non anonymisées. */
export function isReachable(row: SurveyContextRow): boolean {
  return row.request.anonymizedAt === null && row.request.contact.anonymizedAt === null;
}

/** Nom affiché « Prénom N. » déduit de la fiche du client (docs/05 §7.2). */
export function displayNameOf(contact: {
  fullName: string;
  firstName: string | null;
  lastName: string | null;
}): string {
  const words = contact.fullName.trim().split(/\s+/).filter(Boolean);
  const first = contact.firstName?.trim() || words[0] || 'Client';
  const last = contact.lastName?.trim() || (words.length > 1 ? words[words.length - 1] : '');
  const initial = last ? `${last.charAt(0).toLocaleUpperCase('fr')}.` : '';
  return initial ? `${first} ${initial}` : first;
}
