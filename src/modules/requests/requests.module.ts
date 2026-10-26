import { Module } from '@nestjs/common';
import { RequestsService } from './requests.service.js';

/** Demandes : création à réception d'un formulaire public (les opérations du back-office viendront ensuite). */
@Module({
  providers: [RequestsService],
  exports: [RequestsService],
})
export class RequestsModule {}
