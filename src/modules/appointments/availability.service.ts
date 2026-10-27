import { Inject, Injectable } from '@nestjs/common';
import { recordAudit, type AuditActor } from '../../common/audit/audit-log.js';
import { asObject, readNullableNumber, readNullableString } from '../../common/json/json-read.js';
import { DAY_MS, addDays, doualaDate, doualaInstant, type DateKey } from '../../common/time/agency-day.js';
import type { AppointmentFormat, Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { SETTING_KEYS } from '../settings/settings.constants.js';
import { blockingAppointments } from './appointment-slots.js';
import {
  computeAvailability,
  lookupSlot,
  type Availability,
  type AvailabilityExceptionValue,
  type AvailabilityRuleValue,
  type BookingPolicy,
  type SlotLookup,
} from './availability.js';
import type { AvailabilityConfigInput, AvailabilityQuery } from './availability.schemas.js';

/** Schéma `AvailabilityConfig` du contrat. */
export interface AvailabilityConfig extends BookingPolicy {
  rules: (AvailabilityRuleValue & { id: string })[];
  exceptions: (AvailabilityExceptionValue & { id: string })[];
  agencyAddress: string | null;
  defaultVideoLink: string | null;
}

/** Valeurs du paramètre `availability` jamais enregistré (exemple du contrat). */
export const DEFAULT_BOOKING_POLICY: BookingPolicy = { minNoticeHours: 24, maxAdvanceDays: 60 };

type Client = Pick<Prisma.TransactionClient, 'availabilityRule' | 'availabilityException' | 'setting'>;

const RULE_SELECT = {
  id: true,
  weekday: true,
  startTime: true,
  endTime: true,
  slotMinutes: true,
  formats: true,
} as const;
const EXCEPTION_SELECT = {
  id: true,
  date: true,
  closed: true,
  startTime: true,
  endTime: true,
  label: true,
} as const;

/** Colonne `date` (`@db.Date`) : minuit UTC du jour. */
const toDateColumn = (day: DateKey): Date => new Date(`${day}T00:00:00.000Z`);
const fromDateColumn = (date: Date): DateKey => date.toISOString().slice(0, 10);

function boundedInteger(value: number | null, min: number, max: number, fallback: number): number {
  return value !== null && Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

/**
 * Disponibilités de la prise de rendez-vous : plages hebdomadaires (`availability_rules`), fermetures et horaires
 * exceptionnels (`availability_exceptions`), délai minimal, horizon, adresse de l'agence et lien de visio par défaut
 * (paramètre `availability`). Les créneaux libres sont recalculés à chaque demande (aucun cache : ils dépendent de
 * l'heure et des rendez-vous pris).
 */
@Injectable()
export class AvailabilityService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** `GET /v1/admin/availability` */
  async config(client: Client = this.prisma): Promise<AvailabilityConfig> {
    // Lectures l'une après l'autre : dans une transaction, les requêtes passent par une seule connexion.
    const rules = await client.availabilityRule.findMany({
      select: RULE_SELECT,
      orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }, { id: 'asc' }],
    });
    const exceptions = await client.availabilityException.findMany({
      select: EXCEPTION_SELECT,
      orderBy: [{ date: 'asc' }, { id: 'asc' }],
    });
    const setting = await client.setting.findUnique({
      where: { key: SETTING_KEYS.availability },
      select: { value: true },
    });
    const value = asObject(setting?.value);
    return {
      rules: rules.map((rule) => ({ ...rule, formats: [...rule.formats] })),
      exceptions: exceptions.map((exception) => ({ ...exception, date: fromDateColumn(exception.date) })),
      minNoticeHours: boundedInteger(
        readNullableNumber(value, 'minNoticeHours'),
        0,
        168,
        DEFAULT_BOOKING_POLICY.minNoticeHours,
      ),
      maxAdvanceDays: boundedInteger(
        readNullableNumber(value, 'maxAdvanceDays'),
        7,
        365,
        DEFAULT_BOOKING_POLICY.maxAdvanceDays,
      ),
      agencyAddress: readNullableString(value, 'agencyAddress'),
      defaultVideoLink: readNullableString(value, 'defaultVideoLink'),
    };
  }

  /**
   * `PUT /v1/admin/availability` : remplace les plages et les fermetures (identifiants connus conservés, les autres
   * recréés), enregistre délai, horizon, adresse et lien par défaut. Les rendez-vous déjà pris ne sont pas touchés.
   */
  async save(input: AvailabilityConfigInput, actor: AuditActor): Promise<AvailabilityConfig> {
    await this.prisma.$transaction(async (tx) => {
      const current = await this.config(tx);
      const ruleIds = new Set(current.rules.map((rule) => rule.id));
      const exceptionIds = new Set(current.exceptions.map((exception) => exception.id));
      const keptRules = input.rules.filter((rule) => rule.id !== null && ruleIds.has(rule.id));
      const keptExceptions = input.exceptions.filter(
        (exception) => exception.id !== null && exceptionIds.has(exception.id),
      );

      await tx.availabilityRule.deleteMany({
        where: { id: { notIn: keptRules.map((rule) => rule.id ?? '') } },
      });
      for (const rule of keptRules)
        await tx.availabilityRule.update({
          where: { id: rule.id ?? '' },
          data: {
            weekday: rule.weekday,
            startTime: rule.startTime,
            endTime: rule.endTime,
            slotMinutes: rule.slotMinutes,
            formats: rule.formats,
          },
          select: { id: true },
        });
      const newRules = input.rules.filter((rule) => !keptRules.includes(rule));
      if (newRules.length > 0)
        await tx.availabilityRule.createMany({
          data: newRules.map((rule) => ({
            weekday: rule.weekday,
            startTime: rule.startTime,
            endTime: rule.endTime,
            slotMinutes: rule.slotMinutes,
            formats: rule.formats,
          })),
        });

      await tx.availabilityException.deleteMany({
        where: { id: { notIn: keptExceptions.map((exception) => exception.id ?? '') } },
      });
      for (const exception of keptExceptions)
        await tx.availabilityException.update({
          where: { id: exception.id ?? '' },
          data: {
            date: toDateColumn(exception.date),
            closed: exception.closed,
            startTime: exception.startTime,
            endTime: exception.endTime,
            label: exception.label,
          },
          select: { id: true },
        });
      const newExceptions = input.exceptions.filter((exception) => !keptExceptions.includes(exception));
      if (newExceptions.length > 0)
        await tx.availabilityException.createMany({
          data: newExceptions.map((exception) => ({
            date: toDateColumn(exception.date),
            closed: exception.closed,
            startTime: exception.startTime,
            endTime: exception.endTime,
            label: exception.label,
          })),
        });

      const value: Prisma.InputJsonObject = {
        minNoticeHours: input.minNoticeHours,
        maxAdvanceDays: input.maxAdvanceDays,
        agencyAddress: input.agencyAddress === undefined ? current.agencyAddress : input.agencyAddress,
        defaultVideoLink:
          input.defaultVideoLink === undefined ? current.defaultVideoLink : input.defaultVideoLink,
      };
      await tx.setting.upsert({
        where: { key: SETTING_KEYS.availability },
        create: { key: SETTING_KEYS.availability, value },
        update: { value },
        select: { key: true },
      });
      await recordAudit(tx, actor, {
        action: 'availability.update',
        entity: 'Availability',
        entityId: null,
        label: 'A modifié les disponibilités de la prise de rendez-vous',
        before: {
          rules: current.rules.length,
          exceptions: current.exceptions.length,
          minNoticeHours: current.minNoticeHours,
          maxAdvanceDays: current.maxAdvanceDays,
        },
        after: {
          rules: input.rules.length,
          exceptions: input.exceptions.length,
          minNoticeHours: input.minNoticeHours,
          maxAdvanceDays: input.maxAdvanceDays,
        },
      });
    });
    return this.config();
  }

  /** `GET /v1/appointments/availability` */
  async availability(query: AvailabilityQuery, now: Date): Promise<Availability> {
    const config = await this.config();
    const busy = await this.busyIntervals(this.prisma, query.from, query.to);
    return computeAvailability({ ...config, policy: config, busy, ...query, now });
  }

  /**
   * Créneau demandé en ligne (`POST /v1/appointments`), lu dans la transaction de la réservation (après le verrou) :
   * libre, déjà pris ou inexistant.
   */
  async lookup(
    client: Client & Pick<Prisma.TransactionClient, 'appointment'>,
    startsAt: Date,
    format: AppointmentFormat,
    now: Date,
  ): Promise<SlotLookup> {
    const config = await this.config(client);
    const day = doualaDate(startsAt);
    const busy = await this.busyIntervals(client, day, day);
    return lookupSlot({ ...config, policy: config, busy, day, startsAt, format, now });
  }

  private async busyIntervals(
    client: Pick<Prisma.TransactionClient, 'appointment'>,
    from: DateKey,
    to: DateKey,
  ) {
    const window = {
      start: doualaInstant(from, 0).getTime(),
      end: doualaInstant(addDays(to, 1), 0).getTime(),
    };
    // Marge d'un jour : un rendez-vous de la veille au soir peut déborder sur le jour demandé.
    const found = await blockingAppointments(client, { start: window.start - DAY_MS, end: window.end });
    return found.map((item) => item.interval);
  }
}
