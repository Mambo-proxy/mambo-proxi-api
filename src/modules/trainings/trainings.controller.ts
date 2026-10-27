import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { PublicCache } from '../../common/http-cache/http-cache.js';
import type { Page } from '../../common/pagination/pagination.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { auditActor } from '../auth/audit-actor.js';
import { CurrentAuth, Public, RequirePermissions } from '../auth/auth.decorators.js';
import type { AuthContext } from '../auth/auth.types.js';
import { reorderSchema, type ReorderInput } from '../catalog/admin-catalog.schemas.js';
import type { AdminTraining, Training } from './training.mapper.js';
import {
  listTrainingRequestsQuerySchema,
  listTrainingsQuerySchema,
  trainingInputSchema,
  trainingPatchSchema,
  type ListTrainingRequestsQuery,
  type ListTrainingsQuery,
  type TrainingInput,
  type TrainingPatch,
} from './training.schemas.js';
import { TrainingsService, type AdminTrainingRequest } from './trainings.service.js';

/** Catalogue des formations du site (tag « Contenus » du contrat). */
@ApiTags('Contenus')
@Public()
@Controller('trainings')
export class TrainingsController {
  constructor(@Inject(TrainingsService) private readonly trainings: TrainingsService) {}

  @Get()
  @PublicCache()
  @ApiOperation({ operationId: 'listTrainings', summary: 'Catalogue des formations' })
  list(
    @Query(new ZodValidationPipe(listTrainingsQuerySchema)) query: ListTrainingsQuery,
  ): Promise<Training[]> {
    return this.trainings.listPublic(query);
  }
}

/** Back-office — catalogue des formations (tag « Admin — Formations » du contrat). */
@ApiTags('Admin — Formations')
@Controller('admin/trainings')
export class AdminTrainingsController {
  constructor(@Inject(TrainingsService) private readonly trainings: TrainingsService) {}

  @Get()
  @RequirePermissions('content:read')
  @ApiOperation({ operationId: 'adminListTrainings', summary: 'Catalogue des formations' })
  list(): Promise<AdminTraining[]> {
    return this.trainings.list();
  }

  @Post()
  @RequirePermissions('content:write')
  @ApiOperation({ operationId: 'adminCreateTraining', summary: 'Créer une formation' })
  create(
    @Body(new ZodValidationPipe(trainingInputSchema)) body: TrainingInput,
    @CurrentAuth() auth: AuthContext,
    @Req() request: Request,
  ): Promise<AdminTraining> {
    return this.trainings.create(body, auditActor(auth, request));
  }

  // Déclarée avant `:id` : `reorder` n'est pas un identifiant.
  @Patch('reorder')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('content:write')
  @ApiOperation({ operationId: 'adminReorderTrainings', summary: 'Ordre du catalogue' })
  async reorder(
    @Body(new ZodValidationPipe(reorderSchema)) body: ReorderInput,
    @CurrentAuth() auth: AuthContext,
    @Req() request: Request,
  ): Promise<void> {
    await this.trainings.reorder(body, auditActor(auth, request));
  }

  @Patch(':id')
  @RequirePermissions('content:write')
  @ApiOperation({ operationId: 'adminUpdateTraining', summary: 'Modifier une formation' })
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(trainingPatchSchema)) body: TrainingPatch,
    @CurrentAuth() auth: AuthContext,
    @Req() request: Request,
  ): Promise<AdminTraining> {
    return this.trainings.update(id, body, auditActor(auth, request));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('content:write')
  @ApiOperation({ operationId: 'adminDeleteTraining', summary: 'Supprimer une formation' })
  async remove(
    @Param('id') id: string,
    @CurrentAuth() auth: AuthContext,
    @Req() request: Request,
  ): Promise<void> {
    await this.trainings.remove(id, auditActor(auth, request));
  }
}

/** Back-office — demandes de formation (tag « Admin — Formations » du contrat). */
@ApiTags('Admin — Formations')
@Controller('admin/training-requests')
export class AdminTrainingRequestsController {
  constructor(@Inject(TrainingsService) private readonly trainings: TrainingsService) {}

  @Get()
  @RequirePermissions('requests:read')
  @ApiOperation({ operationId: 'adminListTrainingRequests', summary: 'Demandes de formation' })
  list(
    @Query(new ZodValidationPipe(listTrainingRequestsQuerySchema)) query: ListTrainingRequestsQuery,
  ): Promise<Page<AdminTrainingRequest>> {
    return this.trainings.listRequests(query);
  }
}
