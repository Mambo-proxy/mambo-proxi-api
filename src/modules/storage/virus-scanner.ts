import { Injectable } from '@nestjs/common';
import type { ScanStatus } from '../../generated/prisma/client.js';
import type { VirusScanner } from './storage.types.js';

/**
 * Analyse antivirus désactivée (aucun service ClamAV déployé) : chaque fichier est marqué `SKIPPED`. Pour l'activer,
 * fournir dans `StorageModule` une implémentation de `VirusScanner` qui transmet le contenu à `clamd` (`INSTREAM`)
 * et renvoie `CLEAN` ou `INFECTED` (un fichier `INFECTED` est refusé avant tout enregistrement).
 */
@Injectable()
export class DisabledVirusScanner implements VirusScanner {
  scan(): Promise<ScanStatus> {
    return Promise.resolve('SKIPPED');
  }
}
