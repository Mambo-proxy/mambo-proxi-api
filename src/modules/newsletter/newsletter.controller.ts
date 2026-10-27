import { Body, Controller, HttpCode, HttpStatus, Inject, Post, Query, Req } from '@nestjs/common';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { PUBLIC_FORM_THROTTLE } from '../../common/throttling/app-throttler.guard.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { Public } from '../auth/auth.decorators.js';
import { resolveLang } from '../forms/forms.mapper.js';
import {
  NewsletterSubscriptionsService,
  type SubscriptionAccepted,
} from './newsletter-subscriptions.service.js';
import {
  confirmInputSchema,
  subscriptionInputSchema,
  unsubscribeBodySchema,
  unsubscribeQuerySchema,
  type ConfirmInput,
  type SubscriptionInput,
  type UnsubscribeBody,
  type UnsubscribeQuery,
} from './newsletter.schemas.js';

/** Liens des e-mails (confirmation, désinscription) : limite plus large que les formulaires, mais bornée. */
const LINK_THROTTLE = { ttl: 60_000, limit: 20 } as const;

/** Newsletter du site (tag « Newsletter » du contrat) : double opt-in et désinscription en un clic. */
@ApiTags('Newsletter')
@Public()
@Controller('newsletter')
export class NewsletterController {
  constructor(
    @Inject(NewsletterSubscriptionsService) private readonly subscriptions: NewsletterSubscriptionsService,
  ) {}

  @Post('subscriptions')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: PUBLIC_FORM_THROTTLE })
  @ApiOperation({ operationId: 'subscribeNewsletter', summary: 'Inscription (double opt-in)' })
  subscribe(
    @Body(new ZodValidationPipe(subscriptionInputSchema)) body: SubscriptionInput,
    @Req() request: Request,
  ): Promise<SubscriptionAccepted> {
    return this.subscriptions.subscribe(
      body,
      { ip: request.ip, lang: resolveLang(undefined, request.get('accept-language')) },
      new Date(),
    );
  }

  @Post('confirm')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: LINK_THROTTLE })
  @ApiOperation({
    operationId: 'confirmNewsletter',
    summary: "Confirmation de l'inscription (lien de l'e-mail)",
  })
  confirm(@Body(new ZodValidationPipe(confirmInputSchema)) body: ConfirmInput): Promise<{ message: string }> {
    return this.subscriptions.confirm(body.token, new Date());
  }

  /** JSON `{ token }` (page du site) ou formulaire `List-Unsubscribe=One-Click` avec le jeton dans `?token=`. */
  @Post('unsubscribe')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: LINK_THROTTLE })
  @ApiConsumes('application/json', 'application/x-www-form-urlencoded')
  @ApiOperation({
    operationId: 'unsubscribeNewsletter',
    summary: 'Désinscription en un clic (jeton signé, compatible `List-Unsubscribe-Post`)',
  })
  unsubscribe(
    @Body(new ZodValidationPipe(unsubscribeBodySchema)) body: UnsubscribeBody,
    @Query(new ZodValidationPipe(unsubscribeQuerySchema)) query: UnsubscribeQuery,
  ): Promise<{ message: string }> {
    return this.subscriptions.unsubscribe(body.token ?? query.token, new Date());
  }
}
