// Utilisateurs : administratrice initiale (variables `SEED_ADMIN_*`) et comptes de démonstration, un par rôle.
import { Role } from '../../../src/generated/prisma/client.js';
import { PasswordService } from '../../../src/modules/auth/password.service.js';
import { logCount, readSeedData, type SeedClock, type Tx } from '../support.js';
import type { UsersSeed } from '../types.js';

export interface SeededUsers {
  /** Identifiant des mocks (`usr_…`) → identifiant en base. L'administratrice des mocks pointe sur `SEED_ADMIN_*`. */
  ids: Map<string, string>;
  adminId: string | null;
}

const MIN_PASSWORD_LENGTH = 12;

/**
 * Mot de passe d'une variable d'environnement (12 caractères minimum), haché en argon2id comme par l'API ; le mot
 * de passe n'est jamais enregistré en clair. Variable absente ou trop courte : `null` (compte sans mot de passe,
 * activé ensuite par « Mot de passe oublié » ou une invitation).
 */
async function passwordFrom(variable: string, passwords: PasswordService): Promise<string | null> {
  const value = process.env[variable];
  if (!value) return null;
  if (process.env['NODE_ENV'] === 'production' && value.includes('change-me')) {
    console.warn(`  ${variable} est ignorée : valeur d'exemple refusée en production.`);
    return null;
  }
  if (value.length < MIN_PASSWORD_LENGTH) {
    console.warn(`  ${variable} est ignorée : ${String(MIN_PASSWORD_LENGTH)} caractères minimum.`);
    return null;
  }
  return passwords.hash(value);
}

/**
 * Administratrice initiale. Compte existant : jamais modifié (nom, rôle et mot de passe restent ceux du
 * back-office), sauf s'il n'a pas encore de mot de passe et que `SEED_ADMIN_PASSWORD` est fournie.
 */
export async function seedAdmin(tx: Tx, clock: SeedClock): Promise<string | null> {
  const email = process.env['SEED_ADMIN_EMAIL']?.trim().toLowerCase();
  const name = process.env['SEED_ADMIN_NAME']?.trim() || 'Administratrice';
  if (!email) {
    console.warn('  SEED_ADMIN_EMAIL est absente : aucun compte administrateur créé.');
    return null;
  }
  const passwordHash = await passwordFrom('SEED_ADMIN_PASSWORD', new PasswordService());
  const activation =
    passwordHash === null ? {} : { passwordHash, passwordChangedAt: clock.now, activatedAt: clock.now };
  const existing = await tx.user.findUnique({ where: { email }, select: { id: true, activatedAt: true } });
  if (existing) {
    if (existing.activatedAt === null && passwordHash !== null)
      await tx.user.update({ where: { id: existing.id }, data: activation });
    logCount('Administrateur', 1);
    return existing.id;
  }
  const admin = await tx.user.create({
    data: {
      email,
      name,
      role: Role.ADMIN,
      passwordHash: null,
      isActive: true,
      invitedAt: clock.now,
      isDemo: false,
      ...activation,
    },
    select: { id: true },
  });
  if (passwordHash === null)
    console.warn(
      '  SEED_ADMIN_PASSWORD est absente : mot de passe à définir par « Mot de passe oublié » sur la page de connexion.',
    );
  logCount('Administrateur', 1);
  return admin.id;
}

/**
 * Comptes de démonstration (MANAGER, AGENT, EDITOR, WRITER), marqués `isDemo`. Mot de passe commun lu dans
 * `SEED_DEMO_PASSWORD` (développement et tests uniquement : ignorée si `NODE_ENV=production`) ; sans cette
 * variable, les comptes n'ont pas de mot de passe (statut « invité »).
 */
export async function seedDemoUsers(tx: Tx, clock: SeedClock, adminId: string | null): Promise<SeededUsers> {
  const data = readSeedData<UsersSeed>('users');
  const ids = new Map<string, string>();
  if (adminId) ids.set(data.mockAdminId, adminId);
  const production = process.env['NODE_ENV'] === 'production';
  if (production && process.env['SEED_DEMO_PASSWORD'])
    console.warn('  SEED_DEMO_PASSWORD est ignorée en production.');
  const passwords = new PasswordService();
  for (const user of data.demoUsers) {
    const passwordHash = production ? null : await passwordFrom('SEED_DEMO_PASSWORD', passwords);
    const fields = {
      name: user.name,
      role: user.role,
      isActive: true,
      isDemo: true,
      lastLoginAt: clock.optionalDate(user.lastLoginAt),
      lastActiveAt: clock.optionalDate(user.lastActiveAt),
      // Remis à chaque lancement, comme les autres données de démonstration.
      failedLoginCount: 0,
      lockedUntil: null,
      ...(passwordHash === null
        ? {}
        : { passwordHash, passwordChangedAt: clock.now, activatedAt: clock.date(user.createdAt) }),
    };
    const saved = await tx.user.upsert({
      where: { email: user.email },
      update: fields,
      create: {
        ...fields,
        email: user.email,
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
