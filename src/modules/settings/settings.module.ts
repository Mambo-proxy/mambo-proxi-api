import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module.js';
import { AdminSettingsController } from './admin-settings.controller.js';
import { AdminSettingsService } from './admin-settings.service.js';
import { SettingsController } from './settings.controller.js';
import { SettingsService } from './settings.service.js';

/** Paramètres : lecture publique (`/v1/site/settings`) et back-office (`/v1/admin/settings/{group}`, état du système). */
@Module({
  imports: [MediaModule],
  controllers: [SettingsController, AdminSettingsController],
  providers: [SettingsService, AdminSettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
