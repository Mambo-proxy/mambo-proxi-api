import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from './env.schema.js';

/** Espace de noms de la configuration validée dans `@nestjs/config`. */
export const ENV_NAMESPACE = 'env';

/** Accès typé à la configuration validée au démarrage. */
@Injectable()
export class AppConfigService {
  private readonly env: Env;

  constructor(@Inject(ConfigService) configService: ConfigService) {
    this.env = configService.getOrThrow<Env>(ENV_NAMESPACE);
  }

  get<K extends keyof Env>(key: K): Env[K] {
    return this.env[key];
  }

  get isProduction(): boolean {
    return this.env.NODE_ENV === 'production';
  }

  get isDevelopment(): boolean {
    return this.env.NODE_ENV === 'development';
  }

  get isTest(): boolean {
    return this.env.NODE_ENV === 'test';
  }

  /** Origine exacte du site (CORS) : schéma, hôte et port, sans barre finale. */
  get webOrigin(): string {
    return new URL(this.env.WEB_URL).origin;
  }
}
