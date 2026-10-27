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
import { AnalyticsModule } from './modules/analytics/analytics.module.js';
import { AppointmentsModule } from './modules/appointments/appointments.module.js';
import { AuthGuard } from './modules/auth/auth.guard.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { CatalogModule } from './modules/catalog/catalog.module.js';
import { ContactsModule } from './modules/contacts/contacts.module.js';
import { DashboardModule } from './modules/dashboard/dashboard.module.js';
import { EventsModule } from './modules/events/events.module.js';
import { FormsModule } from './modules/forms/forms.module.js';
import { JobsModule } from './modules/jobs/jobs.module.js';
import { MagazineModule } from './modules/magazine/magazine.module.js';
import { MailModule } from './modules/mail/mail.module.js';
import { MaintenanceModule } from './modules/maintenance/maintenance.module.js';
import { MediaLibraryModule } from './modules/media/media-library.module.js';
import { NavigationModule } from './modules/navigation/navigation.module.js';
import { NewsletterModule } from './modules/newsletter/newsletter.module.js';
import { PagesModule } from './modules/pages/pages.module.js';
import { PartnersModule } from './modules/partners/partners.module.js';
import { RequestsModule } from './modules/requests/requests.module.js';
import { ReviewsModule } from './modules/reviews/reviews.module.js';
import { SearchModule } from './modules/search/search.module.js';
import { SettingsModule } from './modules/settings/settings.module.js';
import { SitemapModule } from './modules/sitemap/sitemap.module.js';
import { StorageModule } from './modules/storage/storage.module.js';
import { SurveysModule } from './modules/surveys/surveys.module.js';
import { TrainingsModule } from './modules/trainings/trainings.module.js';
import { UsersModule } from './modules/users/users.module.js';
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
    StorageModule,
    MediaLibraryModule,
    FormsModule,
    AuthModule,
    UsersModule,
    RequestsModule,
    ContactsModule,
    AppointmentsModule,
    JobsModule,
    SurveysModule,
    ReviewsModule,
    PartnersModule,
    TrainingsModule,
    EventsModule,
    NewsletterModule,
    MagazineModule,
    DashboardModule,
    AnalyticsModule,
    SearchModule,
    MaintenanceModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: ProblemFilter },
    // Ordre d'exécution : limitation de débit, puis session, CSRF et permissions (routes `@Public()` exceptées).
    { provide: APP_GUARD, useClass: AppThrottlerGuard },
    { provide: APP_GUARD, useExisting: AuthGuard },
  ],
})
export class AppModule {}
