import type { Role } from '../../generated/prisma/client.js';

/**
 * Permissions du back-office (schéma `Permission` du contrat, dans l'ordre de l'énumération). Chaque opération
 * `/v1/admin` déclare celles qui y donnent accès (`x-permissions` du contrat, `@RequirePermissions` ici) : une seule
 * suffit. Un test vérifie que la liste correspond exactement au contrat.
 */
export const PERMISSIONS = [
  'dashboard:read',
  'analytics:read',
  'team:read',
  'requests:read',
  'requests:read-assigned',
  'requests:write',
  'requests:write-assigned',
  'requests:assign',
  'requests:export',
  'requests:anonymize',
  'requests:revert-status',
  'appointments:read',
  'appointments:read-assigned',
  'appointments:write',
  'appointments:write-assigned',
  'appointments:assign',
  'availability:write',
  'applications:read',
  'applications:write',
  'contacts:read',
  'contacts:write',
  'contacts:export',
  'reviews:moderate',
  'content:read',
  'content:write',
  'media:write',
  'newsletter:read',
  'newsletter:write',
  'settings:read',
  'settings:write',
  'settings:admin',
  'users:manage',
  'audit:read',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** Rôles dans l'ordre d'affichage (`GET /v1/admin/roles`). */
export const ROLES = ['ADMIN', 'MANAGER', 'AGENT', 'EDITOR', 'WRITER'] as const satisfies readonly Role[];

/** Permissions des rôles qui traitent les demandes (MANAGER, EDITOR ; ADMIN en plus des droits sensibles). */
const REQUEST_HANDLING: readonly Permission[] = [
  'requests:read',
  'requests:write',
  'requests:assign',
  'requests:export',
  'requests:anonymize',
  'appointments:read',
  'appointments:write',
  'appointments:assign',
  'availability:write',
  'applications:read',
  'applications:write',
  'contacts:read',
  'contacts:write',
  'contacts:export',
  'reviews:moderate',
];

/**
 * Matrice rôle → permissions du schéma `Role` du contrat (décision de la cliente : l'EDITOR « Équipe Douala » garde
 * l'assignation et l'anonymisation ; le MANAGER voit les contenus en lecture seule). Le back-office ne code pas
 * cette matrice : il la lit dans `CurrentUser.permissions` et `GET /v1/admin/roles`.
 */
const MATRIX: Record<Role, readonly Permission[]> = {
  // Tout, sauf les permissions restreintes aux dossiers assignés (couvertes par les permissions complètes).
  ADMIN: PERMISSIONS.filter((permission) => !permission.endsWith('-assigned')),
  MANAGER: [
    'dashboard:read',
    'analytics:read',
    'team:read',
    ...REQUEST_HANDLING,
    'content:read',
    'newsletter:read',
    'settings:read',
  ],
  AGENT: [
    'dashboard:read',
    'requests:read-assigned',
    'requests:write-assigned',
    'appointments:read-assigned',
    'appointments:write-assigned',
  ],
  EDITOR: [
    'dashboard:read',
    'team:read',
    ...REQUEST_HANDLING,
    'content:read',
    'content:write',
    'media:write',
    'newsletter:read',
    'newsletter:write',
    'settings:read',
    'settings:write',
  ],
  WRITER: ['dashboard:read', 'content:read', 'content:write', 'media:write'],
};

/** Permissions d'un rôle, dans l'ordre de l'énumération du contrat. */
export function permissionsOf(role: Role): Permission[] {
  const granted = new Set(MATRIX[role]);
  return PERMISSIONS.filter((permission) => granted.has(permission));
}

/** Le rôle donne-t-il au moins une des permissions demandées ? */
export function hasAnyPermission(role: Role, required: readonly Permission[]): boolean {
  const granted = new Set(MATRIX[role]);
  return required.some((permission) => granted.has(permission));
}

/** Peut recevoir des demandes et des rendez-vous (`requests:read` ou `requests:read-assigned`). */
export function isAssignableRole(role: Role): boolean {
  return hasAnyPermission(role, ['requests:read', 'requests:read-assigned']);
}

export interface RoleDefinition {
  role: Role;
  label: string;
  description: string;
  permissions: Permission[];
}

/** Libellés et périmètres des rôles (exemple de `GET /v1/admin/roles` du contrat). */
const ROLE_TEXTS: Record<Role, { label: string; description: string }> = {
  ADMIN: {
    label: 'Administrateur·rice',
    description: 'Tout le back-office, paramètres sensibles, utilisateurs et journal compris.',
  },
  MANAGER: {
    label: 'Responsable',
    description:
      'Demandes, rendez-vous, assignation, candidatures, contacts et statistiques ; contenus en lecture.',
  },
  AGENT: {
    label: 'Chargé·e de clientèle',
    description: 'Traite les demandes et rendez-vous qui lui sont assignés.',
  },
  EDITOR: {
    label: 'Éditeur·rice',
    description: 'Demandes et contenus (périmètre historique, inchangé).',
  },
  WRITER: {
    label: 'Rédacteur·rice',
    description:
      'Contenus du site, magazine et médiathèque ; aucun accès aux demandes ni aux données personnelles.',
  },
};

/** `GET /v1/admin/roles`. */
export function roleDefinitions(): RoleDefinition[] {
  return ROLES.map((role) => ({ role, ...ROLE_TEXTS[role], permissions: permissionsOf(role) }));
}

/** Libellé d'un rôle (journal d'activité). */
export function roleLabel(role: Role): string {
  return ROLE_TEXTS[role].label;
}
