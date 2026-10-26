// Médiathèque : images référencées par les contenus des maquettes.
//
// Choix : aucun fichier n'est téléversé dans le stockage S3. Les images sont celles livrées avec le site
// (`mambo-proxi-web/public/photos/…`, `/illustrations/…`) ; leur adresse publique relative au site est enregistrée
// telle quelle dans `storageKey`, ce que le contrat autorise (`MediaImage.url` : « relative au site (médias livrés
// avec le site) ») et que l'API reprend sans préfixe `MEDIA_PUBLIC_URL`. Les variantes AVIF/WebP ne sont pas
// générées (`variants` vide) : le site sert l'image d'origine. Une image remplacée depuis le back-office devient
// un média S3 ordinaire.
import { MediaStatus } from '../../../src/generated/prisma/client.js';
import { logCount, readSeedData, type SeedClock, type Tx } from '../support.js';
import type { MediaSeed, MediaUsageSeed } from '../types.js';

/** Identifiant du média dans les données → identifiant en base. */
export type MediaIds = Map<string, string>;

export async function seedMedia(tx: Tx, clock: SeedClock): Promise<MediaIds> {
  const media = readSeedData<MediaSeed[]>('media');
  const ids: MediaIds = new Map();
  for (const item of media) {
    const fields = {
      fileName: item.fileName,
      mimeType: item.mimeType,
      size: item.size,
      width: item.width,
      height: item.height,
      alt: item.alt,
      status: MediaStatus.READY,
      isDemo: item.isDemo,
    };
    const saved = await tx.media.upsert({
      where: { storageKey: item.storageKey },
      // Contenu de référence : jamais écrasé (texte alternatif, point focal modifiés dans le back-office).
      update: item.isDemo ? fields : {},
      create: { ...fields, id: item.id, storageKey: item.storageKey, createdAt: clock.date(item.createdAt) },
      select: { id: true },
    });
    ids.set(item.id, saved.id);
  }
  logCount('Médias', media.length);
  return ids;
}

/** Usages des médias (y compris dans les JSON des pages et des rubriques), comme l'API les tient à jour. */
export async function seedMediaUsages(tx: Tx, ids: MediaIds): Promise<void> {
  const usages = readSeedData<MediaUsageSeed[]>('media-usages');
  const rows = usages.flatMap((usage) => {
    const mediaId = ids.get(usage.mediaId);
    return mediaId ? [{ ...usage, mediaId }] : [];
  });
  const { count } = await tx.mediaUsage.createMany({ data: rows, skipDuplicates: true });
  logCount('Usages des médias (nouveaux)', count);
}
