import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '../../generated/prisma/client.js';
import { decoyReference, formatReference, nextReference, referenceYear } from './reference.js';

const REFERENCE_PATTERN = /^MP-\d{4}-\d{4,}$/;

describe('referenceYear', () => {
  it('prend l’année à l’heure de Douala (UTC+1)', () => {
    expect(referenceYear(new Date('2026-10-26T09:00:00.000Z'))).toBe(2026);
    expect(referenceYear(new Date('2026-12-31T22:59:59.999Z'))).toBe(2026);
    expect(referenceYear(new Date('2026-12-31T23:00:00.000Z'))).toBe(2027);
  });
});

describe('formatReference', () => {
  it('complète le numéro sur quatre chiffres, sans tronquer au-delà', () => {
    expect(formatReference(2026, 1)).toBe('MP-2026-0001');
    expect(formatReference(2026, 143)).toBe('MP-2026-0143');
    expect(formatReference(2026, 12345)).toBe('MP-2026-12345');
    expect(formatReference(2026, 12345)).toMatch(REFERENCE_PATTERN);
  });
});

describe('nextReference', () => {
  function transaction(lastValue: number) {
    const upsert = vi.fn().mockResolvedValue({ lastValue });
    return { tx: { referenceCounter: { upsert } } as unknown as Prisma.TransactionClient, upsert };
  }

  it('incrémente atomiquement le compteur de l’année (création à 1 la première fois)', async () => {
    const { tx, upsert } = transaction(144);

    await expect(nextReference(tx, new Date('2026-10-26T09:00:00.000Z'))).resolves.toBe('MP-2026-0144');
    expect(upsert).toHaveBeenCalledWith({
      where: { year: 2026 },
      create: { year: 2026, lastValue: 1 },
      update: { lastValue: { increment: 1 } },
      select: { lastValue: true },
    });
  });

  it('change de compteur au Nouvel An de Douala', async () => {
    const { tx, upsert } = transaction(1);

    await expect(nextReference(tx, new Date('2026-12-31T23:30:00.000Z'))).resolves.toBe('MP-2027-0001');
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { year: 2027 } }));
  });
});

describe('decoyReference', () => {
  it('ressemble à une vraie référence de l’année', () => {
    const reference = decoyReference(new Date('2026-10-26T09:00:00.000Z'));
    expect(reference).toMatch(REFERENCE_PATTERN);
    expect(reference.startsWith('MP-2026-')).toBe(true);
  });
});
