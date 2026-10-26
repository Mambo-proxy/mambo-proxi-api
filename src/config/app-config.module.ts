import { Global, Module } from '@nestjs/common';
import { ConfigModule, registerAs } from '@nestjs/config';
import { AppConfigService, ENV_NAMESPACE } from './app-config.service.js';
import { parseEnv } from './env.schema.js';

/** Validation au démarrage : une configuration invalide lève `EnvValidationError` et l'API ne démarre pas. */
const envConfig = registerAs(ENV_NAMESPACE, () => parseEnv(process.env));

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      cache: true,
      load: [envConfig],
      // Les tests ne dépendent pas d'un éventuel fichier .env local.
      ignoreEnvFile: process.env['NODE_ENV'] === 'test',
    }),
  ],
  providers: [AppConfigService],
  exports: [AppConfigService],
})
export class AppConfigModule {}
