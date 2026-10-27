import { Inject, Injectable } from '@nestjs/common';
import { DAY_MS, doualaDay } from '../../common/time/agency-day.js';
import type { AppointmentStatus } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  ADMIN_APPOINTMENT_SELECT,
  effectiveStart,
  toAdminAppointment,
  type AdminAppointment,
  type AdminAppointmentRow,
} from '../appointments/appointment.mapper.js';
import type { AuthContext } from '../auth/auth.types.js';
import {
  OPEN_REQUEST_STATUSES,
  REQUEST_LIST_SELECT,
  compareByUrgency,
  isOverdue,
  toRequestListItem,
  type RequestListItem,
  type RequestListRow,
} from './request.mapper.js';

/** Schéma `MyTasks` du contrat. */
export interface MyTasks {
  generatedAt: string;
  requests: {
    open: number;
    byStatus: { NOUVELLE: number; EN_COURS: number };
    overdue: number;
    dueToday: number;
    items: RequestListItem[];
  };
  appointments: { today: number; toConfirm: number; upcoming: AdminAppointment[] };
  unassigned: number | null;
}

const MAX_REQUEST_ITEMS = 10;
const MAX_UPCOMING_APPOINTMENTS = 5;
/** Rendez-vous à venir : à confirmer, confirmés ou avec un autre créneau proposé (comme `openTasks`). */
const UPCOMING_STATUSES: readonly AppointmentStatus[] = ['A_CONFIRMER', 'CONFIRME', 'AUTRE_CRENEAU_PROPOSE'];
/** Un rendez-vous commencé depuis moins d'une heure reste dans « prochains rendez-vous ». */
const STARTED_GRACE_MS = 60 * 60 * 1000;

/**
 * « Mes tâches » du tableau de bord (`GET /v1/admin/me/tasks`), pour tous les rôles : demandes ouvertes et
 * rendez-vous assignés à l'utilisateur connecté (jour de Douala), demandes ouvertes non assignées pour qui peut
 * assigner (`requests:assign`).
 */
@Injectable()
export class MyTasksService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async tasks(auth: AuthContext, now: Date): Promise<MyTasks> {
    const userId = auth.user.id;
    const { start: todayStart, end: todayEnd } = doualaDay(now);
    const windowStart = new Date(Math.min(todayStart.getTime(), now.getTime() - STARTED_GRACE_MS));
    const windowEnd = new Date(Math.max(todayEnd.getTime(), now.getTime() + 7 * DAY_MS));
    const open = { in: [...OPEN_REQUEST_STATUSES] };

    const [requests, appointments, toConfirm, unassigned] = await Promise.all([
      this.prisma.request.findMany({
        where: { assignedToId: userId, status: open, anonymizedAt: null },
        select: REQUEST_LIST_SELECT,
      }) as Promise<RequestListRow[]>,
      this.prisma.appointment.findMany({
        where: {
          assignedToId: userId,
          status: { in: [...UPCOMING_STATUSES] },
          OR: [
            { startsAt: { gte: windowStart, lt: windowEnd } },
            { proposedStartsAt: { gte: windowStart, lt: windowEnd } },
          ],
        },
        select: ADMIN_APPOINTMENT_SELECT,
      }) as Promise<AdminAppointmentRow[]>,
      this.prisma.appointment.count({ where: { assignedToId: userId, status: 'A_CONFIRMER' } }),
      auth.permissions.includes('requests:assign')
        ? this.prisma.request.count({ where: { assignedToId: null, status: open, anonymizedAt: null } })
        : Promise.resolve(null),
    ]);

    const inToday = (date: Date): boolean =>
      date.getTime() >= todayStart.getTime() && date.getTime() < todayEnd.getTime();
    const overdue = requests.filter((row) => isOverdue(row, now)).length;
    const dueToday = requests.filter(
      (row) => !isOverdue(row, now) && row.dueAt !== null && inToday(row.dueAt),
    ).length;
    const upcoming = appointments
      .filter((row) => {
        const start = effectiveStart(row).getTime();
        return start >= now.getTime() - STARTED_GRACE_MS && start < now.getTime() + 7 * DAY_MS;
      })
      .sort((a, b) => effectiveStart(a).getTime() - effectiveStart(b).getTime())
      .slice(0, MAX_UPCOMING_APPOINTMENTS);

    return {
      generatedAt: now.toISOString(),
      requests: {
        open: requests.length,
        byStatus: {
          NOUVELLE: requests.filter((row) => row.status === 'NOUVELLE').length,
          EN_COURS: requests.filter((row) => row.status === 'EN_COURS').length,
        },
        overdue,
        dueToday,
        items: [...requests]
          .sort((a, b) => compareByUrgency(a, b, now))
          .slice(0, MAX_REQUEST_ITEMS)
          .map((row) => toRequestListItem(row, now)),
      },
      appointments: {
        today: appointments.filter((row) => row.status === 'CONFIRME' && inToday(effectiveStart(row))).length,
        toConfirm,
        upcoming: upcoming.map(toAdminAppointment),
      },
      unassigned,
    };
  }
}
