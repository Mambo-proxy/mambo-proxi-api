import { describe, expect, it } from 'vitest';
import { countLabel, toNavigation, toNavLinks } from './navigation.mapper.js';

describe('countLabel', () => {
  it('compte formules et services du menu mobile', () => {
    expect(countLabel(4, 2, 'fr')).toBe('4 formules · 2 services');
    expect(countLabel(4, 2, 'en')).toBe('4 packages · 2 services');
    expect(countLabel(0, 5, 'fr')).toBe('5 services');
    expect(countLabel(1, 0, 'fr')).toBe('1 formule');
    expect(countLabel(0, 1, 'en')).toBe('1 service');
    expect(countLabel(0, 0, 'fr')).toBe('0 service');
  });
});

describe('toNavLinks', () => {
  it('écarte les liens incomplets et les icônes invalides', () => {
    expect(
      toNavLinks([
        { label: 'Nos partenaires', href: '/partenaires#nos-partenaires', icon: 'Users' },
        { label: 'Sans adresse' },
        { label: 'Icône invalide', href: '/x', icon: 'pas-une-icone' },
      ]),
    ).toEqual([
      { label: 'Nos partenaires', href: '/partenaires#nos-partenaires', icon: 'Users' },
      { label: 'Icône invalide', href: '/x', icon: null },
    ]);
  });
});

describe('toNavigation', () => {
  it('complète un paramètre vide par les textes par défaut', () => {
    const navigation = toNavigation({}, [], 'en', 2026);

    expect(navigation.main).toEqual([]);
    expect(navigation.megaMenu.promo).toMatchObject({
      title: 'Have a specific need?',
      cta: { href: '/devis' },
    });
    expect(navigation.footer.copyright).toBe('© 2026 Mambo Proxi · Douala — Cameroon');
  });
});
