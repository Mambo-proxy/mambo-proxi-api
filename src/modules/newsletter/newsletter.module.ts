import { Module } from '@nestjs/common';
import { AntiSpamModule } from '../../common/anti-spam/anti-spam.module.js';
import { QueueModule } from '../queue/queue.module.js';
import { AdminCampaignsService } from './admin-campaigns.service.js';
import { AdminCampaignsController, AdminSubscribersController } from './admin-newsletter.controller.js';
import { AdminSubscribersService } from './admin-subscribers.service.js';
import { CampaignDispatchProcessor } from './campaign-dispatch.processor.js';
import { CampaignDispatchService, campaignQueueFactoryProvider } from './campaign-dispatch.service.js';
import { NewsletterSubscriptionsService } from './newsletter-subscriptions.service.js';
import { NewsletterController } from './newsletter.controller.js';

/**
 * Newsletter : double opt-in et désinscription en un clic (`/v1/newsletter/*`), inscrits
 * (`/v1/admin/subscribers*`) et campagnes (`/v1/admin/campaigns*`) du back-office, envoi par lots par la file
 * BullMQ `newsletter-campaigns` (worker démarré avec `MAIL_WORKER=on`). `NewsletterSubscriptionsService` est
 * exporté pour la confirmation demandée par le formulaire d'inscription.
 */
@Module({
  imports: [AntiSpamModule, QueueModule],
  controllers: [NewsletterController, AdminSubscribersController, AdminCampaignsController],
  providers: [
    NewsletterSubscriptionsService,
    AdminSubscribersService,
    AdminCampaignsService,
    campaignQueueFactoryProvider,
    CampaignDispatchService,
    CampaignDispatchProcessor,
  ],
  exports: [NewsletterSubscriptionsService],
})
export class NewsletterModule {}
