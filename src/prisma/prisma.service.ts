import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { AppConfigService } from '../config/app-config.service.js';
import { PrismaClient } from '../generated/prisma/client.js';

/**
 * Client Prisma partagé (adaptateur `pg`). La connexion est ouverte à la première requête :
 * l'API démarre même si la base est momentanément indisponible, ce que signale `GET /v1/health`.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(@Inject(AppConfigService) config: AppConfigService) {
    const connectionString = config.get('DATABASE_URL');
    const schema = new URL(connectionString).searchParams.get('schema') ?? undefined;
    super({
      adapter: new PrismaPg(
        { connectionString, connectionTimeoutMillis: 5_000 },
        schema ? { schema } : undefined,
      ),
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
