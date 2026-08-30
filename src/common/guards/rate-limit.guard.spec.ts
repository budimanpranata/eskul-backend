import type { ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RateLimitGuard } from './rate-limit.guard.js';
import {
  NO_RATE_LIMIT_KEY,
  RATE_LIMIT_KEY,
} from '../decorators/rate-limit.decorator.js';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import type { RedisService } from '../../redis/redis.service.js';

const cfg = (over: Record<string, unknown> = {}): ConfigService =>
  ({
    get: (k: string) =>
      ({
        'rateLimit.enabled': true,
        'rateLimit.globalLimit': 100,
        'rateLimit.globalWindowSeconds': 60,
        ...over,
      })[k],
  }) as unknown as ConfigService;

function ctx() {
  const headers: Record<string, string> = {};
  const req = { method: 'POST', path: '/auth/login', route: { path: '/auth/login' }, ip: '1.2.3.4' };
  const res = { setHeader: (k: string, v: string) => (headers[k] = v) };
  return {
    _headers: headers,
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext & { _headers: Record<string, string> };
}

function mkRedis(incrSeq: number[]) {
  let i = 0;
  return {
    client: {
      incr: vi.fn(async () => incrSeq[i++] ?? 1),
      expire: vi.fn(async () => 1),
      ttl: vi.fn(async () => 42),
    },
  } as unknown as RedisService & { client: Record<string, ReturnType<typeof vi.fn>> };
}

describe('RateLimitGuard', () => {
  let reflector: Reflector;
  const meta = (map: Record<string, unknown>) =>
    vi.spyOn(reflector, 'getAllAndOverride').mockImplementation((k: unknown) => map[k as string]);

  beforeEach(() => {
    reflector = new Reflector();
  });

  it('disabled via config → selalu lolos, tak menyentuh Redis', async () => {
    const redis = mkRedis([1]);
    const g = new RateLimitGuard(reflector, cfg({ 'rateLimit.enabled': false }), redis);
    meta({});
    expect(await g.canActivate(ctx())).toBe(true);
    expect(redis.client.incr).not.toHaveBeenCalled();
  });

  it('@NoRateLimit → lolos', async () => {
    const redis = mkRedis([1]);
    const g = new RateLimitGuard(reflector, cfg(), redis);
    meta({ [NO_RATE_LIMIT_KEY]: true });
    expect(await g.canActivate(ctx())).toBe(true);
    expect(redis.client.incr).not.toHaveBeenCalled();
  });

  it('di bawah batas → lolos + header X-RateLimit-Remaining', async () => {
    const redis = mkRedis([3]); // hit ke-3
    const g = new RateLimitGuard(reflector, cfg(), redis);
    meta({ [RATE_LIMIT_KEY]: { limit: 5, windowSeconds: 60, scope: 'login' } });
    const c = ctx();
    expect(await g.canActivate(c)).toBe(true);
    expect(c._headers['X-RateLimit-Limit']).toBe('5');
    expect(c._headers['X-RateLimit-Remaining']).toBe('2');
  });

  it('melebihi batas → 429 RATE_LIMITED + Retry-After', async () => {
    const redis = mkRedis([6]); // hit ke-6 dari limit 5
    const g = new RateLimitGuard(reflector, cfg(), redis);
    meta({ [RATE_LIMIT_KEY]: { limit: 5, windowSeconds: 60, scope: 'login' }, [IS_PUBLIC_KEY]: true });
    const c = ctx();
    try {
      await g.canActivate(c);
      throw new Error('harus throw');
    } catch (e: unknown) {
      const err = e as { getStatus: () => number; getResponse: () => Record<string, unknown> };
      expect(err.getStatus()).toBe(429);
      expect(err.getResponse()).toMatchObject({ error: 'RATE_LIMITED' });
      // route publik → scope tidak dibocorkan
      expect(err.getResponse()).not.toHaveProperty('scope');
    }
    expect(c._headers['Retry-After']).toBe('42');
  });

  it('Redis error → fail-open (lolos)', async () => {
    const redis = {
      client: { incr: vi.fn().mockRejectedValue(new Error('down')), expire: vi.fn(), ttl: vi.fn() },
    } as unknown as RedisService;
    const g = new RateLimitGuard(reflector, cfg(), redis);
    meta({ [RATE_LIMIT_KEY]: { limit: 1, windowSeconds: 60 } });
    expect(await g.canActivate(ctx())).toBe(true);
  });

  it('tanpa @RateLimit → pakai batas global', async () => {
    const redis = mkRedis([101]); // > globalLimit 100
    const g = new RateLimitGuard(reflector, cfg(), redis);
    meta({});
    await expect(g.canActivate(ctx())).rejects.toMatchObject({ status: 429 });
  });
});
