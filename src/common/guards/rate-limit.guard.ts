import {
  CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';

import {
  NO_RATE_LIMIT_KEY,
  RATE_LIMIT_KEY,
  type RateLimitOptions,
} from '../decorators/rate-limit.decorator.js';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import { RedisService } from '../../redis/redis.service.js';

/**
 * Rate limiting fixed-window berbasis Redis (Fase 4.3).
 *
 * - Handler ber-`@RateLimit(...)` → batas ketat khusus (mis. `/auth/login`).
 * - Handler lain → batas global longgar per-IP (`rateLimit.globalLimit`).
 * - `@NoRateLimit()` → dilewati.
 *
 * Bila Redis bermasalah, guard **fail-open** (tidak memblokir) agar rate limiting
 * tidak menjadi single point of failure.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);
  private readonly enabled: boolean;
  private readonly globalLimit: number;
  private readonly globalWindow: number;

  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
    private readonly redis: RedisService,
  ) {
    this.enabled = this.config.get<boolean>('rateLimit.enabled') ?? true;
    this.globalLimit = this.config.get<number>('rateLimit.globalLimit') ?? 300;
    this.globalWindow = this.config.get<number>('rateLimit.globalWindowSeconds') ?? 60;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.enabled) return true;

    const skip = this.reflector.getAllAndOverride<boolean>(NO_RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const ip = this.clientIp(req);

    const custom = this.reflector.getAllAndOverride<RateLimitOptions | undefined>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const routeScope = `${req.method}:${req.route?.path ?? req.path}`;
    const opts: RateLimitOptions = custom ?? {
      limit: this.globalLimit,
      windowSeconds: this.globalWindow,
      scope: 'global',
    };
    const scope = opts.scope ?? routeScope;
    const key = `rl:${scope}:${ip}`;

    const { count, ttl } = await this.hit(key, opts.windowSeconds);
    if (count < 0) return true; // Redis error → fail-open

    const remaining = Math.max(0, opts.limit - count);
    res.setHeader('X-RateLimit-Limit', String(opts.limit));
    res.setHeader('X-RateLimit-Remaining', String(remaining));

    if (count > opts.limit) {
      const retryAfter = ttl > 0 ? ttl : opts.windowSeconds;
      res.setHeader('Retry-After', String(retryAfter));
      // Publik → jangan bocorkan scope internal; log untuk deteksi.
      const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);
      this.logger.warn(
        `Rate limit terlampaui: scope=${scope} ip=${ip} count=${count}/${opts.limit}`,
      );
      throw new HttpException(
        {
          error: 'RATE_LIMITED',
          message: 'Terlalu banyak permintaan. Coba lagi nanti.',
          retryAfterSeconds: retryAfter,
          ...(isPublic ? {} : { scope }),
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }

  /** INCR + set TTL pada hit pertama. Return count & sisa TTL; count<0 → error. */
  private async hit(key: string, windowSeconds: number): Promise<{ count: number; ttl: number }> {
    try {
      const count = await this.redis.client.incr(key);
      if (count === 1) {
        await this.redis.client.expire(key, windowSeconds);
        return { count, ttl: windowSeconds };
      }
      const ttl = await this.redis.client.ttl(key);
      // Kunci tanpa TTL (mis. proses mati sebelum expire) → set ulang.
      if (ttl < 0) await this.redis.client.expire(key, windowSeconds);
      return { count, ttl: ttl < 0 ? windowSeconds : ttl };
    } catch (err) {
      this.logger.error(`Redis rate-limit error (${key}): ${(err as Error).message}`);
      return { count: -1, ttl: 0 };
    }
  }

  private clientIp(req: Request): string {
    // `trust proxy` sudah di-set di main.ts → req.ip = IP klien dari X-Forwarded-For.
    return (req.ip || req.socket?.remoteAddress || 'unknown').replace(/^::ffff:/, '');
  }
}
