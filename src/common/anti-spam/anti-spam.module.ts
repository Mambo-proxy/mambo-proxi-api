import { Module } from '@nestjs/common';
import { AntiSpamService } from './anti-spam.service.js';
import { TurnstileService } from './turnstile.service.js';

/** Anti-spam des formulaires publics : Turnstile, champ piège, délai minimal. */
@Module({
  providers: [TurnstileService, AntiSpamService],
  exports: [AntiSpamService],
})
export class AntiSpamModule {}
