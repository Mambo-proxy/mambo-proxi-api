import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { ProblemFilter } from './common/problem/problem.filter.js';
import { AppThrottlerGuard, DEFAULT_THROTTLE } from './common/throttling/app-throttler.guard.js';
import { AppConfigModule } from './config/app-config.module.js';
import { AppConfigService } from './config/app-config.service.js';
import { HealthModule } from './health/health.module.js';
import { buildLoggerParams } from './logging/logger.config.js';
import { CatalogModule } from './modules/catalog/catalog.module.js';
import { FormsModule } from './modules/forms/forms.module.js';
import { MailModule } from './modules/mail/mail.module.js';
import { NavigationModule } from './modules/navigation/navigation.module.js';
import { PagesModule } from './modules/pages/pages.module.js';
import { SettingsModule } from './modules/settings/settings.module.js';
import { SitemapModule } from './modules/sitemap/sitemap.module.js';
import { ZonesModule } from './modules/zones/zones.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

@Module({
  imports: [
    AppConfigModule,
    LoggerModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => buildLoggerParams(config),
    }),
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', ...DEFAULT_THROTTLE }],
      setHeaders: true,
    }),
    PrismaModule,
    HealthModule,
    SettingsModule,
    NavigationModule,
    PagesModule,
    ZonesModule,
    SitemapModule,
    CatalogModule,
    MailModule,
    FormsModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: ProblemFilter },
    { provide: APP_GUARD, useClass: AppThrottlerGuard },
  ],
})
export class AppModule {}
