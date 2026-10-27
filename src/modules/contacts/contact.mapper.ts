import { optionalSearchKey, searchKey } from '../../common/text/search-key.js';
import type { ContactPreference, ContactProfile, Language, Prisma } from '../../generated/prisma/client.js';

/** Coordonnées saisies dans un formulaire public, déjà validées. */
export interface ContactSubmission {
  email: string;
  fullName: string;
  /** Prénom et nom saisis séparément (inscription) ; sinon déduits du nom complet. */
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  country?: string | null;
  /** Ville, avec le quartier s'il est indiqué (« Akwa, Douala »). */
  city?: string | null;
  profile?: ContactProfile;
  organization?: string | null;
  activity?: string | null;
  preferredChannel?: ContactPreference | null;
  /** Formulaire d'origine (`devis`, `contact`, `inscription`…), retenu à la création de la fiche. */
  source: string;
  language: Language;
}

/** Adresse e-mail normalisée (clé de la fiche contact) : sans espaces, en minuscules. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Prénom = premier mot du nom complet, nom = la suite (« Aurélie Kamga » → Aurélie / Kamga). */
export function splitFullName(fullName: string): { firstName: string; lastName: string | null } {
  const parts = fullName.trim().split(/\s+/);
  const [firstName = '', ...rest] = parts;
  return { firstName, lastName: rest.length > 0 ? rest.join(' ') : null };
}

/** Quartier d'une ville saisie sous la forme « Quartier, Ville » (« Bonapriso, Douala » → Bonapriso). */
export function districtFromCity(city: string | null | undefined): string | null {
  if (!city) return null;
  const parts = city
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '');
  return parts.length >= 2 ? (parts[0] ?? null) : null;
}

/**
 * « Prénom N. » : nom affiché dans les notifications de l'équipe (comme les avis publiés). Le prénom et le nom saisis
 * séparément (inscription) sont repris tels quels : un prénom composé (« Marie Claire ») n'est pas recoupé.
 */
export function shortName(fullName: string, parts?: { firstName: string; lastName: string | null }): string {
  const { firstName, lastName } = parts ?? splitFullName(fullName);
  const initial = lastName?.trim().charAt(0).toLocaleUpperCase('fr');
  return initial ? `${firstName.trim()} ${initial}.` : firstName.trim();
}

/**
 * Clés de recherche d'une fiche (colonnes `search_text` et `city_key`) : nom, e-mail et structure pour la
 * recherche `q`, ville pour le filtre `district` et l'indicateur « Douala et environs ».
 */
export function contactSearchKeys(contact: {
  fullName: string;
  email: string;
  organization?: string | null;
  city?: string | null;
}): { searchText: string; cityKey: string | null } {
  return {
    searchText: searchKey(contact.fullName, contact.email, contact.organization),
    cityKey: optionalSearchKey(contact.city),
  };
}

type ContactData = Prisma.ContactUncheckedCreateInput;

/** Valeurs à enregistrer : seules les informations fournies remplacent celles de la fiche existante. */
export function toContactData(
  submission: ContactSubmission,
  now: Date,
): {
  create: ContactData;
  update: Prisma.ContactUncheckedUpdateInput;
} {
  const fullName = submission.fullName.trim();
  const split = splitFullName(fullName);
  const firstName = submission.firstName ?? split.firstName;
  const lastName = submission.lastName ?? split.lastName;
  const district = districtFromCity(submission.city);

  const provided: Prisma.ContactUncheckedUpdateInput = {
    fullName,
    firstName,
    language: submission.language,
    lastActivityAt: now,
  };
  if (lastName) provided.lastName = lastName;
  if (submission.phone) provided.phone = submission.phone;
  if (submission.country) provided.country = submission.country;
  if (submission.city) {
    provided.city = submission.city;
    provided.district = district;
  }
  if (submission.profile) provided.profile = submission.profile;
  if (submission.organization) provided.organization = submission.organization;
  if (submission.activity) provided.activity = submission.activity;
  if (submission.preferredChannel) provided.preferredChannel = submission.preferredChannel;

  const email = normalizeEmail(submission.email);
  return {
    create: {
      email,
      fullName,
      firstName,
      lastName,
      phone: submission.phone ?? null,
      country: submission.country ?? null,
      city: submission.city ?? null,
      district,
      profile: submission.profile ?? 'PARTICULIER',
      organization: submission.organization ?? null,
      activity: submission.activity ?? null,
      preferredChannel: submission.preferredChannel ?? null,
      source: submission.source,
      language: submission.language,
      lastActivityAt: now,
      ...contactSearchKeys({
        fullName,
        email,
        organization: submission.organization ?? null,
        city: submission.city ?? null,
      }),
    },
    // Clés de recherche d'une fiche existante : recalculées après l'écriture (`ContactsService.upsert`).
    update: provided,
  };
}
