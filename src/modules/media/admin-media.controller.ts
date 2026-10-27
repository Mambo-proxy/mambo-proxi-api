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
  Put,
  Query,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { Page } from '../../common/pagination/pagination.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { auditActor } from '../auth/audit-actor.js';
import { CurrentAuth, RequirePermissions } from '../auth/auth.decorators.js';
import type { AuthContext } from '../auth/auth.types.js';
import type { AdminMedia } from './admin-media.mapper.js';
import {
  listMediaQuerySchema,
  updateMediaInputSchema,
  uploadMediaFieldsSchema,
  type ListMediaQuery,
  type UpdateMediaInput,
  type UploadMediaFields,
} from './admin-media.schemas.js';
import { AdminMediaService } from './admin-media.service.js';
import { MediaUploadInterceptor } from './media-upload.interceptor.js';

/** Back-office — médiathèque (tag « Admin — Médias » du contrat). */
@ApiTags('Admin — Médias')
@Controller('admin/media')
export class AdminMediaController {
  constructor(@Inject(AdminMediaService) private readonly media: AdminMediaService) {}

  @Get()
  @RequirePermissions('content:read')
  @ApiOperation({ operationId: 'adminListMedia', summary: 'Médiathèque' })
  list(@Query(new ZodValidationPipe(listMediaQuerySchema)) query: ListMediaQuery): Promise<Page<AdminMedia>> {
    return this.media.list(query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('media:write')
  @UseInterceptors(MediaUploadInterceptor)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    operationId: 'adminUploadMedia',
    summary: 'Envoyer une image (JPG, PNG, WebP, SVG assaini ; 10 Mo max)',
  })
  upload(
    @UploadedFile() file: unknown,
    @Body(new ZodValidationPipe(uploadMediaFieldsSchema)) fields: UploadMediaFields,
    @CurrentAuth() auth: AuthContext,
    @Req() request: Request,
  ): Promise<AdminMedia> {
    return this.media.upload(file, fields, auditActor(auth, request));
  }

  @Get(':id')
  @RequirePermissions('content:read')
  @ApiOperation({ operationId: 'adminGetMedia', summary: 'Détail d’un média (avec ses usages)' })
  detail(@Param('id') id: string): Promise<AdminMedia> {
    return this.media.detail(id);
  }

  @Patch(':id')
  @RequirePermissions('media:write')
  @ApiOperation({ operationId: 'adminUpdateMedia', summary: 'Texte alternatif et point focal' })
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateMediaInputSchema)) body: UpdateMediaInput,
    @CurrentAuth() auth: AuthContext,
    @Req() request: Request,
  ): Promise<AdminMedia> {
    return this.media.update(id, body, auditActor(auth, request));
  }

  @Put(':id/file')
  @RequirePermissions('media:write')
  @UseInterceptors(MediaUploadInterceptor)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ operationId: 'adminReplaceMediaFile', summary: 'Remplacer le fichier d’un média' })
  replace(
    @Param('id') id: string,
    @UploadedFile() file: unknown,
    @CurrentAuth() auth: AuthContext,
    @Req() request: Request,
  ): Promise<AdminMedia> {
    return this.media.replace(id, file, auditActor(auth, request));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('media:write')
  @ApiOperation({ operationId: 'adminDeleteMedia', summary: 'Supprimer un média non utilisé' })
  async remove(
    @Param('id') id: string,
    @CurrentAuth() auth: AuthContext,
    @Req() request: Request,
  ): Promise<void> {
    await this.media.remove(id, auditActor(auth, request));
  }
}
