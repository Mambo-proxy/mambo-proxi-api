import { Module } from '@nestjs/common';
import { FormsModule } from '../forms/forms.module.js';
import { AdminApplicationsController, AdminJobsController } from './admin-jobs.controller.js';
import { AdminApplicationsService } from './admin-applications.service.js';
import { AdminJobsService } from './admin-jobs.service.js';
import { JobApplicationsController, JobsController } from './jobs.controller.js';
import { JobsService } from './jobs.service.js';

/**
 * Recrutement : offres d'emploi du site (`/v1/jobs*`), candidature publique avec CV (`/v1/job-applications`,
 * enregistrée comme les autres formulaires par `FormsService`), offres et candidatures du back-office
 * (`/v1/admin/jobs*`, `/v1/admin/applications*`). Fichiers : `StorageModule` (global).
 */
@Module({
  imports: [FormsModule],
  controllers: [JobsController, JobApplicationsController, AdminJobsController, AdminApplicationsController],
  providers: [JobsService, AdminJobsService, AdminApplicationsService],
})
export class JobsModule {}
