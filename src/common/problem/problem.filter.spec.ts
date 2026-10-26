import {
  BadRequestException,
  Logger,
  NotFoundException,
  UnauthorizedException,
  type ArgumentsHost,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { CONTRACT_WARM_UP_TIMEOUT, expectToMatchSchema, prepareContract } from '../../../test/contract.js';
import { ProblemException, type ProblemDetails } from './problem.js';
import { ProblemFilter } from './problem.filter.js';

interface FakeResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string | undefined;
  headersSent: boolean;
  status(code: number): FakeResponse;
  setHeader(name: string, value: string): FakeResponse;
  send(body: string): FakeResponse;
  end(): FakeResponse;
}

function createHost(): { host: ArgumentsHost; response: FakeResponse } {
  const response: FakeResponse = {
    statusCode: 200,
    headers: {},
    body: undefined,
    headersSent: false,
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
      return this;
    },
    send(body) {
      this.body = body;
      return this;
    },
    end() {
      return this;
    },
  };
  const request = { method: 'GET', url: '/v1/essai', originalUrl: '/v1/essai' };
  const host = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
      getNext: () => undefined,
    }),
  } as unknown as ArgumentsHost;
  return { host, response };
}

function render(exception: unknown): { response: FakeResponse; problem: ProblemDetails } {
  const { host, response } = createHost();
  new ProblemFilter().catch(exception, host);
  const problem = JSON.parse(response.body ?? 'null') as ProblemDetails;
  return { response, problem };
}

describe('ProblemFilter', () => {
  beforeAll(() => prepareContract('Problem'), CONTRACT_WARM_UP_TIMEOUT);

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renvoie une ProblemException telle quelle, au format application/problem+json', () => {
    const { response, problem } = render(
      new ProblemException({
        status: 409,
        type: 'slot-taken',
        title: 'Créneau indisponible',
        detail: "Ce créneau vient d'être réservé.",
      }),
    );

    expect(response.statusCode).toBe(409);
    expect(response.headers['content-type']).toBe('application/problem+json; charset=utf-8');
    expect(problem).toEqual({
      type: 'https://api.mamboproxi.com/problems/slot-taken',
      title: 'Créneau indisponible',
      status: 409,
      detail: "Ce créneau vient d'être réservé.",
    });
    expectToMatchSchema('Problem', problem);
  });

  it('traduit les exceptions HTTP de NestJS en français, sans reprendre leur message anglais', () => {
    const { response, problem } = render(new NotFoundException('Cannot GET /v1/inconnu'));

    expect(response.statusCode).toBe(404);
    expect(problem).toEqual({
      type: 'https://api.mamboproxi.com/problems/not-found',
      title: 'Introuvable',
      status: 404,
      detail: "La ressource demandée n'existe pas ou n'est plus disponible.",
    });
    expectToMatchSchema('Problem', problem);
  });

  it('produit un 401 conforme au contrat', () => {
    const { problem } = render(new UnauthorizedException());

    expect(problem.type).toBe('https://api.mamboproxi.com/problems/unauthorized');
    expect(problem.title).toBe('Session expirée');
    expectToMatchSchema('Problem', problem);
  });

  it('produit un 429 « Trop de tentatives » pour la limitation de débit', () => {
    const { response, problem } = render(new ThrottlerException());

    expect(response.statusCode).toBe(429);
    expect(problem).toMatchObject({
      type: 'https://api.mamboproxi.com/problems/rate-limited',
      title: 'Trop de tentatives',
      status: 429,
    });
    expectToMatchSchema('Problem', problem);
  });

  it('signale un JSON illisible par un 400 invalid-body', () => {
    const parseError = Object.assign(new SyntaxError('Unexpected token } in JSON at position 1'), {
      status: 400,
      statusCode: 400,
      type: 'entity.parse.failed',
      expose: true,
    });

    const { response, problem } = render(parseError);

    expect(response.statusCode).toBe(400);
    expect(problem).toEqual({
      type: 'https://api.mamboproxi.com/problems/invalid-body',
      title: 'Requête invalide',
      status: 400,
      detail: "Le contenu envoyé n'est pas un JSON valide.",
    });
  });

  it('signale un corps trop volumineux par un 413', () => {
    const tooLarge = Object.assign(new Error('request entity too large'), {
      status: 413,
      type: 'entity.too.large',
    });

    const { response, problem } = render(tooLarge);

    expect(response.statusCode).toBe(413);
    expect(problem.type).toBe('https://api.mamboproxi.com/problems/payload-too-large');
  });

  it('ne révèle aucun détail interne pour une erreur inattendue et la journalise', () => {
    const logged = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    const { response, problem } = render(new Error('connexion refusée à postgres://mambo:secret@db'));

    expect(response.statusCode).toBe(500);
    expect(problem).toEqual({
      type: 'https://api.mamboproxi.com/problems/internal-error',
      title: 'Erreur interne',
      status: 500,
      detail: "Une erreur inattendue s'est produite. Réessayez dans quelques instants.",
    });
    expect(response.body).not.toContain('secret');
    expect(logged).toHaveBeenCalledOnce();
    expectToMatchSchema('Problem', problem);
  });

  it("traite une valeur levée qui n'est pas une erreur comme une erreur interne", () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    const { response } = render('panne');

    expect(response.statusCode).toBe(500);
  });

  it("garde le texte par défaut d'une 400 générique", () => {
    const { problem } = render(new BadRequestException('Validation failed'));

    expect(problem).toMatchObject({ status: 400, title: 'Requête invalide' });
    expect(JSON.stringify(problem)).not.toContain('Validation failed');
  });

  it('ne réécrit pas une réponse déjà envoyée', () => {
    const { host, response } = createHost();
    response.headersSent = true;

    new ProblemFilter().catch(new NotFoundException(), host);

    expect(response.body).toBeUndefined();
  });
});
