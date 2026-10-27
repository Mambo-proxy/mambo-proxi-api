import { Module } from '@nestjs/common';
import {
  AdminTrainingRequestsController,
  AdminTrainingsController,
  TrainingsController,
} from './trainings.controller.js';
import { TrainingsService } from './trainings.service.js';

/**
 * Formations : catalogue du site (`/v1/trainings`), catalogue du back-office (`/v1/admin/trainings*`) et liste des
 * demandes de formation (`/v1/admin/training-requests`). Le formulaire public est `POST /v1/training-requests`
 * (module des formulaires) ; le détail et le statut d'une demande se gèrent dans `/v1/admin/requests/{id}`.
 */
@Module({
  controllers: [TrainingsController, AdminTrainingsController, AdminTrainingRequestsController],
  providers: [TrainingsService],
})
export class TrainingsModule {}
