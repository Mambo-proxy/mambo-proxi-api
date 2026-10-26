import { Logger } from '@nestjs/common';
import { Redis } from 'ioredis';

/**
 * Connexion ioredis partagée par les files BullMQ (BullMQ 6 n'embarque plus de client : on lui passe celle-ci).
 *
 * - `maxRetriesPerRequest: null` : exigé par BullMQ pour les workers (les commandes bloquantes ne doivent pas
 *   échouer après quelques reconnexions) ;
 * - `lazyConnect` : rien n'est ouvert tant qu'aucune file n'est utilisée. L'API démarre sans Redis (état
 *   « dégradé » de `GET /v1/health`) et les tests qui n'envoient pas d'e-mail n'ouvrent aucune connexion ;
 * - reconnexion progressive plafonnée à 10 s ; les erreurs sont journalisées une seule fois par coupure.
 */
export function createRedisConnection(url: string, logger = new Logger('Redis')): Redis {
  const client = new Redis(url, {
    maxRetriesPerRequest: null,
    lazyConnect: true,
    connectionName: 'mambo-proxi-api',
    retryStrategy: (times) => Math.min(times * 500, 10_000),
  });

  let reported = false;
  client.on('error', (error: Error) => {
    if (reported) return;
    reported = true;
    // Le message d'ioredis ne contient ni mot de passe ni donnée personnelle (hôte et port seulement).
    logger.warn(`Redis injoignable : ${error.message}`);
  });
  client.on('ready', () => {
    if (reported) logger.log('Connexion à Redis rétablie.');
    reported = false;
  });
  return client;
}

/** Ferme proprement la connexion : `QUIT` si elle est ouverte, sinon simple abandon des reconnexions. */
export async function closeRedisConnection(client: Redis): Promise<void> {
  if (client.status === 'end') return;
  if (client.status === 'ready') {
    try {
      await client.quit();
      return;
    } catch {
      // Connexion perdue entre-temps : on coupe sans attendre.
    }
  }
  client.disconnect();
}
