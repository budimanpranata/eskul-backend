import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RedisCacheService } from './redis-cache.service.js';
import type { RedisService } from '../../redis/redis.service.js';

function mkRedis(over: Partial<Record<string, ReturnType<typeof vi.fn>>> = {}) {
  return {
    client: {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue('OK'),
      del: vi.fn().mockResolvedValue(1),
      keys: vi.fn().mockResolvedValue([]),
      ...over,
    },
  } as unknown as RedisService & { client: Record<string, ReturnType<typeof vi.fn>> };
}

describe('RedisCacheService', () => {
  let redis: ReturnType<typeof mkRedis>;
  let cache: RedisCacheService;

  beforeEach(() => {
    redis = mkRedis();
    cache = new RedisCacheService(redis);
  });

  it('cache MISS → panggil producer, tulis ke Redis dgn TTL', async () => {
    const producer = vi.fn().mockResolvedValue({ a: 1 });
    const out = await cache.getOrSet('k1', 60, producer);
    expect(out).toEqual({ a: 1 });
    expect(producer).toHaveBeenCalledTimes(1);
    expect(redis.client.set).toHaveBeenCalledWith('k1', JSON.stringify({ a: 1 }), 'EX', 60);
  });

  it('cache HIT → kembalikan nilai parsed, producer tidak dipanggil', async () => {
    redis.client.get.mockResolvedValue(JSON.stringify([1, 2, 3]));
    const producer = vi.fn();
    expect(await cache.getOrSet('k1', 60, producer)).toEqual([1, 2, 3]);
    expect(producer).not.toHaveBeenCalled();
  });

  it('Redis get error → fail-safe: tetap panggil producer', async () => {
    redis.client.get.mockRejectedValue(new Error('down'));
    const producer = vi.fn().mockResolvedValue('fresh');
    expect(await cache.getOrSet('k1', 60, producer)).toBe('fresh');
  });

  it('bust key tunggal → DEL', async () => {
    await cache.bust('k1');
    expect(redis.client.del).toHaveBeenCalledWith('k1');
  });

  it('bust pola glob → KEYS lalu DEL semua', async () => {
    redis.client.keys.mockResolvedValue(['a:1', 'a:2']);
    await cache.bust('a:*');
    expect(redis.client.keys).toHaveBeenCalledWith('a:*');
    expect(redis.client.del).toHaveBeenCalledWith('a:1', 'a:2');
  });
});
