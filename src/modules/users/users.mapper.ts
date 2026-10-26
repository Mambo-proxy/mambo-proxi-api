import type { Role } from '../../generated/prisma/client.js';
import { isAssignableRole } from '../auth/permissions.js';
import { userInitials, userStatus } from '../auth/user-identity.js';

/** Colonnes d'un utilisateur affiché dans le back-office (schéma `AdminUser`). */
export const ADMIN_USER_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  isActive: true,
  activatedAt: true,
  invitedAt: true,
  lastLoginAt: true,
  lastActiveAt: true,
  createdAt: true,
} as const;

export interface AdminUserRow {
  id: string;
  email: string;
  name: string;
  role: Role;
  isActive: boolean;
  activatedAt: Date | null;
  invitedAt: Date | null;
  lastLoginAt: Date | null;
  lastActiveAt: Date | null;
  createdAt: Date;
}

/** Schéma `AdminUser` du contrat. */
export interface AdminUser {
  id: string;
  email: string;
  name: string;
  initials: string;
  role: Role;
  isActive: boolean;
  status: 'ACTIF' | 'INVITE' | 'DESACTIVE';
  invitedAt: string | null;
  lastLoginAt: string | null;
  lastActiveAt: string | null;
  createdAt: string;
}

const iso = (value: Date | null): string | null => value?.toISOString() ?? null;

export function toAdminUser(row: AdminUserRow): AdminUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    initials: userInitials(row.name),
    role: row.role,
    isActive: row.isActive,
    status: userStatus(row),
    invitedAt: iso(row.invitedAt),
    lastLoginAt: iso(row.lastLoginAt),
    lastActiveAt: iso(row.lastActiveAt),
    createdAt: row.createdAt.toISOString(),
  };
}

/** Schéma `TeamMemberPresence` du contrat. */
export interface TeamMemberPresence {
  user: { id: string; name: string; initials: string };
  role: Role;
  online: boolean;
  lastActiveAt: string | null;
  lastLoginAt: string | null;
  assignable: boolean;
  openTasks: number;
}

/** Schéma `TeamPresence` du contrat. */
export interface TeamPresence {
  onlineWindowMinutes: number;
  onlineCount: number;
  generatedAt: string;
  data: TeamMemberPresence[];
}

export function toPresence(
  row: { id: string; name: string; role: Role; lastActiveAt: Date | null; lastLoginAt: Date | null },
  online: boolean,
  openTasks: number,
): TeamMemberPresence {
  return {
    user: { id: row.id, name: row.name, initials: userInitials(row.name) },
    role: row.role,
    online,
    lastActiveAt: iso(row.lastActiveAt),
    lastLoginAt: iso(row.lastLoginAt),
    assignable: isAssignableRole(row.role),
    openTasks,
  };
}

/** Connectés d'abord, puis par dernière activité décroissante (jamais actif en dernier), puis par nom. */
export function compareByPresence(a: TeamMemberPresence, b: TeamMemberPresence): number {
  const time = (value: string | null): number => (value === null ? -Infinity : Date.parse(value));
  return (
    Number(b.online) - Number(a.online) ||
    time(b.lastActiveAt) - time(a.lastActiveAt) ||
    a.user.name.localeCompare(b.user.name, 'fr')
  );
}
