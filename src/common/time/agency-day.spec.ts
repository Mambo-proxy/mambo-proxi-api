import { describe, expect, it } from 'vitest';
import {
  addDays,
  daysBetween,
  doualaDate,
  doualaDay,
  doualaInstant,
  doualaTime,
  isDateKey,
  isoWeekday,
  minutesOfTime,
} from './agency-day.js';

describe('journée de Douala (UTC+1, sans heure d’été)', () => {
  it('borne la journée locale', () => {
    const { start, end } = doualaDay(new Date('2026-10-26T23:30:00.000Z'));
    expect(start.toISOString()).toBe('2026-10-26T23:00:00.000Z');
    expect(end.toISOString()).toBe('2026-10-27T23:00:00.000Z');
    expect(doualaDate(new Date('2026-12-31T23:30:00.000Z'))).toBe('2027-01-01');
  });

  it('convertit une heure locale en instant UTC avec un décalage fixe, de part et d’autre du changement d’heure européen', () => {
    // Heure d'été européenne jusqu'au 25 octobre 2026, heure d'hiver ensuite : Douala ne bouge pas.
    expect(doualaInstant('2026-10-24', 9 * 60).toISOString()).toBe('2026-10-24T08:00:00.000Z');
    expect(doualaInstant('2026-10-26', 9 * 60).toISOString()).toBe('2026-10-26T08:00:00.000Z');
    expect(doualaInstant('2026-03-30', 9 * 60).toISOString()).toBe('2026-03-30T08:00:00.000Z');
    expect(doualaTime(new Date('2026-07-01T08:00:00.000Z'))).toBe('09:00');
    expect(doualaTime(new Date('2026-12-01T08:00:00.000Z'))).toBe('09:00');
  });

  it('valide et manipule les dates `AAAA-MM-JJ` et les heures `HH:MM`', () => {
    expect(isDateKey('2026-02-28')).toBe(true);
    expect(isDateKey('2026-02-30')).toBe(false);
    expect(isDateKey('26-02-01')).toBe(false);
    expect(minutesOfTime('09:30')).toBe(570);
    expect(minutesOfTime('24:00')).toBeNull();
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(daysBetween('2026-10-01', '2026-12-02')).toBe(62);
    expect(isoWeekday('2026-10-26')).toBe(1);
    expect(isoWeekday('2026-10-25')).toBe(7);
  });
});
