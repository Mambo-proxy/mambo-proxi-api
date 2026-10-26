// Contenus de démonstration des maquettes : partenaires, formations, offres d'emploi, événements, magazine,
// campagnes de newsletter. Tous marqués `isDemo` (supprimés par `pnpm db:purge-demo`) et remis à l'état des
// maquettes à chaque lancement (dates recalculées par rapport à maintenant).
import { logCount, mapId, nullableJson, readSeedData, type SeedClock, type Tx } from '../support.js';
import type { ContentSeed, MagazineSeed, NewsletterSeed } from '../types.js';
import type { MediaIds } from './media.js';

export async function seedContent(tx: Tx, clock: SeedClock, media: MediaIds): Promise<void> {
  const { partners, trainings, jobs, events } = readSeedData<ContentSeed>('content');

  for (const { id, ...partner } of partners) {
    const data = { ...partner, logoImageId: mapId(media, partner.logoImageId), isDemo: true };
    await tx.partner.upsert({ where: { id }, update: data, create: { ...data, id } });
  }
  logCount('Partenaires', partners.length);

  for (const { id, ...training } of trainings) {
    const data = { ...training, translations: nullableJson(training.translations), isDemo: true };
    await tx.training.upsert({ where: { id }, update: data, create: { ...data, id } });
  }
  logCount('Formations', trainings.length);

  for (const { id, ...job } of jobs) {
    const data = {
      ...job,
      publishedAt: clock.optionalDate(job.publishedAt),
      expiresAt: clock.optionalDate(job.expiresAt),
      createdAt: clock.date(job.createdAt),
      translations: nullableJson(job.translations),
      isDemo: true,
    };
    await tx.jobOffer.upsert({ where: { id }, update: data, create: { ...data, id } });
  }
  logCount("Offres d'emploi", jobs.length);

  for (const { id, ...event } of events) {
    const data = {
      ...event,
      startsAt: clock.date(event.startsAt),
      endsAt: clock.optionalDate(event.endsAt),
      publishedAt: clock.optionalDate(event.publishedAt),
      imageId: mapId(media, event.imageId),
      isDemo: true,
    };
    await tx.event.upsert({ where: { id }, update: data, create: { ...data, id } });
  }
  logCount('Événements', events.length);
}

export async function seedMagazine(tx: Tx, clock: SeedClock, media: MediaIds): Promise<void> {
  const { editions, articles } = readSeedData<MagazineSeed>('magazine');
  for (const { id, ...edition } of editions) {
    const data = {
      ...edition,
      publishAt: clock.optionalDate(edition.publishAt),
      publishedAt: clock.optionalDate(edition.publishedAt),
      newsletterScheduledAt: clock.optionalDate(edition.newsletterScheduledAt),
      newsletterSentAt: clock.optionalDate(edition.newsletterSentAt),
      coverId: mapId(media, edition.coverId),
      isDemo: true,
    };
    await tx.magazineEdition.upsert({ where: { id }, update: data, create: { ...data, id } });
  }
  logCount('Éditions du magazine', editions.length);

  for (const { id, updatedAt, ...article } of articles) {
    const data = { ...article, imageId: mapId(media, article.imageId), isDemo: true };
    await tx.magazineArticle.upsert({
      where: { id },
      update: data,
      create: { ...data, id, createdAt: clock.date(updatedAt) },
    });
  }
  logCount('Articles du magazine', articles.length);
}

export async function seedCampaigns(tx: Tx, clock: SeedClock, adminId: string | null): Promise<void> {
  const { campaigns } = readSeedData<NewsletterSeed>('newsletter');
  for (const { id, ...campaign } of campaigns) {
    const data = {
      ...campaign,
      scheduledAt: clock.optionalDate(campaign.scheduledAt),
      sentAt: clock.optionalDate(campaign.sentAt),
      startedAt: clock.optionalDate(campaign.sentAt),
      createdAt: clock.date(campaign.createdAt),
      createdById: adminId,
      isDemo: true,
    };
    await tx.campaign.upsert({ where: { id }, update: data, create: { ...data, id } });
  }
  logCount('Campagnes de newsletter', campaigns.length);
}
