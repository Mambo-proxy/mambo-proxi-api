import { z } from 'zod';
import { optionalParam } from '../../common/pagination/pagination.js';
import { daysBetween, isDateKey, minutesOfTime } from '../../common/time/agency-day.js';
import { MAX_AVAILABILITY_SPAN_DAYS } from './availability.js';

/** Paramètres et corps des disponibilités (`GET /v1/appointments/availability`, `GET|PUT /v1/admin/availability`). */

export const APPOINTMENT_FORMATS = ['AGENCE', 'TELEPHONE', 'VISIO'] as const;
export const formatSchema = z.enum(APPOINTMENT_FORMATS, {
  error: 'Format inconnu : AGENCE, TELEPHONE ou VISIO.',
});

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const TIME_MESSAGE = 'Heure au format HH:MM (ex. 09:00).';
const END_MESSAGE = 'L’heure de fin doit suivre l’heure de début.';

export const dateKeySchema = z.string().refine(isDateKey, { error: 'Date au format AAAA-MM-JJ attendue.' });
const timeSchema = z.string().regex(TIME_PATTERN, { error: TIME_MESSAGE });
const idSchema = z.string().min(1).max(64);
const optionalId = idSchema.nullish().transform((value) => value ?? null);

/** `GET /v1/appointments/availability` : `from` et `to` inclus, 62 jours au plus. */
export const availabilityQuerySchema = z
  .object({
    from: dateKeySchema,
    to: dateKeySchema,
    format: optionalParam(formatSchema),
  })
  .superRefine((query, ctx) => {
    const span = daysBetween(query.from, query.to);
    if (span < 0)
      ctx.addIssue({ code: 'custom', path: ['to'], message: 'La date de fin doit suivre la date de début.' });
    else if (span > MAX_AVAILABILITY_SPAN_DAYS)
      ctx.addIssue({
        code: 'custom',
        path: ['to'],
        message: `La période demandée doit faire ${String(MAX_AVAILABILITY_SPAN_DAYS)} jours au plus.`,
      });
  });
export type AvailabilityQuery = z.output<typeof availabilityQuerySchema>;

const ruleSchema = z
  .object({
    id: optionalId,
    weekday: z.number().int().min(1).max(7),
    startTime: timeSchema,
    endTime: timeSchema,
    slotMinutes: z.number().int().min(15).max(240),
    formats: z
      .array(formatSchema)
      .min(1, { error: 'Choisissez au moins un format.' })
      .max(3)
      .transform((formats) => APPOINTMENT_FORMATS.filter((format) => formats.includes(format))),
  })
  .superRefine((rule, ctx) => {
    const start = minutesOfTime(rule.startTime);
    const end = minutesOfTime(rule.endTime);
    if (start !== null && end !== null && end <= start)
      ctx.addIssue({ code: 'custom', path: ['endTime'], message: END_MESSAGE });
  });

const optionalTime = z
  .union([timeSchema, z.literal(''), z.null()])
  .optional()
  .transform((value) => value || null);

const exceptionSchema = z
  .object({
    id: optionalId,
    date: dateKeySchema,
    closed: z.boolean(),
    startTime: optionalTime,
    endTime: optionalTime,
    label: z
      .string()
      .trim()
      .max(120)
      .nullish()
      .transform((value) => value || null),
  })
  .superRefine((exception, ctx) => {
    if (exception.closed) return;
    for (const field of ['startTime', 'endTime'] as const)
      if (exception[field] === null)
        ctx.addIssue({
          code: 'custom',
          path: [field],
          params: { code: 'required' },
          message: 'Indiquez les horaires de cette journée, ou cochez « Fermé ».',
        });
    const start = exception.startTime === null ? null : minutesOfTime(exception.startTime);
    const end = exception.endTime === null ? null : minutesOfTime(exception.endTime);
    if (start !== null && end !== null && end <= start)
      ctx.addIssue({ code: 'custom', path: ['endTime'], message: END_MESSAGE });
  })
  // Journée fermée : pas d'horaires.
  .transform((exception) =>
    exception.closed ? { ...exception, startTime: null, endTime: null } : exception,
  );

const httpUrl = z.url({ protocol: /^https?$/, error: 'Saisissez une adresse valide (https://…).' }).max(500);

/**
 * `PUT /v1/admin/availability` (`AvailabilityConfig`) : liste complète des plages et des fermetures (remplace
 * l'existant). `agencyAddress` et `defaultVideoLink` absents : valeurs enregistrées conservées.
 */
export const availabilityConfigSchema = z
  .object({
    rules: z.array(ruleSchema).max(50),
    exceptions: z.array(exceptionSchema).max(366),
    minNoticeHours: z.number().int().min(0).max(168),
    maxAdvanceDays: z.number().int().min(7).max(365),
    agencyAddress: z
      .string()
      .trim()
      .max(200)
      .nullable()
      .optional()
      .transform((value) => (value === undefined ? undefined : value || null)),
    defaultVideoLink: z
      .union([httpUrl, z.literal(''), z.null()])
      .optional()
      .transform((value) => (value === undefined ? undefined : value || null)),
  })
  .superRefine((config, ctx) => {
    // Deux plages d'un même jour ne se chevauchent pas (sinon des créneaux seraient proposés deux fois).
    config.rules.forEach((rule, index) => {
      const start = minutesOfTime(rule.startTime) ?? 0;
      const end = minutesOfTime(rule.endTime) ?? 0;
      const clash = config.rules.findIndex((other, otherIndex) => {
        if (otherIndex >= index || other.weekday !== rule.weekday) return false;
        const otherStart = minutesOfTime(other.startTime) ?? 0;
        const otherEnd = minutesOfTime(other.endTime) ?? 0;
        return start < otherEnd && end > otherStart;
      });
      if (clash >= 0)
        ctx.addIssue({
          code: 'custom',
          path: ['rules', index, 'startTime'],
          message: 'Cette plage chevauche une autre plage du même jour.',
        });
    });
    const seen = new Set<string>();
    config.exceptions.forEach((exception, index) => {
      if (seen.has(exception.date))
        ctx.addIssue({
          code: 'custom',
          path: ['exceptions', index, 'date'],
          message: 'Une seule fermeture ou modification d’horaires par date.',
        });
      seen.add(exception.date);
    });
  });
export type AvailabilityConfigInput = z.output<typeof availabilityConfigSchema>;
