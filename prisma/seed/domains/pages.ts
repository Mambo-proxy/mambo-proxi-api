// Pages éditoriales (sections telles que sur les maquettes, français et anglais), publiées, sans brouillon.
import { logCount, nullableJson, readSeedData, type SeedClock, type Tx } from '../support.js';
import type { PageSeed } from '../types.js';

export async function seedPages(tx: Tx, clock: SeedClock, adminId: string | null): Promise<void> {
  const pages = readSeedData<PageSeed[]>('pages');
  for (const page of pages)
    await tx.page.upsert({
      where: { key: page.key },
      update: {},
      create: {
        key: page.key,
        title: page.title,
        path: page.path,
        group: page.group,
        sections: page.sections,
        seo: nullableJson(page.seo),
        translations: nullableJson(page.translations),
        allowedSections: page.allowedSections,
        publishedAt: clock.optionalDate(page.publishedAt),
        publishedById: adminId,
        updatedById: adminId,
      },
    });
  logCount('Pages', pages.length);
}
