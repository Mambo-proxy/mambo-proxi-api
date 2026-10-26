import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { signAccessToken, verifyAccessToken } from './access-token.js';
import { deviceLabel } from './device-label.js';
import { accountLockedException } from './auth.errors.js';
import { isCompromisedPassword } from './password-policy.js';
import { hmacDigest, randomOtpCode, randomToken, safeEqual } from './tokens.js';
import { emailHint, userFirstName, userInitials, userStatus } from './user-identity.js';

const SECRET = 'secret-de-test-du-jeton-d-acces-0123456789';
const NOW = new Date('2026-10-26T09:00:00.000Z');
const b64 = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');

describe("jeton d'accès (JWT HS256)", () => {
  it('signe puis vérifie les revendications', () => {
    const token = signAccessToken(SECRET, { sub: 'usr_1', sid: 'ses_1' }, NOW, 15 * 60_000);

    expect(verifyAccessToken(SECRET, token, NOW)).toEqual({
      sub: 'usr_1',
      sid: 'ses_1',
      iat: NOW.getTime() / 1000,
      exp: NOW.getTime() / 1000 + 900,
    });
  });

  it('refuse un jeton expiré, signé avec une autre clé ou modifié', () => {
    const token = signAccessToken(SECRET, { sub: 'usr_1', sid: 'ses_1' }, NOW, 15 * 60_000);
    const [header, , signature] = token.split('.');

    expect(verifyAccessToken(SECRET, token, new Date(NOW.getTime() + 15 * 60_000))).toBeNull();
    expect(verifyAccessToken(`${SECRET}-autre`, token, NOW)).toBeNull();
    const forged = `${String(header)}.${b64({ sub: 'usr_admin', sid: 'ses_1', iat: 0, exp: 9e9 })}.${String(signature)}`;
    expect(verifyAccessToken(SECRET, forged, NOW)).toBeNull();
    expect(verifyAccessToken(SECRET, 'pas-un-jeton', NOW)).toBeNull();
  });

  it('refuse tout autre algorithme, y compris « none »', () => {
    const payload = b64({ sub: 'usr_1', sid: 'ses_1', iat: 0, exp: 9e9 });
    const none = `${b64({ alg: 'none', typ: 'JWT' })}.${payload}.`;
    const hs512Header = b64({ alg: 'HS512', typ: 'JWT' });
    const hs512 = `${hs512Header}.${payload}.${createHmac('sha512', SECRET).update(`${hs512Header}.${payload}`).digest('base64url')}`;

    expect(verifyAccessToken(SECRET, none, NOW)).toBeNull();
    expect(verifyAccessToken(SECRET, hs512, NOW)).toBeNull();
  });
});

describe('jetons et codes', () => {
  it('tire des jetons de 256 bits et des codes à 6 chiffres', () => {
    expect(randomToken()).toMatch(/^[\w-]{43}$/);
    expect(randomToken()).not.toBe(randomToken());
    for (let index = 0; index < 50; index += 1) expect(randomOtpCode()).toMatch(/^\d{6}$/);
  });

  it('sépare les usages des condensats et compare à temps constant', () => {
    expect(hmacDigest('k', 'otp', 'a')).not.toBe(hmacDigest('k', 'refresh', 'a'));
    expect(hmacDigest('k', 'otp', 'a')).toBe(hmacDigest('k', 'otp', 'a'));
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('mots de passe compromis', () => {
  it('refuse les mots de passe courants, les suites et l’adresse e-mail', () => {
    expect(isCompromisedPassword('MotDePasse123')).toBe(true);
    expect(isCompromisedPassword('123456789012')).toBe(true);
    expect(isCompromisedPassword('aaaaaaaaaaaa')).toBe(true);
    expect(isCompromisedPassword('azertyuiopaz')).toBe(true);
    expect(isCompromisedPassword('paul.ngando@mamboproxi.com', 'Paul.Ngando@mamboproxi.com')).toBe(true);
  });

  it('accepte une phrase de passe ordinaire', () => {
    expect(isCompromisedPassword('Le baobab de Bonapriso fleurit en mai')).toBe(false);
    expect(isCompromisedPassword('kT9#vLq2!mWz')).toBe(false);
  });
});

describe('identité affichée', () => {
  it('calcule initiales sans accents, prénom et indice de l’adresse', () => {
    expect(userInitials('Équipe Douala')).toBe('ED');
    expect(userInitials('Mireille Bell')).toBe('MB');
    expect(userInitials('Grace')).toBe('G');
    expect(userInitials('  ')).toBe('?');
    expect(userFirstName('Marie Claire Ndongo')).toBe('Marie');
    expect(emailHint('mireille@mamboproxi.com')).toBe('m•••••@mamboproxi.com');
  });

  it('déduit le statut affiché', () => {
    expect(userStatus({ isActive: false, activatedAt: NOW })).toBe('DESACTIVE');
    expect(userStatus({ isActive: true, activatedAt: null })).toBe('INVITE');
    expect(userStatus({ isActive: true, activatedAt: NOW })).toBe('ACTIF');
  });

  it("nomme l'appareil de confiance d'après l'agent utilisateur", () => {
    const chromeWindows =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';
    const safariIphone =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1';

    expect(deviceLabel(chromeWindows)).toBe('Chrome sous Windows');
    expect(deviceLabel(safariIphone)).toBe('Safari sous iOS');
    expect(deviceLabel(null)).toBeNull();
  });
});

describe('verrouillage', () => {
  it('annonce le délai restant en minutes ou en heures', () => {
    expect(accountLockedException(15 * 60_000).problem.detail).toBe(
      'Trop de tentatives. Réessayez dans 15 minutes ou réinitialisez votre mot de passe.',
    );
    expect(accountLockedException(30_000).problem.detail).toContain('dans 1 minute ou');
    expect(accountLockedException(4 * 60 * 60_000).problem.detail).toContain('dans 4 heures ou');
    expect(accountLockedException(15 * 60_000).problem).toMatchObject({
      status: 423,
      type: 'https://api.mamboproxi.com/problems/account-locked',
      title: 'Compte verrouillé',
    });
  });
});
