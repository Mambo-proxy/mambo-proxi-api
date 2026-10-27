import {
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
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
import type { AdminContact } from './admin-contact.mapper.js';
import { AdminContactsService, type ContactActor, type ContactsPage } from './admin-contacts.service.js';
import {
  exportContactsQuerySchema,
  listContactsQuerySchema,
  type ContactFilters,
  type ListContactsQuery,
} from './contact.schemas.js';

function actorOf(auth: AuthContext, request: Request): ContactActor {
  return { auth, ip: request.ip ?? null };
}

/** Back-office — contacts et inscrits (tag « Admin — Contacts » du contrat). */
@ApiTags('Admin — Contacts')
@Controller('admin/contacts')
export class AdminContactsController {
  constructor(@Inject(AdminContactsService) private readonly contacts: AdminContactsService) {}

  @Get()
  @RequirePermissions('contacts:read')
  @ApiOperation({ operationId: 'adminListContacts', summary: 'Contacts et inscrits' })
  list(
    @Query(new ZodValidationPipe(listContactsQuerySchema)) query: ListContactsQuery,
  ): Promise<ContactsPage> {
    return this.contacts.list(query, new Date());
  }

  // Déclarée avant `:id` : `export.csv` n'est pas un identifiant.
  @Get('export.csv')
  @RequirePermissions('contacts:export')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ operationId: 'adminExportContacts', summary: 'Export CSV des contacts' })
  async exportCsv(
    @Query(new ZodValidationPipe(exportContactsQuerySchema)) query: ContactFilters,
    @CurrentAuth() auth: AuthContext,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<string> {
    const file = await this.contacts.exportCsv(query, actorOf(auth, request), new Date());
    response.setHeader('Content-Type', CSV_CONTENT_TYPE);
    response.setHeader('Content-Disposition', attachmentDisposition(file.fileName));
    return file.body;
  }

  @Get(':id')
  @RequirePermissions('contacts:read')
  @ApiOperation({ operationId: 'adminGetContact', summary: 'Fiche contact (demandes, abonnement)' })
  detail(@Param('id') id: string): Promise<AdminContact> {
    return this.contacts.detail(id, new Date());
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('contacts:write')
  @ApiOperation({
    operationId: 'adminEraseContact',
    summary: "Droit à l'effacement (anonymise le contact et ses demandes)",
  })
  async erase(
    @Param('id') id: string,
    @CurrentAuth() auth: AuthContext,
    @Req() request: Request,
  ): Promise<void> {
    await this.contacts.erase(id, actorOf(auth, request), new Date());
  }

  @Get(':id/export')
  @RequirePermissions('contacts:export')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    operationId: 'adminExportContactData',
    summary: "Export RGPD de toutes les données d'un contact (JSON)",
  })
  async exportData(
    @Param('id') id: string,
    @CurrentAuth() auth: AuthContext,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Record<string, unknown>> {
    const data = await this.contacts.exportData(id, actorOf(auth, request), new Date());
    response.setHeader('Content-Disposition', attachmentDisposition(`donnees-${id}.json`));
    return data;
  }
}
