import type { ArgumentMetadata } from '@nestjs/common';
import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { CONTRACT_WARM_UP_TIMEOUT, expectToMatchSchema, prepareContract } from '../../../test/contract.js';
import { ProblemException, type ProblemDetails } from '../problem/problem.js';
import { ZodValidationPipe } from './zod-validation.pipe.js';

const BODY: ArgumentMetadata = { type: 'body' };
const QUERY: ArgumentMetadata = { type: 'query' };

const contactSchema = z.object({
  contact: z.object({
    firstName: z.string().trim().min(1),
    email: z.email(),
  }),
  message: z.string().max(10).optional(),
  consent: z.literal(true, {
    error: "Merci d'accepter le traitement de vos données pour envoyer votre demande.",
  }),
});

async function problemOf(promise: Promise<unknown>): Promise<ProblemDetails> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ProblemException);
    return (error as ProblemException).problem;
  }
  throw new Error('La validation aurait dû échouer.');
}

describe('ZodValidationPipe', () => {
  beforeAll(() => prepareContract('Problem'), CONTRACT_WARM_UP_TIMEOUT);

  it('renvoie la valeur validée et transformée', async () => {
    const pipe = new ZodValidationPipe(contactSchema);

    const value = await pipe.transform(
      { contact: { firstName: '  Aminata ', email: 'aminata.diallo@example.com' }, consent: true },
      BODY,
    );

    expect(value).toEqual({
      contact: { firstName: 'Aminata', email: 'aminata.diallo@example.com' },
      consent: true,
    });
  });

  it('rejette un corps invalide par un 422 validation-error, un message en français par champ', async () => {
    const pipe = new ZodValidationPipe(contactSchema);

    const problem = await problemOf(
      pipe.transform(
        { contact: { firstName: '', email: 'pas-une-adresse' }, message: 'beaucoup trop long' },
        BODY,
      ),
    );

    expect(problem).toMatchObject({
      type: 'https://api.mamboproxi.com/problems/validation-error',
      title: 'Certaines informations sont à corriger',
      status: 422,
      detail: 'Vérifiez les champs signalés puis renvoyez le formulaire.',
    });
    expect(problem.errors).toEqual([
      { path: 'contact.firstName', code: 'required', message: 'Ce champ est obligatoire.' },
      { path: 'contact.email', code: 'invalid_email', message: 'Saisissez une adresse e-mail valide.' },
      { path: 'message', code: 'too_long', message: 'Saisissez au plus 10 caractères.' },
      {
        path: 'consent',
        code: 'required',
        message: "Merci d'accepter le traitement de vos données pour envoyer votre demande.",
      },
    ]);
    expectToMatchSchema('Problem', problem);
  });

  it('signale un champ absent comme obligatoire', async () => {
    const pipe = new ZodValidationPipe(contactSchema);

    const problem = await problemOf(pipe.transform({ consent: true }, BODY));

    expect(problem.errors).toEqual([
      { path: 'contact', code: 'required', message: 'Ce champ est obligatoire.' },
    ]);
  });

  it('ne recopie jamais les valeurs saisies dans la réponse', async () => {
    const pipe = new ZodValidationPipe(contactSchema);

    const problem = await problemOf(
      pipe.transform({ contact: { firstName: 'Aminata', email: 'aminata@@example' }, consent: true }, BODY),
    );

    expect(JSON.stringify(problem)).not.toContain('aminata@@example');
  });

  it("signale les champs inattendus d'un objet strict", async () => {
    const pipe = new ZodValidationPipe(z.strictObject({ name: z.string() }));

    const problem = await problemOf(pipe.transform({ name: 'Mireille', role: 'ADMIN' }, BODY));

    expect(problem.errors).toEqual([
      { path: 'role', code: 'unknown_field', message: "Ce champ n'est pas attendu." },
    ]);
  });

  it('rejette des paramètres de requête invalides par un 400 invalid-query', async () => {
    const pipe = new ZodValidationPipe(z.object({ q: z.string().trim().min(2).max(120) }));

    const problem = await problemOf(pipe.transform({ q: 'a' }, QUERY));

    expect(problem).toMatchObject({
      type: 'https://api.mamboproxi.com/problems/invalid-query',
      status: 400,
    });
    // Même code et même message que l'exemple du contrat (GET /v1/search).
    expect(problem.errors).toEqual([
      { path: 'q', code: 'too_short', message: 'Saisissez au moins 2 caractères.' },
    ]);
    expectToMatchSchema('Problem', problem);
  });

  it('applique les textes propres à une route', async () => {
    const pipe = new ZodValidationPipe(z.object({ q: z.string().min(2) }), {
      problem: {
        title: 'Recherche invalide',
        detail: 'Saisissez au moins 2 caractères pour lancer la recherche.',
      },
    });

    const problem = await problemOf(pipe.transform({ q: '' }, QUERY));

    expect(problem).toMatchObject({
      type: 'https://api.mamboproxi.com/problems/invalid-query',
      title: 'Recherche invalide',
      status: 400,
      detail: 'Saisissez au moins 2 caractères pour lancer la recherche.',
    });
  });

  it('convertit les paramètres de requête avec z.coerce', async () => {
    const pipe = new ZodValidationPipe(z.object({ page: z.coerce.number().int().min(1).default(1) }));

    await expect(pipe.transform({ page: '3' }, QUERY)).resolves.toEqual({ page: 3 });
    await expect(pipe.transform({}, QUERY)).resolves.toEqual({ page: 1 });
    const problem = await problemOf(pipe.transform({ page: '0' }, QUERY));
    expect(problem.errors).toEqual([
      { path: 'page', code: 'too_small', message: 'La valeur doit être supérieure ou égale à 1.' },
    ]);
  });

  it('indique le chemin des éléments de liste en notation pointée', async () => {
    const pipe = new ZodValidationPipe(z.object({ items: z.array(z.object({ label: z.string().min(3) })) }));

    const problem = await problemOf(pipe.transform({ items: [{ label: 'abc' }, { label: 'x' }] }, BODY));

    expect(problem.errors?.[0]?.path).toBe('items.1.label');
  });
});
