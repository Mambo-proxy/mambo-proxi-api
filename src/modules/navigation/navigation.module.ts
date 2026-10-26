import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module.js';
import { MediaModule } from '../media/media.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { NavigationController } from './navigation.controller.js';
import { NavigationService } from './navigation.service.js';

@Module({
  imports: [SettingsModule, CatalogModule, MediaModule],
  controllers: [NavigationController],
  providers: [NavigationService],
})
export class NavigationModule {}
