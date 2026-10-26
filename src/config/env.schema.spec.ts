import { describe, expect, it } from 'vitest';
import { EnvValidationError, parseEnv } from './env.schema.js';

/** Configuration de production complète et valide (valeurs fictives). */
const PRODUCTION_ENV: Record<string, string> = {
  NODE_ENV: 'production',
  SITE_ENV: 'production',
  PORT: '4000',
  API_URL: 'https://api.mamboproxi.com',
  WEB_URL: 'https://mamboproxi.com',
  DATABASE_URL: 'postgresql://mambo:motdepasse-long@db:5432/mambo_proxi?schema=public',
  REDIS_URL: 'redis://redis:6379',
  S3_ENDPOINT: 'https://s3.fr-par.scw.cloud',
  S3_REGION: 'fr-par',
  S3_ACCESS_KEY: 'SCWXXXXXXXXXXXXXXXXX',
  S3_SECRET_KEY: 'cle-secrete-du-fournisseur-s3',
  S3_BUCKET_PUBLIC: 'mambo-public',
  S3_BUCKET_PRIVATE: 'mambo-private',
  S3_FORCE_PATH_STYLE: 'false',
  MEDIA_PUBLIC_URL: 'https://media.mamboproxi.com',
  SMTP_HOST: 'smtp.example.com',
  SMTP_PORT: '587',
  SMTP_SECURE: 'false',
  SMTP_USER: 'contact@mamboproxi.com',
  SMTP_PASSWORD: 'mot-de-passe-smtp',
  MAIL_FROM: 'MAMBO Proxi <contact@mamboproxi.com>',
  JWT_ACCESS_SECRET: 'a'.repeat(48),
  JWT_REFRESH_SECRET: 'b'.repeat(48),
  TOKEN_SIGNING_SECRET: 'c'.repeat(48),
  COOKIE_DOMAIN: '.mamboproxi.com',
  REVALIDATE_SECRET: 'd'.repeat(32),
  TURNSTILE_SECRET_KEY: '0x4AAAAAAAexemple-de-cle-secrete',
  LOG_LEVEL: 'info',
};

function issuesOf(raw: Record<string, string | undefined>): Record<string, string> {
  try {
    parseEnv(raw);
  } catch (error) {
    expect(error).toBeInstanceOf(EnvValidationError);
    return Object.fromEntries(
      (error as EnvValidationError).issues.map((issue) => [issue.variable, issue.message]),
    );
  }
  throw new Error('La configuration aurait dû être refusée.');
}

