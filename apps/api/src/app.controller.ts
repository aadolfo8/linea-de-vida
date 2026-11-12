import {
  Controller,
  Optional,
  Get,
  Inject,
  NotFoundException,
  Req,
  Res,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { PrismaService } from './prisma.service';
import { SyncScheduler } from './sync-scheduler';
import { loadRuntimeConfig } from './production';

@Controller('v1')
export class AppController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Optional() @Inject(SyncScheduler) private readonly scheduler?: SyncScheduler,
  ) {}
  @Get('health') health() {
    return { status: 'ok', service: 'linea-de-vida' };
  }
  @Get('readiness') async readiness() {
    try {
      await this.prisma.$queryRawUnsafe('SELECT 1');
    } catch {
      throw new ServiceUnavailableException({
        code: 'NOT_READY',
        message: 'Dependencies are unavailable.',
      });
    }
    // The scheduler runs syncs in this process: a loop that stopped ticking means queued syncs
    // would wait forever, so the container must be reported unhealthy.
    if (this.scheduler?.started && !this.scheduler.isAlive())
      throw new ServiceUnavailableException({
        code: 'SCHEDULER_STALLED',
        message: 'The sync scheduler is not running.',
      });
    return { status: 'ready' };
  }
  @Get('metrics') metrics(@Req() request: Request, @Res() response: Response) {
    const token = loadRuntimeConfig().metricsToken;
    if (!token || request.get('authorization') !== `Bearer ${token}`) throw new NotFoundException();
    response
      .type('text/plain')
      .send(
        [
          '# HELP linea_de_vida_process_uptime_seconds Process uptime in seconds.',
          '# TYPE linea_de_vida_process_uptime_seconds gauge',
          `linea_de_vida_process_uptime_seconds ${Math.floor(process.uptime())}`,
        ].join('\n'),
      );
  }
}
