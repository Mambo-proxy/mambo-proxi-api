import { Module } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service.js';
import { QueueModule } from '../queue/queue.module.js';
import { LocalDiskStorageDriver } from '../storage/local-disk.driver.js';
import { AdminMediaController } from './admin-media.controller.js';
import { AdminMediaService } from './admin-media.service.js';
import { MediaFilesController } from './media-files.controller.js';
import { MediaProcessingProcessor } from './media-processing.processor.js';
import { MediaProcessingService, mediaQueueFactoryProvider } from './media-processing.service.js';
import { MEDIA_STORAGE, assertSeparateDirectories, type MediaStorage } from './media-storage.js';

/**
 * Médiathèque : back-office (`/v1/admin/media*`), fichiers publics (`/v1/media/{folder}/{file}`), variantes en
 * tâche de fond (file BullMQ `media`). Les fichiers sont rangés sur le disque dans `MEDIA_STORAGE_DIR`, répertoire
 * distinct de celui des fichiers privés (`STORAGE_DIR`, vérifié au démarrage). Les modules de contenu n'importent que
 * `MediaModule` (lecture des images, contrôle des références, usages).
 */
@Module({
  imports: [QueueModule],
  controllers: [AdminMediaController, MediaFilesController],
  providers: [
    {
      provide: MEDIA_STORAGE,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService): MediaStorage => {
        const directory = config.get('MEDIA_STORAGE_DIR');
        assertSeparateDirectories(directory, config.get('STORAGE_DIR'));
        return new LocalDiskStorageDriver(directory);
      },
    },
    mediaQueueFactoryProvider,
    MediaProcessingService,
    MediaProcessingProcessor,
    AdminMediaService,
  ],
})
export class MediaLibraryModule {}
