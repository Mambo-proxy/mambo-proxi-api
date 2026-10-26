import type { Role } from '../../generated/prisma/client.js';
import type { CurrentUser } from './auth.types.js';
import { permissionsOf } from './permissions.js';

function words(name: string): string[] {
  return name.trim().split(/\s+/u).filter(Boolean);
}

/** Initiales sans accents (« Équipe Douala » → « ED », comme les exemples du contrat). */
export function userInitials(name: string): string {
  const letters = words(name)
    .slice(0, 2)
    .map((word) => word.normalize('NFD').replace(/\p{M}/gu, '').charAt(0).toUpperCase())
    .join('');
  return letters || '?';
}

/** Prénom affiché : premier mot du nom. */
export function userFirstName(name: string): string {
  return words(name)[0] ?? name;
}

/** Indice de l'adresse d'envoi du code (`m•••••@mamboproxi.com`). */
export function emailHint(email: string): string {
  const at = email.lastIndexOf('@');
  const local = at > 0 ? email.slice(0, at) : email;
  const domain = at > 0 ? email.slice(at + 1) : '';
  return `${local.charAt(0)}•••••@${domain}`;
}

/** Statut affiché d'un utilisateur (`AdminUser.status`). */
export function userStatus(user: {
  isActive: boolean;
  activatedAt: Date | null;
}): 'ACTIF' | 'INVITE' | 'DESACTIVE' {
  if (!user.isActive) return 'DESACTIVE';
  return user.activatedAt === null ? 'INVITE' : 'ACTIF';
}

/** Schéma `CurrentUser` du contrat. */
export function toCurrentUser(user: {
  id: string;
  email: string;
  name: string;
  role: Role;
  lastLoginAt: Date | null;
}): CurrentUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    firstName: userFirstName(user.name),
    initials: userInitials(user.name),
    role: user.role,
    permissions: permissionsOf(user.role),
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
  };
}
