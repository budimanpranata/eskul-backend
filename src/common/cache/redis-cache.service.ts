import { Injectable, Logger } from '@nestjs/common';

import { RedisService } from '../../redis/redis.service.js';

/**
 * Cache read-through sederhana di atas Redis untuk data yang jarang berubah tapi
 * sering dibaca (Fase 4.4). Selalu **fail-safe**: bila Redis bermasalah, jatuh
 * ke `producer()` sehingga cache tidak pernah menjadi titik kegagalan.
 */
@Injectable()
export class RedisCacheService {
  private readonly logger = new Logger(RedisCacheService.name);

  constructor(private readonly redis: RedisService) {}

  async getOrSet<T>(key: string, ttlSeconds: number, producer: () => Promise<T>): Promise<T> {
    try {
      const cached = await this.redis.client.get(key);
      if (cached != null) return JSON.parse(cached) as T;
    } catch (err) {
      this.logger.warn(`cache get gagal (${key}): ${(err as Error).message}`);
    }

    const value = await producer();

    try {
      await this.redis.client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch (err) {
      this.logger.warn(`cache set gagal (${key}): ${(err as Error).message}`);
    }
    return value;
  }

  /** Hapus satu key atau semua key yang cocok pola glob. */
  async bust(keyOrPattern: string): Promise<void> {
    try {
      if (keyOrPattern.includes('*')) {
        const keys = await this.redis.client.keys(keyOrPattern);
        if (keys.length) await this.redis.client.del(...keys);
      } else {
        await this.redis.client.del(keyOrPattern);
      }
    } catch (err) {
      this.logger.warn(`cache bust gagal (${keyOrPattern}): ${(err as Error).message}`);
    }
  }
}
