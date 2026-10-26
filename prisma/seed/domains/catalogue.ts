// Catalogue : 5 rubriques, leurs carrousels d'offres, 27 services (dont 4 formules « Services à domicile »).
// Aucun prix : chaque prestation fait l'objet d'un devis. Contenus de référence, créés s'ils sont absents.
import { logCount, mapId, nullableJson, readSeedData, type SeedClock, type Tx } from '../support.js';
import type { CatalogueSeed, OfferSeed } from '../types.js';
import type { MediaIds } from './media.js';

export interface CatalogueIds {
  categories: Map<string, string>;
  services: Map<string, string>;
}

function offerData(offer: OfferSeed, media: MediaIds, services: Map<string, string>) {
  return {
    targetServiceId: mapId(services, offer.targetServiceId),
    title: offer.title,
    titleMobile: offer.titleMobile,
    text: offer.text,
    textMobile: offer.textMobile,
    icon: offer.icon,
    illustration: offer.illustration,
    imageId: mapId(media, offer.imageId),
    action: offer.action,
    actionLabel: offer.actionLabel,
    actionLabelMobile: offer.actionLabelMobile,
    sortOrder: offer.sortOrder,
    translations: nullableJson(offer.translations),
    isDemo: false,
  };
}

export async function seedCatalogue(
  tx: Tx,
  clock: SeedClock,
  media: MediaIds,
  withDemo: boolean,
): Promise<CatalogueIds> {
  const data = readSeedData<CatalogueSeed>('catalogue');
  const categories = data.categories;
  // Service de démonstration (brouillon « Visites guidées ») omis avec `SEED_DEMO=false`.
  const services = data.services.filter((service) => withDemo || !service.isDemo);
  const ids: CatalogueIds = { categories: new Map(), services: new Map() };

  for (const category of categories) {
    // `testimonialId` (avis de démonstration) est relié par le domaine « avis ».
    const { offerSections: _sections, testimonialId: _testimonial, id, ...fields } = category;
    const saved = await tx.category.upsert({
      where: { slug: category.slug },
      update: {},
      create: {
        ...fields,
        id,
        imageId: mapId(media, category.imageId),
        visuals: nullableJson(category.visuals),
        homeCard: nullableJson(category.homeCard),
        highlight: nullableJson(category.highlight),
        translations: nullableJson(category.translations),
        isDemo: false,
      },
      select: { id: true },
    });
    ids.categories.set(id, saved.id);
  }
  logCount('Rubriques', categories.length);

  let formulas = 0;
  for (const service of services) {
    const { gallery: _gallery, relatedIds: _related, offers: _offers, id, categoryId, ...fields } = service;
    const data = {
      ...fields,
      categoryId: ids.categories.get(categoryId) ?? categoryId,
      coverImageId: mapId(media, service.coverImageId),
      publishedAt: clock.optionalDate(service.publishedAt),
      translations: nullableJson(service.translations),
    };
    const saved = await tx.service.upsert({
      where: { slug: service.slug },
      update: service.isDemo ? data : {},
      create: { ...data, id },
      select: { id: true },
    });
    ids.services.set(id, saved.id);
    if (service.kind === 'FORMULA') formulas += 1;
  }
  logCount('Services', services.length - formulas);
  logCount('Formules', formulas);

  // Carrousels d'offres des rubriques, puis offres des fiches services (la cible est un service).
  let sections = 0;
  let offers = 0;
  for (const category of categories)
    for (const { offers: sectionOffers, id, ...section } of category.offerSections) {
      const categoryId = ids.categories.get(category.id) ?? category.id;
      const saved = await tx.categoryOfferSection.upsert({
        where: { id },
        update: {},
        create: { ...section, id, categoryId, translations: nullableJson(section.translations) },
        select: { id: true },
      });
      sections += 1;
      for (const offer of sectionOffers) {
        await tx.serviceOffer.upsert({
          where: { id: offer.id },
          update: {},
          create: { ...offerData(offer, media, ids.services), id: offer.id, sectionId: saved.id },
        });
        offers += 1;
      }
    }
  for (const service of services)
    for (const offer of service.offers) {
      await tx.serviceOffer.upsert({
        where: { id: offer.id },
        update: {},
        create: {
          ...offerData(offer, media, ids.services),
          id: offer.id,
          serviceId: ids.services.get(service.id) ?? service.id,
        },
      });
      offers += 1;
    }
  logCount("Carrousels d'offres des rubriques", sections);
  logCount('Offres', offers);

  const gallery = services.flatMap((service) =>
    service.gallery.flatMap((image) => {
      const mediaId = media.get(image.mediaId);
      const serviceId = ids.services.get(service.id);
      return mediaId && serviceId ? [{ serviceId, mediaId, sortOrder: image.sortOrder, alt: image.alt }] : [];
    }),
  );
  await tx.serviceGalleryImage.createMany({ data: gallery, skipDuplicates: true });
  logCount('Images de galerie', gallery.length);

  const relations = services.flatMap((service) =>
    service.relatedIds.flatMap((relatedId, sortOrder) => {
      const serviceId = ids.services.get(service.id);
      const relatedServiceId = ids.services.get(relatedId);
      return serviceId && relatedServiceId ? [{ serviceId, relatedServiceId, sortOrder }] : [];
    }),
  );
  await tx.serviceRelation.createMany({ data: relations, skipDuplicates: true });
  logCount('Services liés', relations.length);
  return ids;
}
