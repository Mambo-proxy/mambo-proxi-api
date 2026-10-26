import { Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { AppConfigService } from '../../config/app-config.service.js';
import { DEFAULT_QUEUE_PREFIX, QUEUE_PREFIX, REDIS_CONNECTION } from './queue.constants.js';
import { closeRedisConnection, createRedisConnection } from './redis-connection.js';

/**
 * Ferme la connexion partagée à l'arrêt de l'application. `onApplicationShutdown` est appelé après tous les
 * `onModuleDestroy` : les files et les workers (qui se ferment dans ces derniers) n'utilisent plus la connexion.
 */
@Injectable()
export class RedisConnectionCloser implements OnApplicationShutdown {
  constructor(@Inject(REDIS_CONNECTION) private readonly connection: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    await closeRedisConnection(this.connection);
  }
}

/** Connexion Redis partagée et réglages communs des files BullMQ. */
@Module({
  providers: [
    {
      provide: REDIS_CONNECTION,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService): Redis => createRedisConnection(config.get('REDIS_URL')),
    },
    { provide: QUEUE_PREFIX, useValue: DEFAULT_QUEUE_PREFIX },
    RedisConnectionCloser,
  ],
  exports: [REDIS_CONNECTION, QUEUE_PREFIX],
})
export class QueueModule {}
