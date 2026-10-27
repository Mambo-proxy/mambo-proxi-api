import { describe, expect, it } from 'vitest';
import { Prisma } from '../../generated/prisma/client.js';
import { reminderJobId, reminderTime } from './appointment-reminders.service.js';
import { isSlotTakenError, occupiedInterval } from './appointment-slots.js';
import { buildInvitation, escapeIcsText, foldIcsLine } from './ics.js';

function uniqueError(message: string, meta: Record<string, unknown>): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(message, {
    code: 'P2002',
    clientVersion: Prisma.prismaVersion.client,
    meta,
  });
}

describe('rappel de la veille', () => {
  it('tombe la veille du rendez-vous à l’heure choisie (heure de Douala), quel que soit le changement d’heure européen', () => {
    // Lundi 26 octobre 2026 à 09:00 (Douala) : rappel le dimanche 25 à 09:00 Douala = 08:00 UTC.
    expect(reminderTime(new Date('2026-10-26T08:00:00.000Z'), 9).toISOString()).toBe(
      '2026-10-25T08:00:00.000Z',
    );
    // Rendez-vous à 00:30 (Douala) le 2 novembre : la veille est le 1er novembre.
    expect(reminderTime(new Date('2026-11-01T23:30:00.000Z'), 18).toISOString()).toBe(
      '2026-11-01T17:00:00.000Z',
    );
  });

  it('a un identifiant stable par rendez-vous et par créneau', () => {
    const startsAt = new Date('2026-10-26T08:00:00.000Z');
    expect(reminderJobId('apt_1', startsAt)).toBe(`rappel-apt_1-${String(startsAt.getTime())}`);
    expect(reminderJobId('apt_1', new Date('2026-10-27T08:00:00.000Z'))).not.toBe(
      reminderJobId('apt_1', startsAt),
    );
    expect(reminderJobId('apt_1', startsAt)).not.toContain(':');
  });
});

describe('occupation des créneaux', () => {
  const row = {
    id: 'apt_1',
    reference: 'MP-2026-0142',
    startsAt: new Date('2026-10-26T08:00:00.000Z'),
    endsAt: new Date('2026-10-26T09:30:00.000Z'),
    proposedStartsAt: new Date('2026-10-27T13:00:00.000Z'),
  };

  it('occupe le créneau demandé, ou le créneau proposé (même durée), et libère un rendez-vous clos', () => {
    expect(occupiedInterval({ ...row, status: 'CONFIRME', proposedStartsAt: null })).toEqual({
      start: row.startsAt.getTime(),
      end: row.endsAt.getTime(),
    });
    expect(occupiedInterval({ ...row, status: 'AUTRE_CRENEAU_PROPOSE' })).toEqual({
      start: Date.parse('2026-10-27T13:00:00.000Z'),
      end: Date.parse('2026-10-27T14:30:00.000Z'),
    });
    expect(occupiedInterval({ ...row, status: 'ANNULE' })).toBeNull();
    expect(occupiedInterval({ ...row, status: 'TERMINE' })).toBeNull();
  });

  it('reconnaît la violation de l’index unique du créneau (forme de l’adaptateur pg)', () => {
    const adapter = (constraint: unknown) => ({
      modelName: 'Appointment',
      driverAdapterError: { cause: { kind: 'UniqueConstraintViolation', constraint } },
    });
    expect(
      isSlotTakenError(
        uniqueError(
          'Unique constraint failed on the constraint: `appointments_active_slot_key`',
          adapter({ index: 'appointments_active_slot_key' }),
        ),
      ),
    ).toBe(true);
    expect(
      isSlotTakenError(uniqueError('Unique constraint failed', adapter({ fields: ['starts_at'] }))),
    ).toBe(true);
    expect(isSlotTakenError(uniqueError('Unique constraint failed', {}))).toBe(true);
    expect(
      isSlotTakenError(
        uniqueError(
          'Unique constraint failed on the constraint: `appointments_reference_key`',
          adapter({ index: 'appointments_reference_key' }),
        ),
      ),
    ).toBe(false);
    expect(isSlotTakenError(new Error('P2002'))).toBe(false);
  });
});

describe('invitation d’agenda', () => {
  it('échappe les textes et replie les lignes longues sans couper un caractère', () => {
    expect(escapeIcsText('Devis; visio, ligne\nsuivante \\ fin')).toBe(
      'Devis\\; visio\\, ligne\\nsuivante \\\\ fin',
    );
    const folded = foldIcsLine(`DESCRIPTION:${'é'.repeat(60)}`);
    for (const line of folded.split('\r\n')) expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75);
    expect(
      folded
        .split('\r\n')
        .map((line, index) => (index === 0 ? line : line.slice(1)))
        .join(''),
    ).toBe(`DESCRIPTION:${'é'.repeat(60)}`);
  });

  it('décrit le rendez-vous en UTC, avec organisateur et participant', () => {
    const ics = buildInvitation({
      uid: 'apt_1@mamboproxi.com',
      sequence: 1_793_000_000,
      startsAt: new Date('2026-11-12T13:00:00.000Z'),
      endsAt: new Date('2026-11-12T14:30:00.000Z'),
      stampedAt: new Date('2026-10-27T09:00:00.000Z'),
      summary: 'MAMBO Proxi · Devis',
      description: 'Référence MP-2026-0143\nVisio',
      location: 'https://meet.example.com/mambo',
      url: 'https://meet.example.com/mambo',
      organizer: { name: 'MAMBO Proxi', email: 'contact@mamboproxi.com' },
      attendee: { name: 'Aminata "A." Diallo', email: 'aminata.diallo@example.com' },
    });
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('METHOD:REQUEST');
    expect(ics).toContain('DTSTART:20261112T130000Z');
    expect(ics).toContain('DTEND:20261112T143000Z');
    expect(ics).toContain('DESCRIPTION:Référence MP-2026-0143\\nVisio');
    expect(ics).toContain('ORGANIZER;CN="MAMBO Proxi":mailto:contact@mamboproxi.com');
    expect(ics.replace(/\r\n /g, '')).toContain('ATTENDEE;CN="Aminata A. Diallo";');
  });
});
