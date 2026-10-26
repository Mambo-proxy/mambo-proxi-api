// Remplissage de la base (`pnpm db:seed`, lancé aussi par `prisma migrate reset`).
//
// - Données de référence (contenus des maquettes : paramètres, navigation, pages, rubriques, services, offres,
//   zones, médias, modèles d'e-mails, questions du questionnaire, disponibilités) : créées si elles manquent, jamais
//   écrasées, pour ne pas effacer ce qui a été modifié dans le back-office.
// - Données de démonstration des maquettes (avis, demandes, rendez-vous, contacts, abonnés, candidatures,
//   événements, magazine…) : marquées `isDemo`, remises à l'état des maquettes à chaque lancement (dates relatives
//   au moment présent). `SEED_DEMO=false` les omet (production) ; `pnpm db:purge-demo` les supprime.
// - Administratrice initiale : `SEED_ADMIN_EMAIL` / `SEED_ADMIN_NAME`, créée si elle n'existe pas.
//
// Chaque domaine est écrit dans sa propre transaction, dans l'ordre des clés étrangères ; le seed est relançable.
// Les fichiers `prisma/seed/data/*.json` reprennent les mocks du site (`mambo-proxi-web/src/mocks`), fidèles aux
// maquettes et au contrat.
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { seedActivity } from './seed/domains/activity.js';
import { seedCatalogue } from './seed/domains/catalogue.js';
import { seedContacts } from './seed/domains/contacts.js';
import { seedCampaigns, seedContent, seedMagazine } from './seed/domains/content.js';
import { seedMedia, seedMediaUsages } from './seed/domains/media.js';
import { seedPages } from './seed/domains/pages.js';
import { seedRequests } from './seed/domains/requests.js';
import { seedReviews } from './seed/domains/reviews.js';
import { seedSettings } from './seed/domains/settings.js';
import { seedAdmin, seedDemoUsers } from './seed/domains/users.js';
import { seedZones } from './seed/domains/zones.js';
import { createSeedClient, SeedClock, TRANSACTION_OPTIONS, type Tx } from './seed/support.js';

async function step<T>(prisma: PrismaClient, title: string, run: (tx: Tx) => Promise<T>): Promise<T> {
  console.log(`${title}`);
  return prisma.$transaction(run, TRANSACTION_OPTIONS);
}

async function main(): Promise<void> {
  const prisma = createSeedClient();
  const clock = new SeedClock();
  const withDemo = process.env['SEED_DEMO'] !== 'false';
  const started = Date.now();
  try {
    console.log('Données de référence');
    const adminId = await step(prisma, '› Administratrice', (tx) => seedAdmin(tx, clock));
    const media = await step(prisma, '› Médiathèque', async (tx) => {
      const ids = await seedMedia(tx, clock);
      await seedMediaUsages(tx, ids);
      return ids;
    });
    await step(prisma, '› Paramètres', (tx) => seedSettings(tx));
    await step(prisma, '› Zones', (tx) => seedZones(tx));
    const catalogue = await step(prisma, '› Catalogue', (tx) => seedCatalogue(tx, clock, media, withDemo));
    await step(prisma, '› Pages', (tx) => seedPages(tx, clock, adminId));

    if (withDemo) {
      console.log('Données de démonstration (isDemo)');
      const { ids: users } = await step(prisma, '› Équipe', (tx) => seedDemoUsers(tx, clock, adminId));
      await step(prisma, '› Contenus', (tx) => seedContent(tx, clock, media));
      await step(prisma, '› Magazine', (tx) => seedMagazine(tx, clock, media));
      const contacts = await step(prisma, '› Contacts', (tx) =>
        seedContacts(tx, clock, catalogue.categories),
      );
      await step(prisma, '› Demandes et rendez-vous', (tx) =>
        seedRequests(tx, clock, users, catalogue, contacts),
      );
      await step(prisma, '› Avis', (tx) => seedReviews(tx, clock, catalogue));
      await step(prisma, '› Newsletter', (tx) => seedCampaigns(tx, clock, adminId));
      await step(prisma, '› Activité', (tx) => seedActivity(tx, clock, users));
    } else console.log('Données de démonstration omises (SEED_DEMO=false).');

    console.log(`Seed terminé en ${((Date.now() - started) / 1000).toFixed(1)} s.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error('Échec du seed :', error);
  process.exitCode = 1;
});
