import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Params } from 'nestjs-pino';
import type { AppConfigService } from '../config/app-config.service.js';
import { resolveRequestId } from './request-id.js';

/**
 * Chemins masqués par sécurité si un objet de ce type est journalisé par erreur
 * (les sérialiseurs ci-dessous ne gardent déjà ni en-têtes ni corps).
 */
export const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  'req.body',
  'req.query',
  'body',
  'email',
  'phone',
  'password',
  'token',
  '*.email',
  '*.phone',
  '*.password',
  '*.passwordHash',
  '*.token',
  '*.otp',
];

/** Chemin sans la chaîne de requête (qui peut contenir une adresse e-mail ou un jeton). */
function withoutQuery(url: unknown): string | undefined {
  return typeof url === 'string' ? url.split('?')[0] : undefined;
}

interface SerializedRequestLike {
  id?: unknown;
  method?: unknown;
  url?: unknown;
}

interface SerializedResponseLike {
  statusCode?: unknown;
}

/** Journaux : JSON en production, lisibles (pino-pretty) en développement, muets en test. Aucune donnée personnelle. */
export function buildLoggerParams(config: AppConfigService): Params {
  return {
    pinoHttp: {
      level: config.get('LOG_LEVEL'),
      genReqId: resolveRequestId,
      redact: { paths: REDACTED_PATHS, censor: '[masqué]' },
      serializers: {
        // Ni en-têtes, ni adresse IP, ni corps, ni paramètres de requête.
        req: (req: SerializedRequestLike) => ({ id: req.id, method: req.method, url: withoutQuery(req.url) }),
        res: (res: SerializedResponseLike) => ({ statusCode: res.statusCode }),
      },
      customLogLevel: (_req: IncomingMessage, res: ServerResponse, error?: Error) => {
        if (error !== undefined || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
      // Les sondes de supervision n'encombrent pas les journaux.
      autoLogging: { ignore: (req: IncomingMessage) => (req.url ?? '').startsWith('/v1/health') },
      transport: config.isDevelopment
        ? {
            target: 'pino-pretty',
            options: { singleLine: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' },
          }
        : undefined,
    },
  };
}
