import type { Prisma } from '../../generated/prisma/client.js';
import type { ProblemFieldError } from '../../common/problem/problem.js';
import type { MediaReference } from '../media/media-refs.js';
import type { OfferInput } from './admin-catalog.schemas.js';

/** Propriétaire des cartes d'un carrousel « Nos offres » : fiche service ou carrousel de rubrique. */
export type OfferOwner = { serviceId: string } | { sectionId: string };

/** Offre déjà enregistrée : son identifiant est conservé, et sa traduction anglaise avec lui. */
export type ExistingOffers = ReadonlyMap<string, Prisma.JsonValue | null>;

/**
 * Remplace les cartes d'un carrousel (ordre de la liste). Une carte envoyée avec l'identifiant d'une carte de ce
 * même carrousel garde cet identifiant et sa traduction ; les autres sont recréées.
 */
export async function replaceOffers(
  client: Pick<Prisma.TransactionClient, 'serviceOffer'>,
  owner: OfferOwner,
  offers: readonly OfferInput[],
  existing: ExistingOffers,
): Promise<void> {
  await client.serviceOffer.deleteMany({ where: owner });
  if (offers.length === 0) return;
  await client.serviceOffer.createMany({
    data: offers.map((offer, index) => {
      const kept = typeof offer.id === 'string' && existing.has(offer.id) ? offer.id : undefined;
      const translations = kept === undefined ? null : (existing.get(kept) ?? null);
      return {
        ...(kept === undefined ? {} : { id: kept }),
        ...owner,
        title: offer.title,
        titleMobile: offer.titleMobile ?? null,
        text: offer.text,
        textMobile: offer.textMobile ?? null,
        icon: offer.icon ?? null,
        illustration: offer.illustration ?? 'accueil',
        imageId: offer.imageId ?? null,
        action: offer.action,
        actionLabel: offer.actionLabel,
        actionLabelMobile: offer.actionLabelMobile ?? null,
        targetServiceId: offer.serviceId ?? null,
        sortOrder: index + 1,
        ...(translations === null ? {} : { translations: translations as Prisma.InputJsonValue }),
      };
    }),
  });
}

/** Images référencées par des cartes (`<prefix>.<i>.imageId`). */
export function offerMediaReferences(prefix: string, offers: readonly OfferInput[]): MediaReference[] {
  return offers.map((offer, index) => ({ path: `${prefix}.${String(index)}.imageId`, id: offer.imageId }));
}

/** Services présélectionnés inconnus (`<prefix>.<i>.serviceId`). */
export function unknownTargetErrors(
  prefix: string,
  offers: readonly OfferInput[],
  knownServiceIds: ReadonlySet<string>,
): ProblemFieldError[] {
  return offers.flatMap((offer, index) =>
    typeof offer.serviceId === 'string' && !knownServiceIds.has(offer.serviceId)
      ? [
          {
            path: `${prefix}.${String(index)}.serviceId`,
            code: 'unknown_service',
            message: 'Ce service n’existe pas.',
          },
        ]
      : [],
  );
}
