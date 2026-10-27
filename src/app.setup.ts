import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { ETAG_MODE } from './common/http-cache/http-cache.js';
import { mapBodyParserErrors } from './common/problem/body-parser-errors.js';
import { AppConfigService } from './config/app-config.service.js';
import { REQUEST_ID_HEADER } from './logging/request-id.js';

export const GLOBAL_PREFIX = 'v1';

/**
 * Réglages HTTP communs à l'application et aux tests e2e : préfixe `/v1`, en-têtes de sécurité,
 * analyse du JSON, cookies, CORS limité au site, arrêt propre. Le filtre d'erreurs et la limitation de débit sont
 * déclarés dans `AppModule` (APP_FILTER, APP_GUARD).
 */
export function configureApp(app: NestExpressApplication): void {
  const config = app.get(AppConfigService);

  app.setGlobalPrefix(GLOBAL_PREFIX);
  // ETag de chaque réponse et 304 sur `If-None-Match` (lectures publiques : voir `common/http-cache`).
  app.set('etag', ETAG_MODE);
  // Derrière le mandataire inverse (Caddy) en production : adresse IP réelle pour la limitation de débit.
  if (config.isProduction) app.set('trust proxy', 1);

  app.use(
    helmet({
      // L'API ne sert que du JSON ; en développement, la documentation /docs (Swagger UI) a besoin de scripts.
      contentSecurityPolicy: config.isProduction
        ? { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } }
        : false,
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );
  // Analyseur JSON déclaré ici (NestJS ne le réenregistre pas) pour traduire aussitôt ses erreurs.
  app.useBodyParser('json', { limit: '100kb' });
  // Lots de la mesure d'audience envoyés par `navigator.sendBeacon` (JSON en `text/plain`, 16 Kio au plus) : la
  // seule route qui lit un corps texte (`POST /v1/analytics/events`) ; ailleurs, un corps texte échoue à la validation.
  app.useBodyParser('text', { type: 'text/plain', limit: '16kb' });
  app.use(mapBodyParserErrors);
  app.use(cookieParser());
  app.enableCors({
    origin: [config.webOrigin],
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Accept', 'Accept-Language', 'X-CSRF-Token', REQUEST_ID_HEADER],
    exposedHeaders: [
      REQUEST_ID_HEADER,
      'Retry-After',
      'RateLimit-Limit',
      'RateLimit-Remaining',
      'RateLimit-Reset',
    ],
    maxAge: 600,
  });
  app.enableShutdownHooks();
}
