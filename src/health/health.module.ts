import { Module } from '@nestjs/common';
import { DatabaseHealthIndicator } from './database.health.js';
import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';
import { RedisHealthIndicator } from './redis.health.js';

@Module({
  controllers: [HealthController],
  providers: [HealthService, DatabaseHealthIndicator, RedisHealthIndicator],
})
export class HealthModule {}
