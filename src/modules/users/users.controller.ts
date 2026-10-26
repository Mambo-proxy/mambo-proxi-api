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
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { CurrentAuth, RequirePermissions } from '../auth/auth.decorators.js';
import type { AuthContext } from '../auth/auth.types.js';
import { roleDefinitions, type RoleDefinition } from '../auth/permissions.js';
import type { AdminUser, TeamPresence } from './users.mapper.js';
import {
  inviteUserInputSchema,
  updateUserInputSchema,
  type InviteUserInput,
  type UpdateUserInput,
} from './users.schemas.js';
import { UsersService, type Actor } from './users.service.js';

function actorOf(auth: AuthContext, request: Request): Actor {
  return { user: auth.user, ip: request.ip ?? null };
}

/** Back-office — utilisateurs, rôles et présence de l'équipe (tag « Admin — Utilisateurs » du contrat). */
@ApiTags('Admin — Utilisateurs')
@Controller('admin')
export class UsersController {
  constructor(@Inject(UsersService) private readonly users: UsersService) {}

  @Get('users')
  @RequirePermissions('users:manage')
  @ApiOperation({ operationId: 'adminListUsers', summary: 'Utilisateurs du back-office' })
  list(): Promise<AdminUser[]> {
    return this.users.list();
  }

  @Get('users/presence')
  @RequirePermissions('team:read')
  @ApiOperation({
    operationId: 'adminGetUsersPresence',
    summary: 'Équipe connectée, dernière activité et dernière connexion',
  })
  presence(): Promise<TeamPresence> {
    return this.users.presence(new Date());
  }

  @Get('roles')
  @RequirePermissions('team:read')
  @ApiOperation({ operationId: 'adminListRoles', summary: 'Rôles du back-office et permissions associées' })
  roles(): RoleDefinition[] {
    return roleDefinitions();
  }

  @Post('users/invite')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('users:manage')
  @ApiOperation({ operationId: 'adminInviteUser', summary: 'Inviter un utilisateur (lien valable 7 jours)' })
  invite(
    @Body(new ZodValidationPipe(inviteUserInputSchema)) body: InviteUserInput,
    @CurrentAuth() auth: AuthContext,
    @Req() request: Request,
  ): Promise<AdminUser> {
    return this.users.invite(body, actorOf(auth, request), new Date());
  }

  @Patch('users/:id')
  @RequirePermissions('users:manage')
  @ApiOperation({ operationId: 'adminUpdateUser', summary: 'Modifier le rôle, désactiver / réactiver' })
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateUserInputSchema)) body: UpdateUserInput,
    @CurrentAuth() auth: AuthContext,
    @Req() request: Request,
  ): Promise<AdminUser> {
    return this.users.update(id, body, actorOf(auth, request), new Date());
  }

  @Delete('users/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('users:manage')
  @ApiOperation({ operationId: 'adminDeleteUser', summary: 'Supprimer un utilisateur' })
  async remove(
    @Param('id') id: string,
    @CurrentAuth() auth: AuthContext,
    @Req() request: Request,
  ): Promise<void> {
    await this.users.remove(id, actorOf(auth, request));
  }

  @Post('users/:id/reset-password')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermissions('users:manage')
  @ApiOperation({
    operationId: 'adminResetUserPassword',
    summary: 'Envoyer un lien de réinitialisation et révoquer les sessions',
  })
  resetPassword(
    @Param('id') id: string,
    @CurrentAuth() auth: AuthContext,
    @Req() request: Request,
  ): Promise<{ message: string }> {
    return this.users.sendReset(id, actorOf(auth, request), new Date());
  }
}
