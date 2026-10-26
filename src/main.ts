import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import { APP_VERSION } from './common/app-version.js';
import { AppConfigService } from './config/app-config.service.js';

/** Documentation générée depuis le code, hors production. Le contrat de référence reste contracts/openapi.yaml. */
function setupSwagger(app: NestExpressApplication): void {
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('API MAMBO Proxi')
      .setDescription('Document généré depuis le code. Le contrat de référence est contracts/openapi.yaml.')
      .setVersion(APP_VERSION)
      .addCookieAuth('mp_at')
      .build(),
  );
  SwaggerModule.setup('docs', app, document, { jsonDocumentUrl: 'docs/openapi.json' });
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    // Une configuration invalide remonte ici au lieu d'interrompre brutalement le processus.
    abortOnError: false,
  });
  app.useLogger(app.get(Logger));
  configureApp(app);

  const config = app.get(AppConfigService);
  if (!config.isProduction) setupSwagger(app);

  await app.listen(config.get('PORT'));
}

try {
  await bootstrap();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
