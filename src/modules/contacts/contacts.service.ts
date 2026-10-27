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

/**
 * Fiches contact des formulaires publics : une fiche par adresse e-mail (normalisée), créée ou mise à jour à chaque
 * envoi. Le consentement horodaté est porté par chaque demande (`Request.consentAt`, IP, agent utilisateur).
 */
@Injectable()
export class ContactsService {
  /** Création ou mise à jour par e-mail (`INSERT … ON CONFLICT (email) DO UPDATE`), dans la transaction de l'envoi. */
  async upsert(
    tx: Prisma.TransactionClient,
    submission: ContactSubmission,
    now: Date,
  ): Promise<SavedContact> {
    const { create, update } = toContactData(submission, now);
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
