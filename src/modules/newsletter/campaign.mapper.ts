import type { CampaignSegmentKind, CampaignStatus, Language, Prisma } from '../../generated/prisma/client.js';

/** Schéma `CampaignSegment` du contrat. */
export interface CampaignSegment {
  kind: CampaignSegmentKind;
  tags?: string[];
}

const SEGMENT_LABELS: Record<Exclude<CampaignSegmentKind, 'TAGS'>, string> = {
  ALL: 'Tous les inscrits',
  FRANCE: 'France',
  CAMEROUN: 'Cameroun',
  PROFESSIONNELS: 'Professionnels',
};

export function segmentLabel(kind: CampaignSegmentKind, tags: readonly string[]): string {
  if (kind !== 'TAGS') return SEGMENT_LABELS[kind];
  return tags.length === 1 ? `Étiquette « ${tags[0] ?? ''} »` : `Étiquettes : ${tags.join(', ')}`;
}

export function toSegment(kind: CampaignSegmentKind, tags: readonly string[]): CampaignSegment {
  return kind === 'TAGS' ? { kind, tags: [...tags] } : { kind };
}

/** Pays enregistré sur l'abonnement, à défaut sur la fiche contact. */
function countryWhere(country: string): Prisma.SubscriberWhereInput {
  return {
    OR: [{ country }, { country: null, contact: { is: { country } } }],
  };
}

/**
 * Destinataires d'un segment : abonnés confirmés (double opt-in) seulement ; France / Cameroun par le pays,
 * professionnels par le profil de la fiche contact, étiquettes : au moins une en commun. `language` (envois du
 * magazine, une campagne par langue) : abonnés de cette langue seulement.
 */
export function segmentWhere(
  kind: CampaignSegmentKind,
  tags: readonly string[],
  language: Language | null = null,
): Prisma.SubscriberWhereInput {
  const confirmed: Prisma.SubscriberWhereInput =
    language === null ? { status: 'CONFIRME' } : { status: 'CONFIRME', language };
  switch (kind) {
    case 'ALL':
      return confirmed;
    case 'FRANCE':
      return { AND: [confirmed, countryWhere('FR')] };
    case 'CAMEROUN':
      return { AND: [confirmed, countryWhere('CM')] };
    case 'PROFESSIONNELS':
      return { AND: [confirmed, { contact: { is: { profile: 'PROFESSIONNEL' } } }] };
    case 'TAGS':
      return { AND: [confirmed, { tags: { hasSome: [...tags] } }] };
  }
}

export const CAMPAIGN_SELECT = {
  id: true,
  subject: true,
  preheader: true,
  html: true,
  text: true,
  segmentKind: true,
  segmentTags: true,
  language: true,
  status: true,
  scheduledAt: true,
  startedAt: true,
  sentAt: true,
  recipients: true,
  opens: true,
  clicks: true,
  unsubscribes: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.CampaignSelect;

export type CampaignRow = Prisma.CampaignGetPayload<{ select: typeof CAMPAIGN_SELECT }>;

/** Schéma `Campaign` du contrat. */
export interface Campaign {
  id: string;
  subject: string;
  preheader: string | null;
  html: string;
  segment: CampaignSegment;
  segmentLabel: string;
  status: CampaignStatus;
  scheduledAt: string | null;
  sentAt: string | null;
  recipients: number;
  opens: number | null;
  clicks: number | null;
  unsubscribes: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * `recipients` : nombre d'envois pour une campagne partie ; estimation du segment (abonnés confirmés à cet instant)
 * pour une campagne programmée ; 0 pour un brouillon. `opens` / `clicks` : `null` si la mesure est désactivée.
 */
export function toCampaign(row: CampaignRow, tracking: boolean, estimatedRecipients?: number): Campaign {
  return {
    id: row.id,
    subject: row.subject,
    preheader: row.preheader,
    html: row.html,
    segment: toSegment(row.segmentKind, row.segmentTags),
    segmentLabel: segmentLabel(row.segmentKind, row.segmentTags),
    status: row.status,
    scheduledAt: row.scheduledAt?.toISOString() ?? null,
    sentAt: row.sentAt?.toISOString() ?? null,
    recipients:
      row.status === 'PROGRAMMEE'
        ? (estimatedRecipients ?? row.recipients)
        : row.status === 'BROUILLON'
          ? 0
          : row.recipients,
    opens: tracking ? (row.opens ?? 0) : null,
    clicks: tracking ? (row.clicks ?? 0) : null,
    unsubscribes: row.unsubscribes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Une campagne se modifie (et se programme ou part) tant qu'elle n'est pas partie. */
export function isEditable(status: CampaignStatus): boolean {
  return status === 'BROUILLON' || status === 'PROGRAMMEE';
}

/** Adresse de la page de désinscription du site (`/newsletter/desinscription`, anglais `/en/newsletter/unsubscribe`). */
export function unsubscribePageUrl(webUrl: string, lang: 'fr' | 'en', token: string): string {
  const base = webUrl.replace(/\/+$/, '');
  const path = lang === 'en' ? '/en/newsletter/unsubscribe' : '/newsletter/desinscription';
  return `${base}${path}?token=${encodeURIComponent(token)}`;
}

/** Adresse de désinscription en un clic de l'API (en-tête `List-Unsubscribe`, POST RFC 8058). */
export function oneClickUnsubscribeUrl(apiUrl: string, token: string): string {
  return `${apiUrl.replace(/\/+$/, '')}/v1/newsletter/unsubscribe?token=${encodeURIComponent(token)}`;
}

/** Prénom d'un abonné pour la variable `{prénom}` (premier mot du nom). */
export function firstNameOf(name: string | null): string | undefined {
  const first = name?.trim().split(/\s+/)[0];
  return first ? first : undefined;
}
