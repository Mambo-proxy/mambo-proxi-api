import { Module } from '@nestjs/common';
import { SurveysModule } from '../surveys/surveys.module.js';
import { AdminRequestsController, MyTasksController } from './admin-requests.controller.js';
import { AdminRequestsService } from './admin-requests.service.js';
import { MyTasksService } from './my-tasks.service.js';
import { RequestsService } from './requests.service.js';

/**
 * Demandes : création à réception d'un formulaire public (`RequestsService`), opérations du back-office
 * (`/v1/admin/requests*`) et « Mes tâches » du tableau de bord (`/v1/admin/me/tasks`).
 */
@Module({
  imports: [SurveysModule],
  controllers: [AdminRequestsController, MyTasksController],
  providers: [RequestsService, AdminRequestsService, MyTasksService],
  exports: [RequestsService, AdminRequestsService],
})
export class RequestsModule {}
