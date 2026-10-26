import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppConfigService } from '../../config/app-config.service.js';
import { TURNSTILE_TEST_SECRET } from '../../config/env.schema.js';
import { ProblemException } from '../problem/problem.js';
import { antiSpamSchema, evaluateAntiSpam, type AntiSpamInput } from './anti-spam.schema.js';
import { AntiSpamService } from './anti-spam.service.js';
import { TURNSTILE_VERIFY_URL, TurnstileService } from './turnstile.service.js';

const NOW = new Date('2026-10-26T09:00:00.000Z');

function antiSpam(overrides: Partial<AntiSpamInput> = {}): AntiSpamInput {
  return {
    turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX',
    honeypot: '',
    startedAt: '2026-10-26T08:58:00.000Z',
    ...overrides,
  };
}

function config(isProduction: boolean, secret: string): AppConfigService {
  return { isProduction, get: () => secret } as unknown as AppConfigService;
}

function fetchReturning(body: unknown, status = 200) {
  return vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
    );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('antiSpamSchema', () => {
  it('accepte l’exemple du contrat', () => {
    expect(antiSpamSchema.safeParse(antiSpam()).success).toBe(true);
  });

  it('exige le jeton et la date d’ouverture du formulaire', () => {
    const result = antiSpamSchema.safeParse({ honeypot: '' });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toEqual([
      'turnstileToken',
      'startedAt',
    ]);
  });

  it('accepte un champ piège rempli (succès factice décidé ensuite)', () => {
    expect(antiSpamSchema.safeParse(antiSpam({ honeypot: 'https://spam.example' })).success).toBe(true);
  });
});

describe('evaluateAntiSpam', () => {
  it('laisse passer un formulaire rempli en plus de 3 s', () => {
    expect(evaluateAntiSpam(antiSpam(), NOW)).toBe('ok');
    expect(evaluateAntiSpam(antiSpam({ startedAt: '2026-10-26T08:59:57.000Z' }), NOW)).toBe('ok');
  });

  it('signale un champ piège rempli, même sans autre anomalie', () => {
    expect(evaluateAntiSpam(antiSpam({ honeypot: 'x' }), NOW)).toBe('trap');
  });

  it('ignore un champ piège absent ou fait d’espaces', () => {
    expect(evaluateAntiSpam(antiSpam({ honeypot: undefined }), NOW)).toBe('ok');
    expect(evaluateAntiSpam(antiSpam({ honeypot: '  ' }), NOW)).toBe('ok');
  });

  it('refuse un envoi moins de 3 s après l’ouverture du formulaire', () => {
    expect(evaluateAntiSpam(antiSpam({ startedAt: '2026-10-26T08:59:58.000Z' }), NOW)).toBe('too-fast');
    expect(evaluateAntiSpam(antiSpam({ startedAt: NOW.toISOString() }), NOW)).toBe('too-fast');
  });

  it('tolère une horloge du visiteur en avance', () => {
    expect(evaluateAntiSpam(antiSpam({ startedAt: '2026-10-26T09:05:00.000Z' }), NOW)).toBe('ok');
  });
});

describe('TurnstileService', () => {
  it('accepte un jeton vide hors production, le refuse en production', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(new TurnstileService(config(false, 'secret')).verify('', '203.0.113.7')).resolves.toBe(true);
    await expect(new TurnstileService(config(true, 'secret')).verify('', '203.0.113.7')).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('valide sans appel réseau avec la clé d’essai hors production', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      new TurnstileService(config(false, TURNSTILE_TEST_SECRET)).verify('jeton', undefined),
    ).resolves.toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('interroge Cloudflare avec la clé secrète, le jeton et l’adresse IP', async () => {
    const fetchMock = fetchReturning({ success: true });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      new TurnstileService(config(true, 'prod-secret')).verify('jeton', '203.0.113.7'),
    ).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(TURNSTILE_VERIFY_URL);
    expect(init.method).toBe('POST');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const body = init.body as URLSearchParams;
    expect(Object.fromEntries(body)).toEqual({
      secret: 'prod-secret',
      response: 'jeton',
      remoteip: '203.0.113.7',
    });
  });

  it('refuse un jeton rejeté par Cloudflare', async () => {
    vi.stubGlobal('fetch', fetchReturning({ success: false, 'error-codes': ['invalid-input-response'] }));
    await expect(new TurnstileService(config(true, 'prod-secret')).verify('jeton', undefined)).resolves.toBe(
      false,
    );
  });

  it('refuse le jeton si Cloudflare est injoignable ou répond en erreur', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('Délai dépassé', 'TimeoutError')));
    await expect(new TurnstileService(config(true, 'prod-secret')).verify('jeton', undefined)).resolves.toBe(
      false,
    );

    vi.stubGlobal('fetch', fetchReturning({}, 503));
    await expect(new TurnstileService(config(true, 'prod-secret')).verify('jeton', undefined)).resolves.toBe(
      false,
    );
  });
});

describe('AntiSpamService', () => {
  function service(accepted: boolean) {
    const verify = vi.fn().mockResolvedValue(accepted);
    return { service: new AntiSpamService({ verify } as unknown as TurnstileService), verify };
  }

  it('accepte un envoi valide', async () => {
    const { service: antiSpamService, verify } = service(true);
    await expect(antiSpamService.check(antiSpam(), '203.0.113.7', NOW)).resolves.toBe('accepted');
    expect(verify).toHaveBeenCalledWith('XXXX.DUMMY.TOKEN.XXXX', '203.0.113.7');
  });

  it('signale le piège sans vérifier le jeton', async () => {
    const { service: antiSpamService, verify } = service(true);
    await expect(antiSpamService.check(antiSpam({ honeypot: 'x' }), undefined, NOW)).resolves.toBe('trapped');
    expect(verify).not.toHaveBeenCalled();
  });

  it('répond 400 spam-check-failed à un envoi trop rapide ou à un jeton refusé', async () => {
    const tooFast = service(true).service.check(antiSpam({ startedAt: NOW.toISOString() }), undefined, NOW);
    await expect(tooFast).rejects.toBeInstanceOf(ProblemException);

    const refused = service(false).service.check(antiSpam(), undefined, NOW);
    await expect(refused).rejects.toMatchObject({
      problem: {
        status: 400,
        type: 'https://api.mamboproxi.com/problems/spam-check-failed',
        title: 'Vérification de sécurité échouée',
        detail: "La vérification anti-robot n'a pas abouti. Rechargez la page puis réessayez.",
      },
    });
  });
});
