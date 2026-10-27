import { Global, Module } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service.js';
import { FilesController } from './files.controller.js';
import { LocalDiskStorageDriver } from './local-disk.driver.js';
import { StorageService } from './storage.service.js';
import { STORAGE_DRIVER, VIRUS_SCANNER, type StorageDriver } from './storage.types.js';
import { DisabledVirusScanner } from './virus-scanner.js';

/**
 * Stockage des fichiers privés (CV, pièces jointes des demandes) : pilote choisi par `STORAGE_DRIVER` (`local` :
 * disque, répertoire `STORAGE_DIR` ; un pilote S3 pourra s'ajouter derrière la même interface `StorageDriver`),
 * analyse antivirus (point d'accroche ClamAV, désactivé), liens signés et route de téléchargement `/v1/files/{token}`.
 * Global : les demandes, contacts et candidatures l'utilisent sans l'importer.
 */
@Global()
@Module({
  controllers: [FilesController],
  providers: [
    {
      provide: STORAGE_DRIVER,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService): StorageDriver =>
        new LocalDiskStorageDriver(config.get('STORAGE_DIR')),
    },
    { provide: VIRUS_SCANNER, useClass: DisabledVirusScanner },
    StorageService,
  ],
  exports: [StorageService],
})
export class StorageModule {}
