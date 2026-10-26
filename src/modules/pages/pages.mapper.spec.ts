import { describe, expect, it } from 'vitest';
import { FIXTURES } from '../../../test/fixtures/public-content.js';
import {
  isPageKey,
  localizePage,
  toPage,
  visibleSections,
  type PublishedPageRecord,
} from './pages.mapper.js';

const accueil = FIXTURES.pages[0] as unknown as PublishedPageRecord;

describe('pages publiques', () => {
  it('reconnaît les clés de page du contrat', () => {
    expect(isPageKey('accueil')).toBe(true);
    expect(isPageKey('404')).toBe(true);
    expect(isPageKey('home')).toBe(false);
  });

  it('masque les sections désactivées ou invalides', () => {
    expect(visibleSections(accueil.sections).map((section) => section['id'])).toEqual([
      'hero',
      'univers',
      'bandeau-services',
    ]);
    expect(visibleSections([{ id: 'x', type: 'inconnu', enabled: true }, { type: 'hero' }, 'texte'])).toEqual(
      [],
    );
  });

  it('traduit le titre et les sections par identifiant, avec repli sur le français', () => {
    const page = localizePage(accueil, 'en');
    const sections = visibleSections(page.sections);

    expect(page.title).toBe('Home');
    expect(sections[0]).toMatchObject({
      title: "Mambo isn't just a service. ==It's an experience designed for you.==",
      lead: 'Nos intervenants de confiance se déplacent chez vous, à Douala et environs.',
      primaryCta: { label: 'Request a free quote', href: '/devis' },
    });
    expect(sections[2]).toMatchObject({ items: ['Car rental', 'Private chef', 'Wellness massage'] });
  });

  it('date la page de sa publication', () => {
    const page = toPage({ ...accueil, key: 'accueil' }, [], new Date('2026-10-18T08:00:00.000Z'));

    expect(page).toEqual({
      key: 'accueil',
      title: 'Accueil',
      sections: [],
      seo: { title: null, description: null, ogImageUrl: null, noindex: false },
      isPreview: false,
      updatedAt: '2026-10-18T08:00:00.000Z',
    });
  });
});
