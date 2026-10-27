import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
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
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { auditActor } from '../auth/audit-actor.js';
import { CurrentAuth, RequirePermissions } from '../auth/auth.decorators.js';
import type { AuthContext } from '../auth/auth.types.js';
import type { AdminCategory, AdminService, Completeness } from './admin-catalog.mapper.js';
import {
  categoryInputSchema,
  categoryPatchSchema,
  listAdminServicesQuerySchema,
  reorderSchema,
  serviceInputSchema,
  servicePatchSchema,
  type CategoryInput,
  type CategoryPatch,
  type ListAdminServicesQuery,
  type ReorderInput,
  type ServiceInput,
  type ServicePatch,
} from './admin-catalog.schemas.js';
import { AdminCategoriesService } from './admin-categories.service.js';
import type { PreviewToken } from '../../common/preview/preview-token.js';
import { AdminServicesService, type AdminServicesList } from './admin-services.service.js';

/** Back-office — services (tag « Admin — Services » du contrat). */
@ApiTags('Admin — Services')
@Controller('admin/services')
export class AdminServicesController {
  constructor(@Inject(AdminServicesService) private readonly services: AdminServicesService) {}

  @Get()
  @RequirePermissions('content:read')
  @ApiOperation({ operationId: 'adminListServices', summary: 'Services (toutes rubriques, tous statuts)' })
  list(
    @Query(new ZodValidationPipe(listAdminServicesQuerySchema)) query: ListAdminServicesQuery,
  ): Promise<AdminServicesList> {
    return this.services.list(query, new Date());
  }

  @Post()
  @RequirePermissions('content:write')
  @ApiOperation({ operationId: 'adminCreateService', summary: 'Créer un service (brouillon)' })
  create(
    @Body(new ZodValidationPipe(serviceInputSchema)) body: ServiceInput,
    @CurrentAuth() auth: AuthContext,
    @Req() request: Request,
  ): Promise<AdminService> {
    return this.services.create(body, auditActor(auth, request), new Date());
  }

  // Déclarée avant `:id` : `reorder` n'est pas un identifiant.
  @Patch('reorder')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('content:write')
  @ApiOperation({ operationId: 'adminReorderServices', summary: "Ordre d'affichage dans une rubrique" })
  async reorder(
    @Body(new ZodValidationPipe(reorderSchema)) body: ReorderInput,
    @CurrentAuth() auth: AuthContext,
    @Req() request: Request,
  ): Promise<void> {
    await this.services.reorder(body, auditActor(auth, request));
  }

  @Get(':id')
  @RequirePermissions('content:read')
  @ApiOperation({ operationId: 'adminGetService', summary: 'Service à éditer' })
  detail(@Param('id') id: string): Promise<AdminService> {
    return this.services.detail(id, new Date());
  }