describe('parseEnv', () => {
  it('fournit les valeurs de .env.example en développement', () => {
    const env = parseEnv({ NODE_ENV: 'development' });

    expect(env).toMatchObject({
      NODE_ENV: 'development',
      SITE_ENV: 'development',
      PORT: 4000,
      WEB_URL: 'http://localhost:3000',
      DATABASE_URL: 'postgresql://mambo:mambo@localhost:5432/mambo_proxi?schema=public',
      REDIS_URL: 'redis://localhost:6379',
      S3_FORCE_PATH_STYLE: true,
      SMTP_PORT: 1025,
      SMTP_SECURE: false,
      LOG_LEVEL: 'info',
    });
    expect(env.SMTP_USER).toBeUndefined();
  });

  it("active le worker des e-mails sauf en test, et n'accepte que on ou off", () => {
    expect(parseEnv({ NODE_ENV: 'development' }).MAIL_WORKER).toBe('on');
    expect(parseEnv({ NODE_ENV: 'test' }).MAIL_WORKER).toBe('off');
    expect(parseEnv({ NODE_ENV: 'test', MAIL_WORKER: 'on' }).MAIL_WORKER).toBe('on');
    expect(parseEnv(PRODUCTION_ENV).MAIL_WORKER).toBe('on');
    expect(issuesOf({ NODE_ENV: 'development', MAIL_WORKER: 'yes' })).toEqual({
      MAIL_WORKER: 'Valeur attendue : on ou off.',
    });
  });

  it('considère le développement comme environnement par défaut', () => {
    expect(parseEnv({}).NODE_ENV).toBe('development');
  });

  it('rend les journaux muets en test', () => {
    expect(parseEnv({ NODE_ENV: 'test' }).LOG_LEVEL).toBe('silent');
  });

  it('convertit les nombres et les booléens, et ignore les variables inconnues', () => {
    const env = parseEnv({ NODE_ENV: 'test', PORT: '4100', S3_FORCE_PATH_STYLE: 'false', OTHER_TOOL: 'x' });

    expect(env.PORT).toBe(4100);
    expect(env.S3_FORCE_PATH_STYLE).toBe(false);
    expect(env).not.toHaveProperty('OTHER_TOOL');
  });

  it('traite une valeur vide comme absente', () => {
    const env = parseEnv({ NODE_ENV: 'development', PORT: '', SMTP_USER: '', COOKIE_DOMAIN: '' });

    expect(env.PORT).toBe(4000);
    expect(env.SMTP_USER).toBeUndefined();
    expect(env.COOKIE_DOMAIN).toBeUndefined();
  });

  it('accepte une configuration de production complète', () => {
    const env = parseEnv(PRODUCTION_ENV);

    expect(env.NODE_ENV).toBe('production');
    expect(env.SMTP_PORT).toBe(587);
    expect(env.SEED_ADMIN_EMAIL).toBeUndefined();
  });

  it("exige toutes les variables en production, sans valeur d'exemple par défaut", () => {
    const issues = issuesOf({ NODE_ENV: 'production' });

    expect(issues).toMatchObject({
      DATABASE_URL: 'Variable obligatoire manquante.',
      REDIS_URL: 'Variable obligatoire manquante.',
      WEB_URL: 'Variable obligatoire manquante.',
      JWT_ACCESS_SECRET: 'Variable obligatoire manquante.',
      SMTP_PORT: 'Variable obligatoire manquante.',
    });
    expect(issues).not.toHaveProperty('PORT');
    expect(issues).not.toHaveProperty('SMTP_USER');
  });

  it("refuse en production les secrets d'exemple et la clé d'essai Turnstile", () => {
    const issues = issuesOf({
      ...PRODUCTION_ENV,
      JWT_ACCESS_SECRET: 'change-me-access-secret-at-least-32-characters',
      TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA',
    });

    expect(issues).toEqual({
      JWT_ACCESS_SECRET: "Remplacez la valeur d'exemple par un secret long et aléatoire.",
      TURNSTILE_SECRET_KEY: "La clé d'essai Turnstile est interdite en production.",
    });
  });

  it('exige https et des secrets distincts en production', () => {
    const issues = issuesOf({
      ...PRODUCTION_ENV,
      WEB_URL: 'http://mamboproxi.com',
      JWT_REFRESH_SECRET: PRODUCTION_ENV['JWT_ACCESS_SECRET'],
    });

    expect(issues).toEqual({
      WEB_URL: 'Une adresse https est obligatoire en production.',
      JWT_REFRESH_SECRET: "Les secrets des jetons d'accès et de rafraîchissement doivent être différents.",
    });
  });

  it('explique en français chaque valeur invalide', () => {
    const issues = issuesOf({
      NODE_ENV: 'development',
      PORT: 'abc',
      DATABASE_URL: 'mysql://localhost/base',
      JWT_ACCESS_SECRET: 'court',
      LOG_LEVEL: 'bavard',
    });

    expect(issues).toEqual({
      PORT: 'Saisissez un numéro de port compris entre 1 et 65535.',
      DATABASE_URL:
        'Saisissez une adresse PostgreSQL valide (postgresql://utilisateur:motdepasse@hôte:5432/base).',
      JWT_ACCESS_SECRET: 'Le secret doit contenir au moins 32 caractères.',
      LOG_LEVEL: 'Valeur attendue : fatal, error, warn, info, debug, trace, silent.',
    });
  });

  it('refuse un environnement inconnu', () => {
    expect(issuesOf({ NODE_ENV: 'staging' })).toEqual({
      NODE_ENV: 'Valeur attendue : development, test ou production.',
    });
  });

  it("produit un message d'erreur lisible qui nomme chaque variable", () => {
    expect(() => parseEnv({ NODE_ENV: 'production' })).toThrow(
      /Configuration invalide[\s\S]*- DATABASE_URL : /,
    );
  });
});
