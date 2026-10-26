import type { MailLang } from './mail.types.js';

/** Fuseau d'affichage des dates (conventions de l'API). */
export const DISPLAY_TIME_ZONE = 'Africa/Douala';

const LOCALES: Record<MailLang, string> = { fr: 'fr-FR', en: 'en-GB' };

/** Lecture prudente d'une donnée de tâche : chaîne non vide (ou nombre), sinon `undefined`. */
export function readText(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key];
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function toDate(value: string | undefined): Date | undefined {
  if (value === undefined) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** Date longue dans le fuseau de Douala : « samedi 14 novembre 2026 » / « Saturday 14 November 2026 ». */
export function formatLongDate(iso: string | undefined, lang: MailLang): string | undefined {
  const date = toDate(iso);
  if (date === undefined) return undefined;
  return new Intl.DateTimeFormat(LOCALES[lang], {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: DISPLAY_TIME_ZONE,
  })
    .format(date)
    .replace(',', '');
}

/** Date courte sans l'année : « 14 novembre » / « 14 November ». */
export function formatShortDate(iso: string | undefined, lang: MailLang): string | undefined {
  const date = toDate(iso);
  if (date === undefined) return undefined;
  return new Intl.DateTimeFormat(LOCALES[lang], {
    day: 'numeric',
    month: 'long',
    timeZone: DISPLAY_TIME_ZONE,
  }).format(date);
}

/** Heure à Douala, sur 24 h : « 14:00 ». */
export function formatTime(iso: string | undefined, lang: MailLang): string | undefined {
  const date = toDate(iso);
  if (date === undefined) return undefined;
  return new Intl.DateTimeFormat(LOCALES[lang], {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: DISPLAY_TIME_ZONE,
  }).format(date);
}

export function capitalize(value: string): string {
  return value.charAt(0).toLocaleUpperCase(LOCALES.fr) + value.slice(1);
}

/**
 * Numéro E.164 lisible : `+237600000000` → « +237 6 00 00 00 00 », `+33612345678` → « +33 6 12 34 56 78 ».
 * Un numéro d'un autre format est renvoyé tel quel.
 */
export function formatPhone(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const match = /^\+(237|33)(\d)(\d{8})$/.exec(value.replace(/[\s.-]/g, ''));
  if (match === null) return value;
  const [, country, first, rest] = match as unknown as [string, string, string, string];
  return `+${country} ${first} ${rest.replace(/(\d{2})(?=\d)/g, '$1 ')}`;
}

/** Lien WhatsApp (`wa.me`) avec un message prérempli ; `undefined` sans numéro exploitable. */
export function whatsappLink(number: string | undefined, message: string | undefined): string | undefined {
  const digits = number?.replace(/\D/g, '');
  if (digits === undefined || digits.length < 8) return undefined;
  return message === undefined || message === ''
    ? `https://wa.me/${digits}`
    : `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

/** Adresse http(s) absolue valide, sinon `undefined` (un lien `javascript:` n'est jamais repris). */
export function safeUrl(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** Date au format des agendas (`20261112T130000Z`). */
function calendarStamp(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

/** Lien « Ajouter à Google Agenda » d'un rendez-vous (durée par défaut : 1 h). */
export function googleCalendarLink(input: {
  title: string;
  startsAt: string | undefined;
  endsAt: string | undefined;
  details?: string;
  location?: string;
}): string | undefined {
  const start = toDate(input.startsAt);
  if (start === undefined) return undefined;
  const end = toDate(input.endsAt) ?? new Date(start.getTime() + 60 * 60_000);
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: input.title,
    dates: `${calendarStamp(start)}/${calendarStamp(end)}`,
    ctz: DISPLAY_TIME_ZONE,
  });
  if (input.details) params.set('details', input.details);
  if (input.location) params.set('location', input.location);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
