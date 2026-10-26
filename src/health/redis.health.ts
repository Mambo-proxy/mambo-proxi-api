import { Inject, Injectable, Logger } from '@nestjs/common';
import { connect as connectTcp, type Socket } from 'node:net';
import { connect as connectTls } from 'node:tls';
import { AppConfigService } from '../config/app-config.service.js';
import { HEALTH_CHECK_TIMEOUT_MS, type DependencyState } from './health.types.js';

/** Encode une commande au protocole Redis (RESP). */
function encodeCommand(...args: string[]): string {
  return `*${args.length}\r\n${args.map((arg) => `$${Buffer.byteLength(arg)}\r\n${arg}\r\n`).join('')}`;
}

/**
 * Vérification minimale de Redis (`AUTH` si l'adresse contient un mot de passe, puis `PING`) sur une
 * connexion courte, sans client Redis : la file d'attente BullMQ n'est pas encore en place.
 */
@Injectable()
export class RedisHealthIndicator {
  private readonly logger = new Logger(RedisHealthIndicator.name);

  constructor(@Inject(AppConfigService) private readonly config: AppConfigService) {}

  check(): Promise<DependencyState> {
    const url = new URL(this.config.get('REDIS_URL'));
    const host = url.hostname.replace(/^\[(.*)\]$/, '$1');
    const port = Number(url.port || 6379);
    const secure = url.protocol === 'rediss:';

    const commands: string[] = [];
    if (url.password) {
      const password = decodeURIComponent(url.password);
      commands.push(
        url.username
          ? encodeCommand('AUTH', decodeURIComponent(url.username), password)
          : encodeCommand('AUTH', password),
      );
    }
    commands.push(encodeCommand('PING'));

    return new Promise<DependencyState>((resolve) => {
      let settled = false;
      let received = '';
      const socket: Socket = secure
        ? connectTls({ host, port, servername: host }, () => socket.write(commands.join('')))
        : connectTcp({ host, port }, () => socket.write(commands.join('')));

      const finish = (state: DependencyState, reason?: string): void => {
        if (settled) return;
        settled = true;
        socket.destroy();
        if (reason !== undefined) this.logger.warn(`Redis injoignable : ${reason}`);
        resolve(state);
      };

      socket.setTimeout(HEALTH_CHECK_TIMEOUT_MS, () => finish('down', 'délai dépassé'));
      socket.on('error', (error) => finish('down', error.message));
      socket.on('data', (chunk: Buffer) => {
        received += chunk.toString('utf8');
        if (received.includes('+PONG\r\n')) finish('up');
        else if (/(^|\r\n)-/.test(received)) finish('down', 'réponse en erreur');
      });
      socket.on('close', () => finish('down', 'connexion fermée'));
    });
  }
}
