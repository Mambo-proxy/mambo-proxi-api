import { Injectable } from '@nestjs/common';
import type { Language, Prisma, SubscriberSource, SubscriberStatus } from '../../generated/prisma/client.js';
import {
  contactSearchKeys,
  normalizeEmail,
  toContactData,
  type ContactSubmission,
} from './contact.mapper.js';

export interface SavedContact {
  id: string;
  email: string;
  fullName: string;
  firstName: string | null;
}

/** Abonnement préparé par un formulaire (case « newsletter » cochée). */
export interface NewsletterSubscriptionRequest {
  email: string;
  fullName: string;
  phone?: string | null;
  country?: string | null;
  source: SubscriberSource;
  language: Language;
}

/** Champs d'une fiche existante complétés par un formulaire seulement s'ils sont vides. */
const FILLABLE_FIELDS = {
  fullName: true,
  firstName: true,
  lastName: true,
  phone: true,
  country: true,
  city: true,
  district: true,
  organization: true,
  activity: true,
  preferredChannel: true,
} as const satisfies Prisma.ContactSelect;

type FillableField = keyof typeof FILLABLE_FIELDS;

/**
 * Valeurs d'un envoi appliquées à une fiche existante : les champs de `FILLABLE_FIELDS` seulement là où la fiche est
 * vide (le quartier suit la ville) ; la langue et la date de dernière activité suivent le dernier envoi ; le profil
 * n'est jamais remplacé.
 */
function fillMissing(
  existing: Record<FillableField, string | null>,
  provided: Prisma.ContactUncheckedUpdateInput,
): Prisma.ContactUncheckedUpdateInput {
  const update: Prisma.ContactUncheckedUpdateInput = {};
  if (provided.language !== undefined) update.language = provided.language;
  if (provided.lastActivityAt !== undefined) update.lastActivityAt = provided.lastActivityAt;
  const empty = (field: FillableField) => !existing[field]?.trim();
  for (const field of Object.keys(FILLABLE_FIELDS) as FillableField[]) {
    if (field === 'district' || provided[field] === undefined || !empty(field)) continue;
    Object.assign(update, { [field]: provided[field] });
    if (field === 'city' && provided.district !== undefined) update.district = provided.district;
  }
  return update;
}

/**
 * Fiches contact des formulaires publics : une fiche par adresse e-mail (normalisée), créée au premier envoi puis
 * complétée par les suivants. Le consentement horodaté est porté par chaque demande (`Request.consentAt`, IP, agent utilisateur).
 */
@Injectable()
export class ContactsService {
  /** Création ou mise à jour par e-mail (`INSERT … ON CONFLICT (email) DO UPDATE`), dans la transaction de l'envoi. */
  async upsert(
    tx: Prisma.TransactionClient,
    submission: ContactSubmission,
    now: Date,
  ): Promise<SavedContact> {
    const { create, update: provided } = toContactData(submission, now);
    // Fiche existante : seuls ses champs vides sont complétés. Un formulaire public n'est pas authentifié, n'importe
    // qui peut y saisir l'adresse d'un client : il ne doit pas pouvoir remplacer son nom ni son téléphone. Les valeurs
    // saisies restent dans la demande (`Request.payload`).
    const existing = await tx.contact.findUnique({ where: { email: create.email }, select: FILLABLE_FIELDS });
    const update = existing ? fillMissing(existing, provided) : provided;
    const saved = await tx.contact.upsert({
      where: { email: create.email },
      create,
      update,
      select: {
        id: true,
        email: true,
        fullName: true,
        firstName: true,
        organization: true,
        city: true,
        searchText: true,
        cityKey: true,
      },
    });
    // Fiche existante : les clés de recherche dépendent aussi des valeurs non remplacées (structure, ville).
    const keys = contactSearchKeys(saved);
    if (keys.searchText !== saved.searchText || keys.cityKey !== saved.cityKey)
      await tx.contact.update({ where: { id: saved.id }, data: keys, select: { id: true } });
    return { id: saved.id, email: saved.email, fullName: saved.fullName, firstName: saved.firstName };
  }

  /** Remplace les rubriques qui intéressent le contact (inscription). */
  async replaceInterests(
    tx: Prisma.TransactionClient,
    contactId: string,
    categoryIds: readonly string[],
  ): Promise<void> {
    await tx.contactInterest.deleteMany({ where: { contactId } });
    if (categoryIds.length === 0) return;
    await tx.contactInterest.createMany({
      data: [...new Set(categoryIds)].map((categoryId) => ({ contactId, categoryId })),
      skipDuplicates: true,
    });
  }

  /**
   * Double opt-in : prépare l'abonnement « en attente » avec le consentement horodaté. Un abonné confirmé le reste ;
   * un abonné désinscrit qui coche de nouveau la case redevient « en attente ». L'e-mail de confirmation (jeton
   * `confirmTokenHash`) sera envoyé par le module newsletter.
   */
  async prepareNewsletter(
    tx: Prisma.TransactionClient,
    contactId: string,
    request: NewsletterSubscriptionRequest,
    now: Date,
  ): Promise<SubscriberStatus> {
    const email = normalizeEmail(request.email);
    const existing = await tx.subscriber.findUnique({
      where: { email },
      select: { id: true, status: true, contactId: true },
    });
    if (!existing) {
      await tx.subscriber.create({
        data: {
          email,
          name: request.fullName,
          phone: request.phone ?? null,
          country: request.country ?? null,
          contactId,
          status: 'EN_ATTENTE',
          language: request.language,
          source: request.source,
          consentAt: now,
        },
      });
      return 'EN_ATTENTE';
    }
    if (existing.status === 'DESINSCRIT') {
      await tx.subscriber.update({
        where: { id: existing.id },
        data: {
          status: 'EN_ATTENTE',
          consentAt: now,
          unsubscribedAt: null,
          contactId: existing.contactId ?? contactId,
        },
      });
      return 'EN_ATTENTE';
    }
    if (existing.contactId === null) {
      await tx.subscriber.update({ where: { id: existing.id }, data: { contactId } });
    }
    return existing.status;
  }
}
