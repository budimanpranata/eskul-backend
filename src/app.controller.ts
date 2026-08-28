import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service.js';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  /** Health check sederhana untuk load balancer / docker healthcheck. */
  @Get('health')
  health() {
    return this.appService.health();
  }
}
