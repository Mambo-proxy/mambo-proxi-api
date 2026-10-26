// Contacts et inscrits de démonstration : les contacts des maquettes et des demandes simulées, complétés comme dans
// les mocks du site par 1 480 contacts générés pour retrouver les totaux de la maquette « Contacts & inscrits »
// (1 486 contacts, 174 professionnels, 64 ce mois-ci, 58 % à Douala, 39 % dans les environs).
import {
  ContactProfile,
  Language,
  SubscriberSource,
  SubscriberStatus,
} from '../../../src/generated/prisma/client.js';
import { logCount, readSeedData, type SeedClock, type Tx } from '../support.js';
import type { ContactSeed } from '../types.js';

/** Identifiant de contact des données → identifiant en base (les fiches sont uniques par adresse e-mail). */
export type ContactIds = Map<string, string>;

const GENERATED_PREFIX = 'ctc_gen_';
const DAY = 86_400_000;

const FIRST_NAMES = [
  'Marie',
  'Paul',
  'Esther',
  'Joël',
  'Nadia',
  'Serge',
  'Grâce',
  'Yannick',
  'Inès',
  'Boris',
  'Carine',
  'Jules',
];
const LAST_NAMES = [
  'Fotso',
  'Nkoulou',
  'Abena',
  'Mbarga',
  'Tchakounté',
  'Eyenga',
  'Manga',
  'Owona',
  'Kuete',
  'Nana',
  'Ebongue',
  'Ndjock',
];
const ORGANIZATIONS = [
  'Traiteur',
  'Agence',
  'Résidences',
  'Transports',
  'Studio',
  'Atelier',
  'Cabinet',
  'Services',
];
const QUARTERS = [
  'Akwa',
  'Bonapriso',
  'Bonanjo',
  'Bonamoussadi',
  'Makèpè',
  'Kotto',
  'Deïdo',
  'Logpom',
  'Bali',
  'Cité SIC',
];
const SURROUNDINGS = ['Yaoundé', 'Kribi', 'Limbé', 'Buea', 'Édéa', 'Bafoussam'];
const ELSEWHERE: readonly (readonly [string, string])[] = [
  ['Paris', 'FR'],
  ['Bruxelles', 'BE'],
  ['Lyon', 'FR'],
  ['Montréal', 'CA'],
];
const INTERESTS: readonly (readonly string[])[] = [
  ['cat_domicile'],
  ['cat_immobilier'],
  ['cat_experience'],
  ['cat_proximite'],
  ['cat_culture'],
  ['cat_domicile', 'cat_proximite'],
];
const NEWSLETTER: readonly (SubscriberStatus | null)[] = [
  SubscriberStatus.CONFIRME,
  null,
  SubscriberStatus.CONFIRME,
  null,
  SubscriberStatus.EN_ATTENTE,
  SubscriberStatus.CONFIRME,
  SubscriberStatus.DESINSCRIT,
];
const TOTAL = 1486;
const PROFESSIONALS = 174;
const NEW_THIS_MONTH = 64;
const MAQUETTE_COUNT = 6;

/** Slugs des rubriques, étiquettes des inscrits (segment « par centre d'intérêt »). */
const CATEGORY_SLUGS: Readonly<Record<string, string>> = {
  cat_domicile: 'services-a-domicile',
  cat_experience: 'experience',
  cat_immobilier: 'immobilier',
  cat_proximite: 'services-de-proximite',
  cat_culture: 'culture-evenementiel',
};

const pick = <T>(list: readonly T[], index: number): T => list[index % list.length];
const withoutAccents = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/** Contacts générés, à l'identique des mocks du site (`admin-contacts.ts`), datés par rapport à maintenant. */
function generatedContacts(): ContactSeed[] {
  const count = TOTAL - MAQUETTE_COUNT;
  return Array.from({ length: count }, (_, index): ContactSeed => {
    const professional = index < PROFESSIONALS - 2;
    const first = pick(FIRST_NAMES, index);
    const last = pick(LAST_NAMES, index * 7);
    // Répartition de la maquette : 857 à Douala, 579 dans les environs, 44 ailleurs (permutation par 7919).
    const place = (index * 7919) % count;
    const douala = place < 857;
    const surroundings = !douala && place < 857 + 579;
    const quarter = pick(QUARTERS, index);
    const [city, country] = douala
      ? [`${quarter}, Douala`, 'CM']
      : surroundings
        ? [pick(SURROUNDINGS, index), 'CM']
        : pick(ELSEWHERE, index);
    const organization = professional ? `${pick(ORGANIZATIONS, index)} ${last}` : null;
    const offsetMs =
      index < NEW_THIS_MONTH - MAQUETTE_COUNT ? -(6 + (index % 14)) * DAY : -(40 + index / 2) * DAY;
    const createdAt = `rel:now:${Math.round(offsetMs)}`;
    return {
      id: `${GENERATED_PREFIX}${index + 1}`,
      email: `${organization ? 'contact' : withoutAccents(first).toLowerCase()}.${index + 1}@email.com`,
      fullName: organization ?? `${first} ${last}`,
      firstName: organization ? null : first,
      lastName: organization ? null : last,
      phone: country === 'CM' ? '+237699000000' : '+33612345678',
      country,
      city,
      district: douala ? quarter : null,
      profile: professional ? ContactProfile.PROFESSIONNEL : ContactProfile.PARTICULIER,
      organization,
      activity: organization ? 'Prestataire partenaire' : null,
      preferredChannel: null,
      source: index % 4 === 0 ? 'devis' : 'newsletter',
      createdAt,
      lastActivityAt: createdAt,
      interests: [...pick(INTERESTS, index)],
      newsletter: pick(NEWSLETTER, index),
    };
  });
}

