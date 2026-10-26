// Utilisateurs : administratrice initiale (variables `SEED_ADMIN_*`) et comptes de démonstration, un par rôle.
import { Role } from '../../../src/generated/prisma/client.js';
import { logCount, readSeedData, type SeedClock, type Tx } from '../support.js';
import type { UsersSeed } from '../types.js';

export interface SeededUsers {
  /** Identifiant des mocks (`usr_…`) → identifiant en base. L'administratrice des mocks pointe sur `SEED_ADMIN_*`. */
  ids: Map<string, string>;
  adminId: string | null;
}

/**
 * Le mot de passe n'est jamais enregistré en clair. argon2id n'étant pas encore une dépendance de l'API, le seed
 * laisse `passwordHash` à null : le mot de passe est défini à l'invitation ou à la première connexion (lien
 * « Mot de passe oublié »), par le module d'authentification qui en assure le hachage.
 */
export async function seedAdmin(tx: Tx, clock: SeedClock): Promise<string | null> {
  const email = process.env['SEED_ADMIN_EMAIL']?.trim().toLowerCase();
  const name = process.env['SEED_ADMIN_NAME']?.trim() || 'Administratrice';
  if (!email) {
    console.warn('  SEED_ADMIN_EMAIL est absente : aucun compte administrateur créé.');
    return null;
  }
  const admin = await tx.user.upsert({
    where: { email },
    // Un compte existant n'est jamais modifié (nom, rôle et mot de passe restent ceux du back-office).
    update: {},
    create: {
      email,
      name,
      role: Role.ADMIN,
      passwordHash: null, // défini à l'invitation / à la première connexion
      isActive: true,
      invitedAt: clock.now,
      isDemo: false,
    },
    select: { id: true },
  });
  if (process.env['SEED_ADMIN_PASSWORD'])
    console.warn(
      '  SEED_ADMIN_PASSWORD est ignorée : le mot de passe sera défini à la première connexion (lien « Mot de passe oublié »).',
    );
  logCount('Administrateur', 1);
  return admin.id;
}

/** Comptes de démonstration (MANAGER, AGENT, EDITOR, WRITER), sans mot de passe, marqués `isDemo`. */
export async function seedDemoUsers(tx: Tx, clock: SeedClock, adminId: string | null): Promise<SeededUsers> {
  const data = readSeedData<UsersSeed>('users');
  const ids = new Map<string, string>();
  if (adminId) ids.set(data.mockAdminId, adminId);
  for (const user of data.demoUsers) {
    const fields = {
      name: user.name,
      role: user.role,
      isActive: true,
      isDemo: true,
      lastLoginAt: clock.optionalDate(user.lastLoginAt),
      lastActiveAt: clock.optionalDate(user.lastActiveAt),
    };
    const saved = await tx.user.upsert({
      where: { email: user.email },
      update: fields,
      create: {
        ...fields,
        email: user.email,
        passwordHash: null, // défini à l'invitation / à la première connexion
        invitedAt: clock.date(user.createdAt),
        invitedById: adminId,
        createdAt: clock.date(user.createdAt),
      },
      select: { id: true },
    });
    ids.set(user.id, saved.id);
  }
  logCount('Comptes de démonstration', data.demoUsers.length);
  return { ids, adminId };
}
