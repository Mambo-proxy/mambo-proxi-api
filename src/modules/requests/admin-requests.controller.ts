import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { CSV_CONTENT_TYPE, attachmentDisposition } from '../../common/csv/csv.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { CurrentAuth, RequirePermissions } from '../auth/auth.decorators.js';
import type { AuthContext } from '../auth/auth.types.js';
import { AdminRequestsService, type RequestActor, type RequestsPage } from './admin-requests.service.js';
import { MyTasksService, type MyTasks } from './my-tasks.service.js';
import type { RequestDetail, RequestNote } from './request.mapper.js';
import {
  addNoteInputSchema,
  exportRequestsQuerySchema,
  listRequestsQuerySchema,
  updateRequestInputSchema,
  type AddNoteInput,
  type ListRequestsQuery,
  type RequestFilters,
  type UpdateRequestInput,
} from './request.schemas.js';

function actorOf(auth: AuthContext, request: Request): RequestActor {
  return { auth, ip: request.ip ?? null };
}

/** Back-office — demandes (tag « Admin — Demandes » du contrat). */
@ApiTags('Admin — Demandes')
@Controller('admin/requests')
export class AdminRequestsController {
  constructor(@Inject(AdminRequestsService) private readonly requests: AdminRequestsService) {}

  @Get()
  @RequirePermissions('requests:read', 'requests:read-assigned')
  @ApiOperation({ operationId: 'adminListRequests', summary: 'Demandes (devis, contacts, inscriptions…)' })
  list(
    @Query(new ZodValidationPipe(listRequestsQuerySchema)) query: ListRequestsQuery,
    @CurrentAuth() auth: AuthContext,
  ): Promise<RequestsPage> {
    return this.requests.list(query, auth, new Date());
  }

  // Déclarée avant `:id` : `export.csv` n'est pas un identifiant.
  @Get('export.csv')
  @RequirePermissions('requests:export')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ operationId: 'adminExportRequests', summary: 'Export CSV (mêmes filtres que la liste)' })
  async exportCsv(
    @Query(new ZodValidationPipe(exportRequestsQuerySchema)) query: RequestFilters,
    @CurrentAuth() auth: AuthContext,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<string> {
    const file = await this.requests.exportCsv(query, actorOf(auth, request), new Date());
    response.setHeader('Content-Type', CSV_CONTENT_TYPE);
    response.setHeader('Content-Disposition', attachmentDisposition(file.fileName));
    return file.body;
  }

  @Get(':id')
  @RequirePermissions('requests:read', 'requests:read-assigned')
  @ApiOperation({ operationId: 'adminGetRequest', summary: "Détail d'une demande" })
  detail(@Param('id') id: string, @CurrentAuth() auth: AuthContext): Promise<RequestDetail> {
    return this.requests.detail(id, auth, new Date());
  }

  @Patch(':id')
  @RequirePermissions('requests:write', 'requests:write-assigned', 'requests:assign')
  @ApiOperation({ operationId: 'adminUpdateRequest', summary: "Changer le statut ou l'assignation" })
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateRequestInputSchema)) body: UpdateRequestInput,
    @CurrentAuth() auth: AuthContext,
    @Req() request: Request,
  ): Promise<RequestDetail> {
    return this.requests.update(id, body, actorOf(auth, request), new Date());
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('requests:anonymize')
  @ApiOperation({ operationId: 'adminAnonymizeRequest', summary: 'Anonymiser une demande (RGPD)' })
  async anonymize(
    @Param('id') id: string,
    @CurrentAuth() auth: AuthContext,
    @Req() request: Request,
  ): Promise<void> {
    await this.requests.anonymize(id, actorOf(auth, request), new Date());
  }

  @Post(':id/notes')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('requests:write', 'requests:write-assigned')
  @ApiOperation({ operationId: 'adminAddRequestNote', summary: 'Ajouter une note interne' })
  addNote(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(addNoteInputSchema)) body: AddNoteInput,
    @CurrentAuth() auth: AuthContext,
  ): Promise<RequestNote> {
    return this.requests.addNote(id, body.body, auth, new Date());
  }

  @Post(':id/duplicate')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('requests:write')
  @ApiOperation({
    operationId: 'adminDuplicateRequest',
    summary: 'Dupliquer une demande (nouvelle référence, statut « Nouvelle »)',
  })
  duplicate(
    @Param('id') id: string,
    @CurrentAuth() auth: AuthContext,
    @Req() request: Request,
  ): Promise<RequestDetail> {
    return this.requests.duplicate(id, actorOf(auth, request), new Date());
  }
}

/** Back-office — « Mes tâches » du tableau de bord (tag « Admin — Tableau de bord »). */
@ApiTags('Admin — Tableau de bord')
@Controller('admin/me')
export class MyTasksController {
  constructor(@Inject(MyTasksService) private readonly tasks: MyTasksService) {}

  @Get('tasks')
  @RequirePermissions('dashboard:read')
  @ApiOperation({
    operationId: 'adminGetMyTasks',
    summary: 'Mes tâches (demandes et rendez-vous qui me sont assignés)',
  })
  myTasks(@CurrentAuth() auth: AuthContext): Promise<MyTasks> {
    return this.tasks.tasks(auth, new Date());
  }
}
