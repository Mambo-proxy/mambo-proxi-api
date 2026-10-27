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
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { auditActor } from '../auth/audit-actor.js';
import { CurrentAuth, Public, RequirePermissions } from '../auth/auth.decorators.js';
import type { AuthContext } from '../auth/auth.types.js';
import { reorderSchema, type ReorderInput } from '../catalog/admin-catalog.schemas.js';
import type { AdminPartner, Partner } from './partner.mapper.js';
import {
  listAdminPartnersQuerySchema,
  listPartnersQuerySchema,
  partnerInputSchema,
  partnerPatchSchema,
  type ListAdminPartnersQuery,
  type ListPartnersQuery,
  type PartnerInput,
  type PartnerPatch,
} from './partner.schemas.js';
import { PartnersService } from './partners.service.js';

/** Partenaires visibles du site (tag « Contenus » du contrat). */
@ApiTags('Contenus')
@Public()
@Controller('partners')
export class PartnersController {
  constructor(@Inject(PartnersService) private readonly partners: PartnersService) {}

  @Get()
  @PublicCache()
  @ApiOperation({ operationId: 'listPartners', summary: 'Partenaires visibles' })
  list(@Query(new ZodValidationPipe(listPartnersQuerySchema)) query: ListPartnersQuery): Promise<Partner[]> {
    return this.partners.listPublic(query);
  }
}

/** Back-office — logos de partenaires (tag « Admin — Partenaires » du contrat). */
@ApiTags('Admin — Partenaires')
@Controller('admin/partners')
export class AdminPartnersController {
  constructor(@Inject(PartnersService) private readonly partners: PartnersService) {}

  @Get()
  @RequirePermissions('content:read')
  @ApiOperation({ operationId: 'adminListPartners', summary: 'Logos de partenaires' })
  list(
    @Query(new ZodValidationPipe(listAdminPartnersQuerySchema)) query: ListAdminPartnersQuery,
  ): Promise<AdminPartner[]> {
    return this.partners.list(query);
  }

  @Post()
  @RequirePermissions('content:write')
  @ApiOperation({ operationId: 'adminCreatePartner', summary: 'Ajouter un logo' })
  create(
    @Body(new ZodValidationPipe(partnerInputSchema)) body: PartnerInput,
    @CurrentAuth() auth: AuthContext,
    @Req() request: Request,
  ): Promise<AdminPartner> {
    return this.partners.create(body, auditActor(auth, request));
  }

  // Déclarée avant `:id` : `reorder` n'est pas un identifiant.
  @Patch('reorder')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('content:write')
  @ApiOperation({ operationId: 'adminReorderPartners', summary: "Ordre d'affichage" })
  async reorder(
    @Body(new ZodValidationPipe(reorderSchema)) body: ReorderInput,
    @CurrentAuth() auth: AuthContext,
    @Req() request: Request,
  ): Promise<void> {
    await this.partners.reorder(body, auditActor(auth, request));
  }

  @Patch(':id')
  @RequirePermissions('content:write')
  @ApiOperation({ operationId: 'adminUpdatePartner', summary: 'Modifier un partenaire (dont visibilité)' })
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(partnerPatchSchema)) body: PartnerPatch,
    @CurrentAuth() auth: AuthContext,
    @Req() request: Request,
  ): Promise<AdminPartner> {
    return this.partners.update(id, body, auditActor(auth, request));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('content:write')
  @ApiOperation({ operationId: 'adminDeletePartner', summary: 'Supprimer un partenaire' })
  async remove(
    @Param('id') id: string,
    @CurrentAuth() auth: AuthContext,
    @Req() request: Request,
  ): Promise<void> {
    await this.partners.remove(id, auditActor(auth, request));
  }
}
