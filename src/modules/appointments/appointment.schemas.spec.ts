import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { frenchErrorMap, issuesToProblemErrors } from '../../common/validation/zod-issues.js';
import {
  adminAppointmentInputSchema,
  appointmentActionSchema,
  listAppointmentsQuerySchema,
} from './appointment.schemas.js';
import { availabilityConfigSchema, availabilityQuerySchema } from './availability.schemas.js';

function errors(schema: z.ZodType, value: unknown): { path: string; message: string }[] {
  const result = schema.safeParse(value, { error: frenchErrorMap });
  if (result.success) return [];
  return issuesToProblemErrors(result.error.issues).map(({ path, message }) => ({ path, message }));
}

const CONFIG = {
  rules: [
    {
      weekday: 1,
      startTime: '09:00',
      endTime: '12:00',
      slotMinutes: 90,
      formats: ['VISIO', 'AGENCE', 'VISIO'],
    },
  ],
  exceptions: [{ date: '2026-12-25', closed: true, startTime: '09:00', endTime: null, label: ' Noël ' }],
  minNoticeHours: 24,
  maxAdvanceDays: 60,
};

describe('schémas des rendez-vous', () => {
  it('normalise les disponibilités (formats uniques et ordonnés, journée fermée sans horaires)', () => {
    const parsed = availabilityConfigSchema.parse(CONFIG);
    expect(parsed.rules[0]?.formats).toEqual(['AGENCE', 'VISIO']);
    expect(parsed.rules[0]?.id).toBeNull();
    expect(parsed.exceptions[0]).toEqual({
      id: null,
      date: '2026-12-25',
      closed: true,
      startTime: null,
      endTime: null,
      label: 'Noël',
    });
    expect(parsed.agencyAddress).toBeUndefined();
    expect(
      availabilityConfigSchema.parse({ ...CONFIG, agencyAddress: '', defaultVideoLink: '' }),
    ).toMatchObject({
      agencyAddress: null,
      defaultVideoLink: null,
    });
  });

  it('refuse des disponibilités incohérentes, avec le chemin de chaque champ', () => {
    expect(
      errors(availabilityConfigSchema, {
        rules: [
          { weekday: 1, startTime: '09:00', endTime: '08:00', slotMinutes: 90, formats: ['VISIO'] },
          { weekday: 2, startTime: '09:00', endTime: '12:00', slotMinutes: 10, formats: [] },
          { weekday: 3, startTime: '09:00', endTime: '12:00', slotMinutes: 60, formats: ['VISIO'] },
          { weekday: 3, startTime: '11:00', endTime: '13:00', slotMinutes: 60, formats: ['VISIO'] },
        ],
        exceptions: [
          { date: '2026-02-30', closed: true },
          { date: '2026-12-24', closed: false, startTime: '09:00', endTime: null },
          { date: '2026-12-31', closed: true },
          { date: '2026-12-31', closed: true },
        ],
        minNoticeHours: 200,
        maxAdvanceDays: 3,
        defaultVideoLink: 'ftp://exemple',
      }).map((error) => error.path),
    ).toEqual([
      'rules.0.endTime',
      'rules.1.slotMinutes',
      'rules.1.formats',
      'exceptions.0.date',
      'exceptions.1.endTime',
      'minNoticeHours',
      'maxAdvanceDays',
      'defaultVideoLink',
      // Contrôles d'ensemble, signalés en même temps que les erreurs des champs.
      'rules.3.startTime',
      'exceptions.3.date',
    ]);
    expect(
      errors(availabilityConfigSchema, {
        ...CONFIG,
        rules: [
          { weekday: 3, startTime: '09:00', endTime: '12:00', slotMinutes: 60, formats: ['VISIO'] },
          { weekday: 3, startTime: '11:00', endTime: '13:00', slotMinutes: 60, formats: ['VISIO'] },
        ],
        exceptions: [
          { date: '2026-12-31', closed: true },
          { date: '2026-12-31', closed: true },
        ],
      }),
    ).toEqual([
      { path: 'rules.1.startTime', message: 'Cette plage chevauche une autre plage du même jour.' },
      { path: 'exceptions.1.date', message: 'Une seule fermeture ou modification d’horaires par date.' },
    ]);
  });

  it('borne la période des disponibilités à 62 jours', () => {
    expect(availabilityQuerySchema.parse({ from: '2026-10-01', to: '2026-12-02' })).toEqual({
      from: '2026-10-01',
      to: '2026-12-02',
    });
    expect(errors(availabilityQuerySchema, { from: '2026-10-01', to: '2026-12-03' })).toEqual([
      { path: 'to', message: 'La période demandée doit faire 62 jours au plus.' },
    ]);
    expect(
      errors(availabilityQuerySchema, { from: '2026-10-02', to: '2026-10-01', format: 'PIGEON' }).map(
        (e) => e.path,
      ),
    ).toEqual(['format']);
  });

  it('lit les actions du back-office et refuse une action inconnue', () => {
    expect(appointmentActionSchema.parse({ action: 'cancel', message: '  ' })).toEqual({
      action: 'cancel',
      message: null,
    });
    expect(appointmentActionSchema.parse({ action: 'confirm', videoLink: '' })).toEqual({
      action: 'confirm',
      videoLink: null,
      location: undefined,
    });
    expect(errors(appointmentActionSchema, { action: 'reporter' }).map((error) => error.path)).toEqual([
      'action',
    ]);
    expect(errors(appointmentActionSchema, { action: 'propose' }).map((error) => error.path)).toEqual([
      'proposedStartsAt',
    ]);
  });

  it('applique les valeurs par défaut de la saisie manuelle', () => {
    const parsed = adminAppointmentInputSchema.parse({
      contact: { fullName: 'Aminata Diallo', email: 'Aminata@Example.com', phone: '+237600000000' },
      reason: 'DEVIS',
      format: 'VISIO',
      startsAt: '2026-11-12T13:00:00.000Z',
    });
    expect(parsed).toMatchObject({ durationMinutes: 90, notifyClient: true, notes: null });
    expect(parsed.contact.email).toBe('aminata@example.com');
    expect(parsed.assignedToId).toBeUndefined();
  });

  it('exige une période valide pour l’agenda', () => {
    expect(
      errors(listAppointmentsQuerySchema, { from: '2026-10-05T00:00:00Z', to: '2026-10-05T00:00:00Z' }),
    ).toEqual([{ path: 'to', message: 'La fin de la période doit suivre son début.' }]);
    expect(
      errors(listAppointmentsQuerySchema, { from: 'lundi', to: '2026-10-05T00:00:00Z', status: 'X' }).map(
        (e) => e.path,
      ),
    ).toEqual(['from', 'status']);
  });
});
