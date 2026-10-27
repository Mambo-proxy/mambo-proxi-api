/**
 * Invitation d'agenda iCalendar (RFC 5545) jointe à l'e-mail de confirmation d'un rendez-vous
 * (`MailJob.data.ics`, `METHOD:REQUEST`). Heures en UTC (`…Z`) : chaque agenda les affiche dans le fuseau de son
 * propriétaire. Lignes séparées par CRLF et repliées à 75 octets ; textes échappés (`\`, `;`, `,`, retours).
 */

export interface AppointmentInvitation {
  /** Identifiant stable du rendez-vous : une nouvelle invitation (report) remplace la précédente dans l'agenda. */
  uid: string;
  /** Numéro de version (croissant) : un report envoie une invitation plus récente. */
  sequence: number;
  startsAt: Date;
  endsAt: Date;
  stampedAt: Date;
  summary: string;
  description: string;
  location: string | null;
  url: string | null;
  organizer: { name: string; email: string };
  attendee: { name: string; email: string };
}

function stamp(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

export function escapeIcsText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Paramètre `CN` : entre guillemets, sans guillemet ni caractère de contrôle. */
function commonName(value: string): string {
  return `"${value.replace(/["\p{Cc}]/gu, '').trim()}"`;
}

/** Repli des lignes de plus de 75 octets (suite précédée d'une espace), sans couper un caractère UTF-8. */
export function foldIcsLine(line: string): string {
  const parts: string[] = [];
  let current = '';
  let size = 0;
  for (const char of line) {
    const bytes = Buffer.byteLength(char, 'utf8');
    const limit = parts.length === 0 ? 75 : 74;
    if (size + bytes > limit) {
      parts.push(current);
      current = '';
      size = 0;
    }
    current += char;
    size += bytes;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

export function buildInvitation(invitation: AppointmentInvitation): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//MAMBO Proxi//Rendez-vous//FR',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${escapeIcsText(invitation.uid)}`,
    `SEQUENCE:${String(Math.max(0, Math.floor(invitation.sequence)))}`,
    `DTSTAMP:${stamp(invitation.stampedAt)}`,
    `DTSTART:${stamp(invitation.startsAt)}`,
    `DTEND:${stamp(invitation.endsAt)}`,
    `SUMMARY:${escapeIcsText(invitation.summary)}`,
    `DESCRIPTION:${escapeIcsText(invitation.description)}`,
    ...(invitation.location ? [`LOCATION:${escapeIcsText(invitation.location)}`] : []),
    ...(invitation.url ? [`URL:${invitation.url}`] : []),
    `ORGANIZER;CN=${commonName(invitation.organizer.name)}:mailto:${invitation.organizer.email}`,
    `ATTENDEE;CN=${commonName(invitation.attendee.name)};ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;RSVP=FALSE:mailto:${invitation.attendee.email}`,
    'STATUS:CONFIRMED',
    'TRANSP:OPAQUE',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.map(foldIcsLine).join('\r\n')}\r\n`;
}
