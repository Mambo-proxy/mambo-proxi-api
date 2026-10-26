import { Controller, Get, Header, HttpStatus, Inject, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { HealthService } from './health.service.js';
import type { HealthReport } from './health.types.js';
import { Public } from '../modules/auth/auth.decorators.js';

@ApiTags('Santé')
@Public()
@Controller('health')
export class HealthController {
  constructor(@Inject(HealthService) private readonly health: HealthService) {}

  /** `GET /v1/health` : 200 si tout fonctionne, 503 si une dépendance est indisponible (même corps `Health`). */
  @Get()
  @ApiOperation({ operationId: 'getHealth', summary: "État de l'API et de ses dépendances" })
  @Header('Cache-Control', 'no-store')
  async getHealth(@Res({ passthrough: true }) response: Response): Promise<HealthReport> {
    const report = await this.health.check();
    response.status(report.status === 'ok' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return report;
  }
}
