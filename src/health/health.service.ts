import { Inject, Injectable } from '@nestjs/common';
import { APP_VERSION } from '../common/app-version.js';
import { DatabaseHealthIndicator } from './database.health.js';
import type { HealthReport } from './health.types.js';
import { RedisHealthIndicator } from './redis.health.js';

/**
 * État de l'API. `down` si la base est indisponible (aucune fonction ne marche), `degraded` si seule
 * une dépendance secondaire l'est (Redis : envois différés). Le stockage S3 n'est pas encore vérifié :
 * la propriété `checks.storage` est facultative dans le contrat et sera ajoutée avec le module de stockage.
 */
@Injectable()
export class HealthService {
  constructor(
    @Inject(DatabaseHealthIndicator) private readonly database: DatabaseHealthIndicator,
    @Inject(RedisHealthIndicator) private readonly redis: RedisHealthIndicator,
  ) {}

  async check(): Promise<HealthReport> {
    const [database, redis] = await Promise.all([this.database.check(), this.redis.check()]);
    const status = database === 'down' ? 'down' : redis === 'down' ? 'degraded' : 'ok';
    return { status, version: APP_VERSION, checks: { database, redis } };
  }
}