  @Patch(':id')
  @RequirePermissions('content:write')
  @ApiOperation({
    operationId: 'adminUpdateService',
    summary: 'Enregistrer (sauvegarde automatique ou manuelle)',
  })
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(servicePatchSchema)) body: ServicePatch,
    @Headers('if-match') ifMatch: string | undefined,
    @CurrentAuth() auth: AuthContext,
    @Req() request: Request,
  ): Promise<AdminService> {
    return this.services.update(id, body, ifMatch, auditActor(auth, request), new Date());
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('content:write')
  @ApiOperation({ operationId: 'adminDeleteService', summary: 'Supprimer un service (brouillon ou archivé)' })
  async remove(
    @Param('id') id: string,
    @CurrentAuth() auth: AuthContext,
    @Req() request: Request,
  ): Promise<void> {
    await this.services.remove(id, auditActor(auth, request));
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('content:write')
  @ApiOperation({ operationId: 'adminPublishService', summary: 'Publier' })
  publish(
    @Param('id') id: string,
    @CurrentAuth() auth: AuthContext,
    @Req() request: Request,
  ): Promise<AdminService> {
    return this.services.publish(id, auditActor(auth, request), new Date());
  }

  @Post(':id/unpublish')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('content:write')
  @ApiOperation({ operationId: 'adminUnpublishService', summary: 'Dépublier (repasse en brouillon)' })
  unpublish(
    @Param('id') id: string,
    @CurrentAuth() auth: AuthContext,
    @Req() request: Request,
  ): Promise<AdminService> {
    return this.services.unpublish(id, auditActor(auth, request), new Date());
  }

  @Post(':id/duplicate')
  @RequirePermissions('content:write')
  @ApiOperation({ operationId: 'adminDuplicateService', summary: 'Dupliquer (copie en brouillon)' })
  duplicate(
    @Param('id') id: string,
    @CurrentAuth() auth: AuthContext,
    @Req() request: Request,
  ): Promise<AdminService> {
    return this.services.duplicate(id, auditActor(auth, request), new Date());
  }

  @Get(':id/preview-token')
  @RequirePermissions('content:read')
  @ApiOperation({
    operationId: 'adminGetServicePreviewToken',
    summary: 'Jeton de prévisualisation de la page complète (30 min)',
  })
  previewToken(@Param('id') id: string): Promise<PreviewToken> {
    return this.services.previewToken(id, new Date());
  }

  @Get(':id/completeness')
  @RequirePermissions('content:read')
  @ApiOperation({
    operationId: 'adminGetServiceCompleteness',
    summary: 'Indicateur de complétude (7 critères)',
  })
  completeness(@Param('id') id: string): Promise<Completeness> {
    return this.services.completeness(id);
  }
}

/** Back-office — rubriques (tag « Admin — Services » du contrat). */
@ApiTags('Admin — Services')
@Controller('admin/categories')
export class AdminCategoriesController {
  constructor(@Inject(AdminCategoriesService) private readonly categories: AdminCategoriesService) {}

  @Get()
  @RequirePermissions('content:read')
  @ApiOperation({ operationId: 'adminListCategories', summary: 'Rubriques (tous statuts)' })
  list(): Promise<AdminCategory[]> {
    return this.categories.list();
  }

  @Post()
  @RequirePermissions('content:write')
  @ApiOperation({ operationId: 'adminCreateCategory', summary: 'Créer une rubrique' })
  create(
    @Body(new ZodValidationPipe(categoryInputSchema)) body: CategoryInput,
    @CurrentAuth() auth: AuthContext,
    @Req() request: Request,
  ): Promise<AdminCategory> {
    return this.categories.create(body, auditActor(auth, request));
  }

  @Patch('reorder')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('content:write')
  @ApiOperation({ operationId: 'adminReorderCategories', summary: 'Ordre des rubriques' })
  async reorder(
    @Body(new ZodValidationPipe(reorderSchema)) body: ReorderInput,
    @CurrentAuth() auth: AuthContext,
    @Req() request: Request,
  ): Promise<void> {
    await this.categories.reorder(body, auditActor(auth, request));
  }

  @Get(':id')
  @RequirePermissions('content:read')
  @ApiOperation({ operationId: 'adminGetCategory', summary: 'Rubrique à éditer' })
  detail(@Param('id') id: string): Promise<AdminCategory> {
    return this.categories.detail(id);
  }

  @Patch(':id')
  @RequirePermissions('content:write')
  @ApiOperation({ operationId: 'adminUpdateCategory', summary: 'Modifier une rubrique' })
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(categoryPatchSchema)) body: CategoryPatch,
    @CurrentAuth() auth: AuthContext,
    @Req() request: Request,
  ): Promise<AdminCategory> {
    return this.categories.update(id, body, auditActor(auth, request));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('content:write')
  @ApiOperation({ operationId: 'adminDeleteCategory', summary: 'Supprimer une rubrique vide' })
  async remove(
    @Param('id') id: string,
    @CurrentAuth() auth: AuthContext,
    @Req() request: Request,
  ): Promise<void> {
    await this.categories.remove(id, auditActor(auth, request));
  }
}
