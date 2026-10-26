import { describe, expect, it } from 'vitest';
import {
  asVisual,
  collectImageIds,
  mediaUrl,
  resolveJsonVisuals,
  toMediaImage,
  toVisual,
  type MediaRecord,
} from './visual.mapper.js';

const BASE = 'https://media.mamboproxi.test/public/';

const chef: MediaRecord = {
  id: 'photo-chef-2',
  storageKey: 'media/2026/chef-2.png',
  width: 1536,
  height: 1024,
  alt: 'Un chef privé présente un plat.',
  focalX: 0.5,
  focalY: 0.4,
  blurDataUrl: null,
  variants: [
    {
      url: 'media/2026/chef-2-960.avif',
      storageKey: 'media/2026/chef-2-960.avif',
      width: 960,
      format: 'avif',
    },
    { storageKey: 'media/2026/chef-2-480.webp', width: 480, format: 'webp' },
    { url: 'ignoree.jpg', width: 300, format: 'jpeg' },
  ],
  status: 'READY',
};

describe('mediaUrl', () => {
  it('préfixe une clé de stockage et garde les adresses absolues ou relatives au site', () => {
    expect(mediaUrl('media/a.png', BASE)).toBe('https://media.mamboproxi.test/public/media/a.png');
    expect(mediaUrl('/photos/chef-2.png', BASE)).toBe('/photos/chef-2.png');
    expect(mediaUrl('https://cdn.example.com/a.png', BASE)).toBe('https://cdn.example.com/a.png');
  });
});

describe('toMediaImage / toVisual', () => {
  it('construit MediaImage avec point focal et variantes valides', () => {
    expect(toMediaImage(chef, BASE)).toEqual({
      id: 'photo-chef-2',
      url: 'https://media.mamboproxi.test/public/media/2026/chef-2.png',
      width: 1536,
      height: 1024,
      alt: 'Un chef privé présente un plat.',
      focalPoint: { x: 0.5, y: 0.4 },
      blurDataUrl: null,
      variants: [
        {
          url: 'https://media.mamboproxi.test/public/media/2026/chef-2-960.avif',
          width: 960,
          format: 'avif',
        },
        {
          url: 'https://media.mamboproxi.test/public/media/2026/chef-2-480.webp',
          width: 480,
          format: 'webp',
        },
      ],
    });
  });

  it("garde l'illustration sans image, ou si le traitement de l'image a échoué", () => {
    expect(toVisual('chef', null, BASE)).toEqual({ illustration: 'chef', image: null, alt: '' });
    expect(toVisual('chef', { ...chef, status: 'FAILED' }, BASE).image).toBeNull();
  });

  it("prend le texte alternatif de l'emplacement, sinon celui du média", () => {
    expect(toVisual('chef', chef, BASE, 'Dîner servi').alt).toBe('Dîner servi');
    expect(toVisual('chef', chef, BASE).alt).toBe('Un chef privé présente un plat.');
  });
});

describe('références de visuels dans les JSON', () => {
  const json = {
    hero: { illustration: 'chef', imageId: 'photo-chef-2', alt: '' },
    sections: [{ visual: { illustration: 'marche', imageId: 'absente', alt: 'Marché' } }],
    deja: { illustration: 'accueil', image: null, alt: '' },
  };

  it('collecte les identifiants référencés', () => {
    expect([...collectImageIds(json)]).toEqual(['photo-chef-2', 'absente']);
  });

  it('remplace les références par des visuels du contrat', () => {
    const resolved = resolveJsonVisuals(json, new Map([[chef.id, chef]]), BASE);

    expect(resolved.hero).toEqual(toVisual('chef', chef, BASE, ''));
    expect(resolved.sections[0]?.visual).toEqual({ illustration: 'marche', image: null, alt: 'Marché' });
    expect(resolved.deja).toEqual({ illustration: 'accueil', image: null, alt: '' });
    expect(asVisual(resolved.hero)?.image?.id).toBe('photo-chef-2');
    expect(asVisual({ illustration: 'inconnue' })).toBeNull();
  });
});
