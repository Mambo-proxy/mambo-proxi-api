import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module.js';
import { AdminZonesController } from './admin-zones.controller.js';
import { AdminZonesService } from './admin-zones.service.js';
import { ZonesController } from './zones.controller.js';
import { ZonesService } from './zones.service.js';

/** Zones d'intervention : lecture publique (`/v1/zones`) et back-office (`/v1/admin/zones*`). */
@Module({
  imports: [SettingsModule],
  controllers: [ZonesController, AdminZonesController],
  providers: [ZonesService, AdminZonesService],
})
export class ZonesModule {}
