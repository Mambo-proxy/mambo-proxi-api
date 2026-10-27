import { z } from 'zod';
import { describeIssue, formatIssuePath } from '../common/validation/zod-issues.js';

export const NODE_ENVS = ['development', 'test', 'production'] as const;
export type NodeEnv = (typeof NODE_ENVS)[number];

export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

/** Clé d'essai Cloudflare Turnstile (valide toujours) : interdite en production. */
export const TURNSTILE_TEST_SECRET = '1x0000000000000000000000000000000AA';

/** Valeurs par défaut communes à tous les environnements. */
const COMMON_DEFAULTS: Record<string, string> = {
  PORT: '4000',
  LOG_LEVEL: 'info',
  S3_FORCE_PATH_STYLE: 'false',
  SMTP_SECURE: 'false',
  MAIL_WORKER: 'on',
  STORAGE_DRIVER: 'local',
  STORAGE_DIR: 'var/storage',
};

/** Valeurs par défaut de développement et de test : celles de `.env.example` (services de docker-compose.yml). */
const LOCAL_DEFAULTS: Record<string, string> = {
  SITE_ENV: 'development',
  API_URL: 'http://localhost:4000',
  WEB_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgresql://mambo:mambo@localhost:5432/mambo_proxi?schema=public',
  REDIS_URL: 'redis://localhost:6379',
  S3_ENDPOINT: 'http://localhost:8333',
  S3_REGION: 'fr-par',
  S3_ACCESS_KEY: 'mambo-dev-access',
  S3_SECRET_KEY: 'mambo-dev-secret-change-me',
  S3_BUCKET_PUBLIC: 'mambo-public',
  S3_BUCKET_PRIVATE: 'mambo-private',
  S3_FORCE_PATH_STYLE: 'true',
  MEDIA_PUBLIC_URL: 'http://localhost:8333/mambo-public',
  SMTP_HOST: 'localhost',
  SMTP_PORT: '1025',
  MAIL_FROM: 'MAMBO Proxi <contact@mamboproxi.com>',
  JWT_ACCESS_SECRET: 'change-me-access-secret-at-least-32-characters',
  JWT_REFRESH_SECRET: 'change-me-refresh-secret-at-least-32-characters',
  TOKEN_SIGNING_SECRET: 'change-me-token-secret-at-least-32-characters',
  REVALIDATE_SECRET: 'change-me-revalidate-secret',
  TURNSTILE_SECRET_KEY: TURNSTILE_TEST_SECRET,
  SEED_ADMIN_EMAIL: 'mireille@mamboproxi.com',
  SEED_ADMIN_NAME: 'Mireille Bell',
  SEED_ADMIN_PASSWORD: 'change-me-on-first-login',
};

// En test, aucun worker ne consomme la file des e-mails (les tests qui en ont besoin l'activent explicitement).
const TEST_DEFAULTS: Record<string, string> = { ...LOCAL_DEFAULTS, LOG_LEVEL: 'silent', MAIL_WORKER: 'off' };

/**
 * Message d'une valeur invalide. Une variable absente garde le message « Variable obligatoire manquante. »
 * (la fonction renvoie `undefined` pour laisser la main à la table de messages générale).
 */
const invalid =
  (message: string) =>
  (issue: { input?: unknown }): string | undefined =>
    issue.input === undefined ? undefined : message;

const httpUrl = z.url({
  protocol: /^https?$/,
  error: invalid('Saisissez une adresse http(s) valide (ex. https://exemple.com).'),
});
const text = z.string().min(1);
const portMessage = invalid('Saisissez un numéro de port compris entre 1 et 65535.');
const port = z
  .string({ error: portMessage })
  .transform(Number)
  .pipe(
    z
      .number({ error: portMessage })
      .int({ error: portMessage })
      .min(1, { error: portMessage })
      .max(65_535, { error: portMessage }),
  );
const flag = z.stringbool({ error: invalid('Valeur attendue : true ou false.') });
const secret = z.string().min(32, { error: invalid('Le secret doit contenir au moins 32 caractères.') });

