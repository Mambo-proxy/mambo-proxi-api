// Notifications et journal d'activité de démonstration (maquettes du tableau de bord et de Paramètres › Journal).
// Ces tables n'ont pas de colonne `isDemo` : `pnpm db:purge-demo` les supprime par leurs identifiants (`ntf_…`,
// `aud_…`), lus dans le même fichier de données.
import {
  logCount,
  mapId,
  nullableJson,
  readSeedData,
  type IdMap,
  type SeedClock,
  type Tx,
} from '../support.js';
import type { ActivitySeed } from '../types.js';

export async function seedActivity(tx: Tx, clock: SeedClock, users: IdMap): Promise<void> {
  const { notifications, auditLogs } = readSeedData<ActivitySeed>('activity');

  let delivered = 0;
  for (const { id, userId, ...notification } of notifications) {
    const recipient = mapId(users, userId);
    if (!recipient) continue;
    const data = {
      ...notification,
      userId: recipient,
      title: clock.relabel(notification.title),
      readAt: clock.optionalDate(notification.readAt),
      createdAt: clock.date(notification.createdAt),
    };
    await tx.notification.upsert({ where: { id }, update: data, create: { ...data, id } });
    delivered += 1;
  }
  logCount('Notifications', delivered);

  for (const { id, ...entry } of auditLogs) {
    const data = {
      ...entry,
      actorId: mapId(users, entry.actorId),
      label: clock.relabel(entry.label),
      before: nullableJson(entry.before),
      after: nullableJson(entry.after),
      createdAt: clock.date(entry.createdAt),
    };
    await tx.auditLog.upsert({ where: { id }, update: data, create: { ...data, id } });
  }
  logCount("Entrées du journal d'activité", auditLogs.length);
}
