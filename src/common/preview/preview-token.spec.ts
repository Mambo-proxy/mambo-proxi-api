import { describe, expect, it } from 'vitest';
import { PREVIEW_TOKEN_TTL_MS, signPreviewToken, verifyPreviewToken } from './preview-token.js';

const SECRET = 's'.repeat(48);
const NOW = new Date('2026-10-27T09:00:00.000Z');
const LATER = new Date(NOW.getTime() + PREVIEW_TOKEN_TTL_MS);

describe('jetons de prévisualisation', () => {
  it('sont vérifiés pour le contenu et le type pour lesquels ils ont été émis', () => {
    const token = signPreviewToken(SECRET, { kind: 'page', id: 'accueil', expiresAt: LATER });
    expect(verifyPreviewToken(SECRET, token, 'page', NOW)).toEqual({
      kind: 'page',
      id: 'accueil',
      expiresAt: LATER,
    });
    expect(verifyPreviewToken(SECRET, token, 'service', NOW)).toBeNull();
  });

  it('sont refusés expirés, modifiés ou signés avec une autre clé', () => {
    const token = signPreviewToken(SECRET, { kind: 'service', id: 'svc_1', expiresAt: LATER });
    expect(verifyPreviewToken(SECRET, token, 'service', LATER)).toBeNull();
    expect(verifyPreviewToken('t'.repeat(48), token, 'service', NOW)).toBeNull();
    const [, signed] = token.split('.');
    const forged = `${Buffer.from(JSON.stringify({ k: 'service', id: 'svc_2', exp: LATER.getTime() })).toString('base64url')}.${String(signed)}`;
    expect(verifyPreviewToken(SECRET, forged, 'service', NOW)).toBeNull();
    expect(verifyPreviewToken(SECRET, 'pas-un-jeton', 'service', NOW)).toBeNull();
    expect(verifyPreviewToken(SECRET, `${token}.x`, 'service', NOW)).toBeNull();
  });
});
