import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  health() {
    return { status: 'ok', service: 'eskul-backend', timestamp: new Date().toISOString() };
  }
}
