import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PublicCache } from '../../common/http-cache/http-cache.js';
import { langQuerySchema, type LangQuery } from '../../common/i18n/lang.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import type { Navigation } from './navigation.mapper.js';
import { NavigationService, type RedirectEntry } from './navigation.service.js';

@ApiTags('Site')
@Controller('site')
export class NavigationController {
  constructor(@Inject(NavigationService) private readonly navigation: NavigationService) {}

  /** `GET /v1/site/navigation` : menu principal, méga-menu, sous-menus et pied de page. */
  @Get('navigation')
  @ApiOperation({
    operationId: 'getNavigation',
    summary: 'Menu principal, méga-menu, sous-menus et pied de page',
  })
  @PublicCache()
  getNavigation(@Query(new ZodValidationPipe(langQuerySchema)) query: LangQuery): Promise<Navigation> {
    return this.navigation.getNavigation(query.lang);
  }

  /** `GET /v1/site/redirects` : redirections 301 (changements de slug de services publiés). */
  @Get('redirects')
  @ApiOperation({
    operationId: 'listRedirects',
    summary: 'Redirections 301 (changements de slug de services publiés)',
  })
  @PublicCache()
  listRedirects(): Promise<RedirectEntry[]> {
    return this.navigation.listRedirects();
  }
}