const envSchema = z
  .object({
    NODE_ENV: z.enum(NODE_ENVS, { error: invalid('Valeur attendue : development, test ou production.') }),
    SITE_ENV: z.enum(['production', 'preproduction', 'development'], {
      error: invalid('Valeur attendue : production, preproduction ou development.'),
    }),
    PORT: port,
    API_URL: httpUrl,
    WEB_URL: httpUrl,
    DATABASE_URL: z.url({
      protocol: /^postgres(ql)?$/,
      error: invalid(
        'Saisissez une adresse PostgreSQL valide (postgresql://utilisateur:motdepasse@hôte:5432/base).',
      ),
    }),
    REDIS_URL: z.url({
      protocol: /^rediss?$/,
      error: invalid('Saisissez une adresse Redis valide (redis://hôte:6379).'),
    }),
    S3_ENDPOINT: httpUrl,
    S3_REGION: text,
    S3_ACCESS_KEY: text,
    S3_SECRET_KEY: text,
    S3_BUCKET_PUBLIC: text,
    S3_BUCKET_PRIVATE: text,
    S3_FORCE_PATH_STYLE: flag,
    MEDIA_PUBLIC_URL: httpUrl,
    // Fichiers privés (CV, pièces jointes) : pilote `local` (disque) seulement pour l'instant ; répertoire hors de
    // tout dossier servi, monté en volume sur le serveur (relatif au répertoire de lancement de l'API).
    STORAGE_DRIVER: z.enum(['local'], { error: invalid('Valeur attendue : local.') }),
    STORAGE_DIR: text,
    SMTP_HOST: text,
    SMTP_PORT: port,
    SMTP_SECURE: flag,
    SMTP_USER: text.optional(),
    SMTP_PASSWORD: text.optional(),
    MAIL_FROM: text,
    // Démarrage du worker qui consomme la file `mail` dans ce processus (`off` : l'API ne fait que produire).
    MAIL_WORKER: z.enum(['on', 'off'], { error: invalid('Valeur attendue : on ou off.') }),
    JWT_ACCESS_SECRET: secret,
    JWT_REFRESH_SECRET: secret,
    TOKEN_SIGNING_SECRET: secret,
    COOKIE_DOMAIN: text.optional(),
    REVALIDATE_SECRET: z
      .string()
      .min(16, { error: invalid('Le secret doit contenir au moins 16 caractères.') }),
    TURNSTILE_SECRET_KEY: text,
    // Utilisées seulement par le seed (compte administrateur initial) : facultatives au démarrage de l'API.
    SEED_ADMIN_EMAIL: z.email({ error: invalid('Saisissez une adresse e-mail valide.') }).optional(),
    SEED_ADMIN_NAME: text.optional(),
    SEED_ADMIN_PASSWORD: z
      .string()
      .min(12, { error: invalid('Le mot de passe doit contenir au moins 12 caractères.') })
      .optional(),
    // Mot de passe commun des comptes de démonstration (développement et tests seulement, interdit en production).
    SEED_DEMO_PASSWORD: z
      .string()
      .min(12, { error: invalid('Le mot de passe doit contenir au moins 12 caractères.') })
      .optional(),
    SENTRY_DSN: z.url({ error: invalid('Saisissez une adresse Sentry (DSN) valide.') }).optional(),
    LOG_LEVEL: z.enum(LOG_LEVELS, { error: invalid(`Valeur attendue : ${LOG_LEVELS.join(', ')}.`) }),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;
    const addIssue = (variable: string, message: string): void => {
      ctx.addIssue({ code: 'custom', path: [variable], message });
    };

    for (const variable of ['API_URL', 'WEB_URL'] as const) {
      if (!env[variable].startsWith('https://'))
        addIssue(variable, 'Une adresse https est obligatoire en production.');
    }
    const secrets = [
      'JWT_ACCESS_SECRET',
      'JWT_REFRESH_SECRET',
      'TOKEN_SIGNING_SECRET',
      'REVALIDATE_SECRET',
      'S3_SECRET_KEY',
    ] as const;
    for (const variable of secrets) {
      if (env[variable].includes('change-me')) {
        addIssue(variable, "Remplacez la valeur d'exemple par un secret long et aléatoire.");
      }
    }
    if (env.SEED_ADMIN_PASSWORD?.includes('change-me')) {
      addIssue('SEED_ADMIN_PASSWORD', "Remplacez le mot de passe d'exemple.");
    }
    if (env.SEED_DEMO_PASSWORD !== undefined) {
      addIssue(
        'SEED_DEMO_PASSWORD',
        'Les comptes de démonstration sont interdits en production : retirez cette variable.',
      );
    }
    if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
      addIssue(
        'JWT_REFRESH_SECRET',
        "Les secrets des jetons d'accès et de rafraîchissement doivent être différents.",
      );
    }
    if (env.TURNSTILE_SECRET_KEY === TURNSTILE_TEST_SECRET) {
      addIssue('TURNSTILE_SECRET_KEY', "La clé d'essai Turnstile est interdite en production.");
    }
  });

export type Env = z.output<typeof envSchema>;

export interface EnvIssue {
  variable: string;
  message: string;
}

/** Configuration invalide : l'API refuse de démarrer. */
export class EnvValidationError extends Error {
  constructor(readonly issues: EnvIssue[]) {
    super(
      [
        "Configuration invalide : l'API ne peut pas démarrer.",
        ...issues.map((issue) => `  - ${issue.variable} : ${issue.message}`),
        "Vérifiez le fichier .env ou les variables d'environnement (modèle : .env.example).",
      ].join('\n'),
    );
    this.name = 'EnvValidationError';
  }
}

const envErrorMap: z.core.$ZodErrorMap = (issue) => {
  if (issue.input === undefined) return 'Variable obligatoire manquante.';
  return describeIssue(issue as unknown as z.core.$ZodIssue).message;
};

/**
 * Valide les variables d'environnement. Les chaînes vides valent « non renseigné ».
 * En développement et en test, les valeurs absentes prennent celles de `.env.example` ;
 * en production, toutes les variables sont obligatoires (sauf celles marquées facultatives).
 */
export function parseEnv(raw: Record<string, string | undefined>): Env {
  const provided = Object.fromEntries(
    Object.entries(raw).filter(
      (entry): entry is [string, string] => entry[1] !== undefined && entry[1] !== '',
    ),
  );
  const nodeEnv = provided['NODE_ENV'] ?? 'development';
  const defaults =
    nodeEnv === 'production'
      ? COMMON_DEFAULTS
      : { ...COMMON_DEFAULTS, ...(nodeEnv === 'test' ? TEST_DEFAULTS : LOCAL_DEFAULTS) };

  const result = envSchema.safeParse({ ...defaults, ...provided, NODE_ENV: nodeEnv }, { error: envErrorMap });
  if (!result.success) {
    throw new EnvValidationError(
      result.error.issues.map((issue) => ({ variable: formatIssuePath(issue.path), message: issue.message })),
    );
  }
  return result.data;
}
