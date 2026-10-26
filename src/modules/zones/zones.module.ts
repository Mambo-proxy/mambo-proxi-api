import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module.js';
import { ZonesController } from './zones.controller.js';
import { ZonesService } from './zones.service.js';

@Module({
  imports: [SettingsModule],
  controllers: [ZonesController],
  providers: [ZonesService],
})
export class ZonesModule {}
