import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { HEALTH_CHECK_TIMEOUT_MS, withTimeout, type DependencyState } from './health.types.js';

@Injectable()
export class DatabaseHealthIndicator {
  private readonly logger = new Logger(DatabaseHealthIndicator.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async check(): Promise<DependencyState> {
    try {
      await withTimeout(this.prisma.$queryRaw`SELECT 1`, HEALTH_CHECK_TIMEOUT_MS);
      return 'up';
    } catch (error) {
      this.logger.warn(
        `Base de données injoignable : ${error instanceof Error ? error.message : 'erreur inconnue'}`,
      );
      return 'down';
    }
  }
}
