import { searchKey } from '../../common/text/search-key.js';
import { DAY_MS, doualaDay } from '../../common/time/agency-day.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { AuthContext } from '../auth/auth.types.js';
import { OPEN_REQUEST_STATUSES } from './request.mapper.js';
import type { RequestFilters } from './request.schemas.js';

/**
 * Périmètre de l'utilisateur connecté : toutes les demandes (`requests:read`) ou seulement celles qui lui sont
 * assignées (`requests:read-assigned` seule). Les demandes anonymisées ne sont plus affichées (404).
 */
export interface RequestViewer {
  userId: string;
  assignedOnly: boolean;
}

export function requestViewer(auth: AuthContext): RequestViewer {
  return {
    userId: auth.user.id,
    assignedOnly:
      !auth.permissions.includes('requests:read') && auth.permissions.includes('requests:read-assigned'),
  };
}

/** Demandes visibles par l'utilisateur. */
export function visibleRequestsWhere(viewer: RequestViewer): Prisma.RequestWhereInput {
  return viewer.assignedOnly ? { anonymizedAt: null, assignedToId: viewer.userId } : { anonymizedAt: null };
}

/** Échéances des demandes ouvertes (`due`) : en retard, aujourd'hui à Douala, dans les 7 prochains jours. */
function dueWhere(due: NonNullable<RequestFilters['due']>, now: Date): Prisma.RequestWhereInput {
  const open = { status: { in: [...OPEN_REQUEST_STATUSES] } };
  switch (due) {
    case 'overdue':
      return { ...open, dueAt: { lt: now } };
    case 'today': {
      const { start, end } = doualaDay(now);
      return { ...open, dueAt: { gte: start, lt: end } };
    }
    case 'week':
      return { ...open, dueAt: { gte: now, lt: new Date(now.getTime() + 7 * DAY_MS) } };
  }
}

/**
 * Filtres de la liste et de l'export (hors statut, appliqué à part pour calculer les compteurs des onglets).
 * Quartier et recherche : comparaison sans accents ni casse sur les clés `city_key` et `search_text`.
 */
export function requestFiltersWhere(
  filters: Omit<RequestFilters, 'status'> & { q?: string | undefined },
  viewer: RequestViewer,
  now: Date,
): Prisma.RequestWhereInput {
  const parts: Prisma.RequestWhereInput[] = [visibleRequestsWhere(viewer)];
  if (filters.type) parts.push({ type: filters.type });
  if (filters.category) parts.push({ category: { slug: filters.category } });
  if (filters.country) parts.push({ contact: { country: filters.country } });
  if (filters.district) {
    const district = searchKey(filters.district);
    if (district !== '') parts.push({ contact: { cityKey: { startsWith: district } } });
  }
  if (filters.assignee === 'me') parts.push({ assignedToId: viewer.userId });
  else if (filters.assignee === 'none') parts.push({ assignedToId: null });
  else if (filters.assignee) parts.push({ assignedToId: filters.assignee });
  if (filters.due) parts.push(dueWhere(filters.due, now));
  if (filters.from) parts.push({ createdAt: { gte: new Date(filters.from) } });
  if (filters.to) parts.push({ createdAt: { lte: new Date(filters.to) } });
  if (filters.q) {
    const q = searchKey(filters.q);
    if (q !== '')
      parts.push({ OR: [{ searchText: { contains: q } }, { contact: { searchText: { contains: q } } }] });
  }
  return { AND: parts };
}
