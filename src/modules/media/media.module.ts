import { Module } from '@nestjs/common';
import { MediaService } from './media.service.js';

/** Images publiques partagées par les modules de contenu (rubriques, services, navigation, pages). */
@Module({
  providers: [MediaService],
  exports: [MediaService],
})
export class MediaModule {}
