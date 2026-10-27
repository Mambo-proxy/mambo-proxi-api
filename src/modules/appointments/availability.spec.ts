import { describe, expect, it } from 'vitest';
import {
  computeAvailability,
  lookupSlot,
  type AvailabilityExceptionValue,
  type AvailabilityRuleValue,
} from './availability.js';

const ALL = ['AGENCE', 'TELEPHONE', 'VISIO'] as const;
const RULES: AvailabilityRuleValue[] = [
  { weekday: 1, startTime: '09:00', endTime: '12:00', slotMinutes: 90, formats: [...ALL] },
  { weekday: 1, startTime: '14:00', endTime: '15:00', slotMinutes: 60, formats: ['TELEPHONE', 'VISIO'] },
  { weekday: 2, startTime: '09:00', endTime: '10:30', slotMinutes: 90, formats: [...ALL] },
  { weekday: 6, startTime: '09:00', endTime: '12:00', slotMinutes: 90, formats: ['TELEPHONE', 'VISIO'] },
];
const EXCEPTIONS: AvailabilityExceptionValue[] = [
  { date: '2026-12-25', closed: true, startTime: null, endTime: null, label: 'Noël' },
  { date: '2026-11-03', closed: false, startTime: '10:00', endTime: '11:30', label: 'Horaires réduits' },
];
const POLICY = { minNoticeHours: 24, maxAdvanceDays: 60 };
/** Jeudi 22 octobre 2026, 10:00 à Douala. */
const NOW = new Date('2026-10-22T09:00:00.000Z');

const compute = (from: string, to: string, extra: Partial<Parameters<typeof computeAvailability>[0]> = {}) =>
  computeAvailability({
    rules: RULES,
    exceptions: EXCEPTIONS,
    policy: POLICY,
    busy: [],
    from,
    to,
    now: NOW,
    ...extra,
  });

