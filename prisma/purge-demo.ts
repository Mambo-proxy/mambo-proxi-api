// Suppression des données de démonstration (`pnpm db:purge-demo`) : tout ce que le seed a marqué `isDemo`, dans
// l'ordre des clés étrangères, en une seule transaction. Les données de référence (paramètres, pages, rubriques,
// services, zones, médias utilisés) et les données réelles sont conservées.
import { createSeedClient, readSeedData, TRANSACTION_OPTIONS, type Tx } from './seed/support.js';
import type { ActivitySeed } from './seed/types.js';

const DEMO = { isDemo: true } as const;

async function purge(tx: Tx): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const count = async (label: string, run: Promise<{ count: number }>) => {
    counts[label] = (await run).count;
  };

  // Identifiants des contenus de démonstration dont les médias sont référencés (usages tenus par l'API).
  const [events, editions, articles, services, partners] = await Promise.all([
    tx.event.findMany({ where: DEMO, select: { id: true } }),
    tx.magazineEdition.findMany({ where: DEMO, select: { id: true } }),
    tx.magazineArticle.findMany({ where: DEMO, select: { id: true } }),
    tx.service.findMany({ where: DEMO, select: { id: true, offers: { select: { id: true } } } }),
    tx.partner.findMany({ where: DEMO, select: { id: true } }),
  ]);
  const demoEntityIds = [
    ...events,
    ...editions,
    ...articles,
    ...services,
    ...services.flatMap((service) => service.offers),
    ...partners,
  ].map((item) => item.id);

  // Notifications et journal : pas de colonne `isDemo`, identifiants du fichier de données du seed.
  const activity = readSeedData<ActivitySeed>('activity');
  await count(
    'Notifications',
    tx.notification.deleteMany({ where: { id: { in: activity.notifications.map((n) => n.id) } } }),
  );
  await count(
    "Entrées du journal d'activité",
    tx.auditLog.deleteMany({ where: { id: { in: activity.auditLogs.map((entry) => entry.id) } } }),
  );

  // Avis (les témoignages des rubriques et les avis mis en avant se détachent : SetNull / Cascade).
  await count('Avis', tx.review.deleteMany({ where: DEMO }));

  // Rendez-vous, puis candidatures et pièces jointes (Restrict), puis demandes (historique, notes, questionnaires
  // supprimés en cascade).
  await count('Rendez-vous', tx.appointment.deleteMany({ where: DEMO }));
  const demoRequests = { request: DEMO };
  await count('Candidatures', tx.jobApplication.deleteMany({ where: demoRequests }));
  await count('Pièces jointes', tx.attachment.deleteMany({ where: demoRequests }));
  await count('Demandes', tx.request.deleteMany({ where: DEMO }));

  // Newsletter et contacts (un contact encore cité par une demande réelle est conservé).
  await count('Campagnes', tx.campaign.deleteMany({ where: DEMO }));
  await count('Abonnés', tx.subscriber.deleteMany({ where: DEMO }));
  await count(
    'Contacts',
    tx.contact.deleteMany({ where: { ...DEMO, requests: { none: {} }, appointments: { none: {} } } }),
  );

  // Contenus.
  await count('Événements', tx.event.deleteMany({ where: DEMO }));
  await count('Formations', tx.training.deleteMany({ where: DEMO }));
  await count("Offres d'emploi", tx.jobOffer.deleteMany({ where: DEMO }));
  await count('Partenaires', tx.partner.deleteMany({ where: DEMO }));
  await count('Articles du magazine', tx.magazineArticle.deleteMany({ where: DEMO }));
  await count('Éditions du magazine', tx.magazineEdition.deleteMany({ where: DEMO }));
  await count('Offres', tx.serviceOffer.deleteMany({ where: DEMO }));
  await count('Services', tx.service.deleteMany({ where: DEMO }));
  await count('Rubriques', tx.category.deleteMany({ where: { ...DEMO, services: { none: {} } } }));
  await count('Zones', tx.zone.deleteMany({ where: DEMO }));

  // Médias : usages des contenus supprimés, puis médias de démonstration qui ne sont plus utilisés.
  await count('Usages des médias', tx.mediaUsage.deleteMany({ where: { entityId: { in: demoEntityIds } } }));
  await count(
    'Médias',
    tx.media.deleteMany({
      where: {
        ...DEMO,
        usages: { none: {} },
        categories: { none: {} },
        serviceCovers: { none: {} },
        serviceGalleries: { none: {} },
        offers: { none: {} },
        partners: { none: {} },
        events: { none: {} },
        magazineCovers: { none: {} },
        magazineArticles: { none: {} },
      },
    }),
  );

  // Comptes de démonstration : supprimés, sauf s'ils ont écrit des notes (désactivés, l'historique est conservé).
  await count(
    'Comptes de démonstration',
    tx.user.deleteMany({ where: { ...DEMO, requestNotes: { none: {} } } }),
  );
  await count(
    'Comptes de démonstration désactivés',
    tx.user.updateMany({ where: DEMO, data: { isActive: false } }),
  );
  return counts;
}

async function main(): Promise<void> {
  const prisma = createSeedClient();
  try {
    console.log('Suppression des données de démonstration');
    const counts = await prisma.$transaction(purge, TRANSACTION_OPTIONS);
    for (const [label, value] of Object.entries(counts)) console.log(`  ${label} : ${value}`);
    console.log('Données de démonstration supprimées.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error('Échec de la suppression des données de démonstration :', error);
  process.exitCode = 1;
});
