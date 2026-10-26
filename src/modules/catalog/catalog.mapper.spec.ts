import { beforeAll, describe, expect, it } from 'vitest';
import { CONTRACT_WARM_UP_TIMEOUT, expectToMatchSchema, prepareContract } from '../../../test/contract.js';
import { FIXTURES } from '../../../test/fixtures/public-content.js';
import { toMediaImage, toVisual } from '../media/visual.mapper.js';
import {
  categoryNumber,
  initialsOf,
  localizeCategorySummary,
  serviceHref,
  toCategorySummary,
  toCategoryVisuals,
  toReview,
  toReviewSummary,
  toServiceDetail,
  toServiceSummary,
  type MediaResolver,
} from './catalog.mapper.js';
import type {
  CategorySummaryRecord,
  ReviewRecord,
  ServiceDetailRecord,
  ServiceSummaryRecord,
} from './catalog.selects.js';

const BASE = 'https://media.mamboproxi.test';
const media: MediaResolver = {
  image: (record) => toMediaImage(record, BASE),
  visual: (illustration, record, alt) => toVisual(illustration, record, BASE, alt),
};
const NOW = new Date('2026-10-26T08:00:00.000Z');

// Les enregistrements de démonstration portent toutes les colonnes : ils contiennent ceux des `select`.
const chefPrive = FIXTURES.services.chefPrive as unknown as ServiceDetailRecord;
const maisonEssentiel = FIXTURES.services.maisonEssentiel as unknown as ServiceSummaryRecord;
const reviews = FIXTURES.reviews as unknown as ReviewRecord[];
const publishedReviews = reviews.filter((review) => review.status === 'PUBLIE');

describe('règles de présentation', () => {
  it('calcule les initiales affichées des avis', () => {
    expect(initialsOf('Jean-Marc T.')).toBe('JT');
    expect(initialsOf('Aminata D.')).toBe('AD');
    expect(initialsOf('Élodie')).toBe('ÉL');
    expect(initialsOf('  ')).toBe('?');
  });

  it('construit les adresses des rubriques et services', () => {
    expect(serviceHref('experience', 'chef-prive', 'SERVICE')).toBe('/services/experience/chef-prive');
    expect(serviceHref('services-a-domicile', 'maison-essentiel', 'FORMULA')).toBe(
      '/services/services-a-domicile#formules',
    );
    expect(categoryNumber(0)).toBe('01');
    expect(categoryNumber(11)).toBe('12');
  });

  it('résume les notes des avis publiés', () => {
    expect(toReviewSummary([])).toBeNull();
    expect(
      toReviewSummary([
        { rating: 5, verified: true },
        { rating: 4, verified: false },
        { rating: 4, verified: true },
      ]),
    ).toEqual({
      average: 4.3,
      total: 3,
      verifiedCount: 2,
      distribution: { '1': 0, '2': 0, '3': 0, '4': 2, '5': 1 },
    });
  });
});

describe('mappers du catalogue', () => {
  beforeAll(
    () => prepareContract('ServiceSummary', 'ServiceDetail', 'CategorySummary', 'Review'),
    CONTRACT_WARM_UP_TIMEOUT,
  );

  it('présente un service en français, conforme au contrat', () => {
    const summary = toServiceSummary(chefPrive, 'fr', media);

    expect(summary).toMatchObject({
      id: 'svc_chef_prive',
      slug: 'chef-prive',
      name: 'Chef privé',
      category: { slug: 'experience', name: 'Expérience' },
      href: '/services/experience/chef-prive',
      kind: 'service',
      visual: { illustration: 'chef', image: { id: 'photo-chef-2', url: '/photos/chef-2.png' } },
    });
    expectToMatchSchema('ServiceSummary', summary);
  });

  it("traduit une formule et garde l'adresse française", () => {
    const summary = toServiceSummary(maisonEssentiel, 'en', media);

    expect(summary).toMatchObject({
      name: 'Home Essential',
      summary: 'Home cleaning · 2 hours.',
      category: { name: 'Home services' },
      href: '/services/services-a-domicile#formules',
      kind: 'formula',
    });
  });

  it('présente la fiche en anglais avec repli sur le français, champ par champ', () => {
    const detail = toServiceDetail(chefPrive, 'en', media, { publishedReviews, now: NOW });

    expect(detail.name).toBe('Private chef');
    expect(detail.cities).toEqual(['Douala', 'Yaoundé', 'Kribi']);
    expect(detail.steps[0]).toEqual({
      title: 'Talking about your project',
      text: 'Date, lieu, nombre d’invités, envies et contraintes alimentaires.',
    });
    expect(detail.faq[0]?.['question']).toBe('How much does a private chef cost?');
    expect(detail.relatedTitle).toBe('Pour compléter votre événement');
    expect(detail.offers?.eyebrow).toBe('Our chefs');
    expect(detail.offers?.items[0]).toMatchObject({
      title: 'Chef Paul — Cameroonian cuisine',
      actionLabel: 'Request a quote',
    });
    expect(detail.related.map((service) => service.slug)).toEqual(['location-voiture', 'photographe']);
    expect(detail.related[0]?.name).toBe('Car rental');
    expect(detail.gallery[1]).toMatchObject({ illustration: 'chef', alt: 'Un dîner servi' });
    expect(detail.reviews.map((review) => review.id)).toEqual(['rev_jean_marc_chef', 'rev_laure_chef']);
    expect(detail.reviews[0]?.service?.name).toBe('Private chef');
    expect(detail.reviewSummary).toMatchObject({ total: 2, average: 4.5, verifiedCount: 1 });
    expect(detail.seo).toEqual({
      title: 'Chef privé à domicile à Douala, Yaoundé, Kribi',
      description: 'Un chef à domicile pour vos dîners et réceptions au Cameroun.',
      ogImageUrl: null,
      noindex: false,
    });
    expect(detail).not.toHaveProperty('price');
    expectToMatchSchema('ServiceDetail', detail);
  });

  it('présente un avis conforme au contrat', () => {
    const review = toReview(reviews[0], 'fr');

    expect(review).toMatchObject({
      initials: 'JT',
      date: '2026-09-12T10:00:00.000Z',
      service: { categorySlug: 'experience' },
    });
    expectToMatchSchema('Review', review);
  });

  it('présente une rubrique traduite avec ses visuels secondaires', () => {
    const record = FIXTURES.categories.experience as unknown as CategorySummaryRecord;
    const localized = localizeCategorySummary(record, 'en');
    const summary = toCategorySummary(localized, 'en', media, {
      rank: 1,
      visuals: toCategoryVisuals({ thumbnail: { illustration: 'chef', image: null, alt: '' } }),
      includeServices: false,
    });

    expect(summary).toMatchObject({
      name: 'Experience',
      tint: 'orange-50',
      iconColor: 'orange-700',
      number: '02',
      href: '/services/experience',
      thumbnail: { illustration: 'chef', image: null, alt: '' },
      homeCard: { title: 'Tailor-made moments', chips: ['Car rental', 'Private chef'], visual: null },
    });
    expect(summary).not.toHaveProperty('services');
    expectToMatchSchema('CategorySummary', summary);
  });
});
