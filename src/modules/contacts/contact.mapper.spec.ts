import { describe, expect, it } from 'vitest';
import {
  contactSearchKeys,
  districtFromCity,
  normalizeEmail,
  shortName,
  splitFullName,
  toContactData,
  type ContactSubmission,
} from './contact.mapper.js';

const NOW = new Date('2026-10-26T09:00:00.000Z');

describe('normalizeEmail', () => {
  it('retire les espaces et met en minuscules', () => {
    expect(normalizeEmail('  Aurelie.K@Example.COM ')).toBe('aurelie.k@example.com');
  });
});

describe('splitFullName', () => {
  it('sépare le prénom du reste du nom', () => {
    expect(splitFullName('Aurélie Kamga')).toEqual({ firstName: 'Aurélie', lastName: 'Kamga' });
    expect(splitFullName('  Jean  Paul  Ekotto ')).toEqual({ firstName: 'Jean', lastName: 'Paul Ekotto' });
    expect(splitFullName('Mireille')).toEqual({ firstName: 'Mireille', lastName: null });
  });
});

describe('districtFromCity', () => {
  it('déduit le quartier d’une saisie « Quartier, Ville »', () => {
    expect(districtFromCity('Bonapriso, Douala')).toBe('Bonapriso');
    expect(districtFromCity('Douala')).toBeNull();
    expect(districtFromCity(null)).toBeNull();
  });
});

describe('shortName', () => {
  it('affiche « Prénom N. »', () => {
    expect(shortName('Aurélie Kamga')).toBe('Aurélie K.');
    expect(shortName('Mireille')).toBe('Mireille');
  });
});

describe('contactSearchKeys', () => {
  it('retire accents et casse du nom, de l’e-mail, de la structure et de la ville', () => {
    expect(
      contactSearchKeys({
        fullName: 'Hervé  Tchoumi',
        email: 'Herve.T@Example.com',
        organization: 'Saveurs du Wouri',
        city: 'Makèpè, Douala',
      }),
    ).toEqual({
      searchText: 'herve tchoumi herve.t@example.com saveurs du wouri',
      cityKey: 'makepe, douala',
    });
    expect(
      contactSearchKeys({ fullName: 'Mireille', email: 'm@example.com', city: '  ' }).cityKey,
    ).toBeNull();
  });
});

describe('toContactData', () => {
  const submission: ContactSubmission = {
    email: 'Aurelie.K@example.com',
    fullName: 'Aurélie Kamga',
    phone: '+237612345678',
    country: 'CM',
    city: 'Bonapriso, Douala',
    preferredChannel: 'WHATSAPP',
    source: 'devis',
    language: 'FR',
  };

  it('crée une fiche complète, e-mail normalisé, profil particulier par défaut', () => {
    const { create } = toContactData(submission, NOW);

    expect(create).toEqual({
      email: 'aurelie.k@example.com',
      fullName: 'Aurélie Kamga',
      firstName: 'Aurélie',
      lastName: 'Kamga',
      phone: '+237612345678',
      country: 'CM',
      city: 'Bonapriso, Douala',
      district: 'Bonapriso',
      profile: 'PARTICULIER',
      organization: null,
      activity: null,
      preferredChannel: 'WHATSAPP',
      source: 'devis',
      language: 'FR',
      lastActivityAt: NOW,
      searchText: 'aurelie kamga aurelie.k@example.com',
      cityKey: 'bonapriso, douala',
    });
  });

  it('ne remplace que les informations fournies et ne change pas la source', () => {
    const { update } = toContactData(
      { email: 'a@example.com', fullName: 'Aurélie Kamga', source: 'contact', language: 'EN' },
      NOW,
    );

    expect(update).toEqual({
      fullName: 'Aurélie Kamga',
      firstName: 'Aurélie',
      lastName: 'Kamga',
      language: 'EN',
      lastActivityAt: NOW,
    });
  });

  it('garde le prénom et le nom saisis séparément (inscription) et le profil', () => {
    const { create, update } = toContactData(
      {
        email: 'b@example.com',
        fullName: 'Marie Claire Ndongo',
        firstName: 'Marie Claire',
        lastName: 'Ndongo',
        profile: 'PROFESSIONNEL',
        organization: 'Saveurs du Wouri',
        activity: 'Traiteur',
        source: 'inscription',
        language: 'FR',
      },
      NOW,
    );

    expect(create).toMatchObject({ firstName: 'Marie Claire', lastName: 'Ndongo', profile: 'PROFESSIONNEL' });
    expect(update).toMatchObject({
      firstName: 'Marie Claire',
      profile: 'PROFESSIONNEL',
      organization: 'Saveurs du Wouri',
      activity: 'Traiteur',
    });
  });
});