function contactData(contact: ContactSeed, clock: SeedClock) {
  return {
    fullName: contact.fullName,
    firstName: contact.firstName,
    lastName: contact.lastName,
    phone: contact.phone,
    country: contact.country,
    city: contact.city,
    district: contact.district,
    profile: contact.profile,
    organization: contact.organization,
    activity: contact.activity,
    preferredChannel: contact.preferredChannel,
    source: contact.source,
    language: Language.FR,
    lastActivityAt: clock.date(contact.lastActivityAt),
    createdAt: clock.date(contact.createdAt),
    isDemo: true,
  };
}

function subscriberData(contact: ContactSeed, contactId: string, clock: SeedClock) {
  const status = contact.newsletter ?? SubscriberStatus.EN_ATTENTE;
  const createdAt = clock.date(contact.createdAt);
  return {
    email: contact.email,
    name: contact.fullName,
    phone: contact.phone,
    country: contact.country,
    contactId,
    status,
    language: Language.FR,
    source: contact.source === 'newsletter' ? SubscriberSource.FOOTER : SubscriberSource.AUTRE,
    tags: contact.interests.flatMap((id) => (CATEGORY_SLUGS[id] ? [CATEGORY_SLUGS[id]] : [])),
    consentAt: createdAt,
    confirmedAt: status === SubscriberStatus.EN_ATTENTE ? null : createdAt,
    unsubscribedAt: status === SubscriberStatus.DESINSCRIT ? createdAt : null,
    createdAt,
    isDemo: true,
  };
}

export async function seedContacts(
  tx: Tx,
  clock: SeedClock,
  categories: ReadonlyMap<string, string>,
): Promise<ContactIds> {
  const contacts = readSeedData<ContactSeed[]>('contacts');
  const ids: ContactIds = new Map();
  let subscribers = 0;

  // Contacts des maquettes et des demandes : mis à jour s'ils existent (fiche unique par e-mail).
  for (const contact of contacts) {
    const data = contactData(contact, clock);
    const saved = await tx.contact.upsert({
      where: { email: contact.email },
      update: data,
      create: { ...data, id: contact.id, email: contact.email },
      select: { id: true },
    });
    ids.set(contact.id, saved.id);
    if (contact.newsletter) {
      const subscriber = subscriberData(contact, saved.id, clock);
      await tx.subscriber.upsert({
        where: { email: contact.email },
        update: subscriber,
        create: { ...subscriber, id: `sub_${contact.id}` },
      });
      subscribers += 1;
    }
  }
  await tx.contactInterest.deleteMany({ where: { contactId: { in: [...ids.values()] } } });
  const interests = contacts.flatMap((contact) =>
    contact.interests.flatMap((categoryId) => {
      const contactId = ids.get(contact.id);
      const category = categories.get(categoryId);
      return contactId && category ? [{ contactId, categoryId: category }] : [];
    }),
  );

  // Contacts générés : supprimés puis recréés en lot (aucune demande ne les référence).
  const generated = generatedContacts();
  await tx.subscriber.deleteMany({ where: { isDemo: true, contactId: { startsWith: GENERATED_PREFIX } } });
  await tx.contact.deleteMany({ where: { isDemo: true, id: { startsWith: GENERATED_PREFIX } } });
  await tx.contact.createMany({
    data: generated.map((contact) => ({
      ...contactData(contact, clock),
      id: contact.id,
      email: contact.email,
    })),
  });
  const generatedSubscribers = generated.filter((contact) => contact.newsletter !== null);
  await tx.subscriber.createMany({
    data: generatedSubscribers.map((contact) => ({
      ...subscriberData(contact, contact.id, clock),
      id: `sub_${contact.id}`,
    })),
  });
  subscribers += generatedSubscribers.length;
  for (const contact of generated) {
    ids.set(contact.id, contact.id);
    for (const categoryId of contact.interests) {
      const category = categories.get(categoryId);
      if (category) interests.push({ contactId: contact.id, categoryId: category });
    }
  }
  await tx.contactInterest.createMany({ data: interests, skipDuplicates: true });

  logCount('Contacts', contacts.length + generated.length);
  logCount('Abonnés à la newsletter', subscribers);
  logCount("Centres d'intérêt", interests.length);
  return ids;
}