describe('créneaux libres', () => {
  it('découpe les plages du jour en créneaux de leur durée, en heure de Douala, sans heure d’été', () => {
    // Samedi 24 octobre (heure d'été en Europe), dimanche 25 (changement d'heure), lundi 26 (heure d'hiver).
    const { timezone, timezoneLabel, days } = compute('2026-10-24', '2026-10-26');

    expect(timezone).toBe('Africa/Douala');
    expect(timezoneLabel).toBe('Heure de Douala (UTC+1)');
    expect(days.map((day) => day.date)).toEqual(['2026-10-24', '2026-10-25', '2026-10-26']);
    expect(days[0]).toEqual({
      date: '2026-10-24',
      available: true,
      closedReason: null,
      slots: [
        // 09:00 et 10:30 le samedi (47 h et 48 h 30 après maintenant) ; 12:00 dépasserait la plage.
        {
          startsAt: '2026-10-24T08:00:00.000Z',
          endsAt: '2026-10-24T09:30:00.000Z',
          formats: ['TELEPHONE', 'VISIO'],
        },
        {
          startsAt: '2026-10-24T09:30:00.000Z',
          endsAt: '2026-10-24T11:00:00.000Z',
          formats: ['TELEPHONE', 'VISIO'],
        },
      ],
    });
    expect(days[1]).toEqual({
      date: '2026-10-25',
      available: false,
      closedReason: 'Fermé le dimanche',
      slots: [],
    });
    expect(days[2]?.slots.map((slot) => slot.startsAt)).toEqual([
      '2026-10-26T08:00:00.000Z',
      '2026-10-26T09:30:00.000Z',
      '2026-10-26T13:00:00.000Z',
    ]);
  });

  it('applique le délai minimal et l’horizon de réservation', () => {
    const notice = compute('2026-10-24', '2026-10-24', {
      policy: { minNoticeHours: 48, maxAdvanceDays: 60 },
    });
    // Samedi 24 à 09:00 : 47 h après maintenant, sous le délai de 48 h ; 10:30 : 48 h 30, au-delà.
    expect(notice.days[0]?.slots.map((slot) => slot.startsAt)).toEqual(['2026-10-24T09:30:00.000Z']);
    // Jour ouvert dont tous les créneaux sont trop proches : ni créneau ni motif de fermeture.
    expect(
      compute('2026-10-26', '2026-10-26', { policy: { minNoticeHours: 168, maxAdvanceDays: 60 } }).days[0],
    ).toEqual({
      date: '2026-10-26',
      available: false,
      closedReason: null,
      slots: [],
    });

    const horizon = compute('2026-10-26', '2026-11-02', { policy: { minNoticeHours: 0, maxAdvanceDays: 7 } });
    expect(horizon.days.find((day) => day.date === '2026-10-26')?.available).toBe(true);
    expect(horizon.days.find((day) => day.date === '2026-11-02')).toEqual({
      date: '2026-11-02',
      available: false,
      closedReason: null,
      slots: [],
    });
  });

  it('ferme les jours d’exception et applique les horaires exceptionnels', () => {
    const { days } = compute('2026-11-03', '2026-11-03');
    // Mardi 3 novembre : une plage 10:00–11:30 aux durée et formats de la règle du mardi.
    expect(days[0]).toEqual({
      date: '2026-11-03',
      available: true,
      closedReason: null,
      slots: [
        { startsAt: '2026-11-03T09:00:00.000Z', endsAt: '2026-11-03T10:30:00.000Z', formats: [...ALL] },
      ],
    });
    expect(
      compute('2026-12-25', '2026-12-25', { policy: { minNoticeHours: 0, maxAdvanceDays: 365 } }).days[0],
    ).toEqual({
      date: '2026-12-25',
      available: false,
      closedReason: 'Noël',
      slots: [],
    });
  });

  it('retire les créneaux occupés (chevauchement) et signale un jour complet', () => {
    const busy = [
      // 09:30–10:30 (Douala) : chevauche le créneau de 09:00 ; celui de 10:30 commence à sa fin.
      { start: Date.parse('2026-10-26T08:30:00.000Z'), end: Date.parse('2026-10-26T09:30:00.000Z') },
    ];
    const monday = compute('2026-10-26', '2026-10-26', { busy }).days[0];
    expect(monday?.slots.map((slot) => slot.startsAt)).toEqual([
      '2026-10-26T09:30:00.000Z',
      '2026-10-26T13:00:00.000Z',
    ]);

    const tuesday = compute('2026-10-27', '2026-10-27', {
      busy: [{ start: Date.parse('2026-10-27T08:00:00.000Z'), end: Date.parse('2026-10-27T09:30:00.000Z') }],
    }).days[0];
    expect(tuesday).toEqual({ date: '2026-10-27', available: false, closedReason: 'Complet', slots: [] });
  });

  it('filtre par format', () => {
    const agence = compute('2026-10-26', '2026-10-26', { format: 'AGENCE' }).days[0];
    expect(agence?.slots.map((slot) => slot.startsAt)).toEqual([
      '2026-10-26T08:00:00.000Z',
      '2026-10-26T09:30:00.000Z',
    ]);
    expect(compute('2026-10-24', '2026-10-24', { format: 'AGENCE' }).days[0]).toEqual({
      date: '2026-10-24',
      available: false,
      closedReason: null,
      slots: [],
    });
  });

  it('retrouve un créneau demandé : libre, déjà pris ou inexistant', () => {
    const base = { rules: RULES, exceptions: EXCEPTIONS, policy: POLICY, now: NOW, day: '2026-10-26' };
    const startsAt = new Date('2026-10-26T13:00:00.000Z');
    expect(lookupSlot({ ...base, busy: [], startsAt, format: 'VISIO' })).toEqual({
      status: 'free',
      slot: {
        startsAt: '2026-10-26T13:00:00.000Z',
        endsAt: '2026-10-26T14:00:00.000Z',
        formats: ['TELEPHONE', 'VISIO'],
      },
    });
    expect(
      lookupSlot({
        ...base,
        busy: [{ start: startsAt.getTime(), end: startsAt.getTime() + 1 }],
        startsAt,
        format: 'VISIO',
      }),
    ).toEqual({ status: 'taken' });
    // Format non proposé sur cette plage, heure hors grille.
    expect(lookupSlot({ ...base, busy: [], startsAt, format: 'AGENCE' })).toEqual({ status: 'invalid' });
    expect(
      lookupSlot({ ...base, busy: [], startsAt: new Date('2026-10-26T08:15:00.000Z'), format: 'VISIO' }),
    ).toEqual({ status: 'invalid' });
  });
});
