import { Controller, Get } from '@nestjs/common';

import { NoRateLimit } from './common/decorators/rate-limit.decorator.js';
import { Public } from './common/decorators/public.decorator.js';
import { AppService } from './app.service.js';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  /** Health check sederhana untuk load balancer / docker healthcheck. */
  @Public()
  @NoRateLimit()
  @Get('health')
  health() {
    return this.appService.health();
  }
}
