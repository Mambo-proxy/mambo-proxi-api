import { describe, expect, it } from 'vitest';
import { slugify, uniqueSlug } from './slug.js';

describe('slugify', () => {
  it('produit un slug du contrat depuis un nom français', () => {
    expect(slugify('Visites guidées de Douala')).toBe('visites-guidees-de-douala');
    expect(slugify('  Chef privé — à domicile !  ')).toBe('chef-prive-a-domicile');
    expect(slugify('Œuvres d’art & cœur')).toBe('oeuvres-d-art-coeur');
    expect(slugify('Entretien (copie)')).toBe('entretien-copie');
    expect(slugify('***')).toBe('');
  });

  it('respecte la longueur maximale sans finir par un tiret', () => {
    expect(slugify('abc def', 4)).toBe('abc');
    expect(slugify('a'.repeat(200))).toHaveLength(120);
  });
});

describe('uniqueSlug', () => {
  it('ajoute -2, -3… si le slug est déjà pris', () => {
    expect(uniqueSlug('chef-prive', new Set())).toBe('chef-prive');
    expect(uniqueSlug('chef-prive', new Set(['chef-prive']))).toBe('chef-prive-2');
    expect(uniqueSlug('chef-prive', new Set(['chef-prive', 'chef-prive-2']))).toBe('chef-prive-3');
    expect(uniqueSlug('', new Set(), 'service')).toBe('service');
  });

  it('reste dans les 120 caractères du contrat', () => {
    const long = 'a'.repeat(120);
    expect(uniqueSlug(long, new Set([long]))).toBe(`${'a'.repeat(118)}-2`);
  });
});
