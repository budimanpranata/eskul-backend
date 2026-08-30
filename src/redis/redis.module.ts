import { Global, Module } from '@nestjs/common';

import { RedisCacheService } from '../common/cache/redis-cache.service.js';
import { RedisService } from './redis.service.js';

@Global()
@Module({
  providers: [RedisService, RedisCacheService],
  exports: [RedisService, RedisCacheService],
})
export class RedisModule {}
