import type { Prisma } from '../../generated/prisma/client.js';
import type { AuthContext } from '../auth/auth.types.js';
import type { Permission } from '../auth/permissions.js';
import { requestViewer, visibleRequestsWhere } from '../requests/request-filters.js';

/** Périmètre d'un dossier : tous, ceux assignés à l'utilisateur, aucun. */
export type FolderScope = 'all' | 'assigned' | 'none';

/**
 * Ce que l'utilisateur connecté voit dans les écrans transverses (tableau de bord, pastilles, recherche) : chaque
 * bloc suit les permissions de l'opération correspondante (`requests:read-assigned` → dossiers assignés seulement,
 * aucune permission → bloc vide).
 */
export interface DashboardScope {
  userId: string;
  requests: FolderScope;
  appointments: FolderScope;
  reviews: boolean;
  applications: boolean;
  contacts: boolean;
  content: boolean;
  newsletter: boolean;
  analytics: boolean;
}

const folderScope = (auth: AuthContext, full: Permission, assigned: Permission): FolderScope =>
  auth.permissions.includes(full) ? 'all' : auth.permissions.includes(assigned) ? 'assigned' : 'none';

export function dashboardScope(auth: AuthContext): DashboardScope {
  const has = (permission: Permission): boolean => auth.permissions.includes(permission);
  return {
    userId: auth.user.id,
    requests: folderScope(auth, 'requests:read', 'requests:read-assigned'),
    appointments: folderScope(auth, 'appointments:read', 'appointments:read-assigned'),
    reviews: has('reviews:moderate'),
    applications: has('applications:read'),
    contacts: has('contacts:read'),
    content: has('content:read'),
    newsletter: has('newsletter:read'),
    analytics: has('analytics:read'),
  };
}

/** Demandes visibles (anonymisées exclues) ; `null` sans permission sur les demandes. */
export function scopedRequestsWhere(
  auth: AuthContext,
  scope: DashboardScope,
): Prisma.RequestWhereInput | null {
  return scope.requests === 'none' ? null : visibleRequestsWhere(requestViewer(auth));
}

/**
 * Rendez-vous visibles : ceux d'une demande anonymisée ou d'un contact effacé sont exclus ; `null` sans permission
 * sur les rendez-vous.
 */
export function scopedAppointmentsWhere(scope: DashboardScope): Prisma.AppointmentWhereInput | null {
  if (scope.appointments === 'none') return null;
  return {
    contact: { anonymizedAt: null },
    OR: [{ requestId: null }, { request: { is: { anonymizedAt: null } } }],
    ...(scope.appointments === 'assigned' ? { assignedToId: scope.userId } : {}),
  };
}

/** Candidatures visibles (demande liée non anonymisée). */
export const VISIBLE_APPLICATIONS: Prisma.JobApplicationWhereInput = { request: { anonymizedAt: null } };

/** Avis « À valider » (ceux des demandes anonymisées sont masqués à l'anonymisation : jamais à valider). */
export const REVIEWS_TO_VALIDATE: Prisma.ReviewWhereInput = { status: 'A_VALIDER' };
