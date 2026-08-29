import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext, CallHandler } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { firstValueFrom, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuditMeta } from '../decorators/audit.decorator.js';
import { AuditInterceptor } from './audit.interceptor.js';
import type { AuditService } from '../../modules/audit/audit.service.js';

const UUID = '11111111-1111-1111-1111-111111111111';

function ctx(req: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

const handler = (obs: unknown): CallHandler => ({ handle: () => obs as never });

describe('AuditInterceptor', () => {
  let reflector: Reflector;
  let audit: { log: ReturnType<typeof vi.fn> };
  let interceptor: AuditInterceptor;

  beforeEach(() => {
    reflector = new Reflector();
    audit = { log: vi.fn().mockResolvedValue(undefined) };
    interceptor = new AuditInterceptor(reflector, audit as unknown as AuditService);
  });

  const withMeta = (meta: AuditMeta | undefined) =>
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(meta);

  it('tanpa @Audit → passthrough, tidak menulis audit', async () => {
    withMeta(undefined);
    const out = await firstValueFrom(
      interceptor.intercept(ctx({ method: 'GET', path: '/x' }), handler(of('ok'))),
    );
    expect(out).toBe('ok');
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('sukses → satu baris audit: userId, ip, entityId (UUID param), query snapshot, outcome success', async () => {
    withMeta({
      action: 'VIEW_STUDENT_DATA',
      entityType: 'student',
      entityIdParam: 'id',
      captureQuery: ['search'],
    });
    const req = {
      method: 'GET',
      path: '/admin/students/' + UUID,
      route: { path: '/admin/students/:id' },
      params: { id: UUID },
      query: { search: 'budi', secret: 'x' },
      ip: '9.9.9.9',
      user: { id: 'admin-1', role: 'ADMIN' },
    };
    await firstValueFrom(interceptor.intercept(ctx(req), handler(of({ id: UUID }))));

    expect(audit.log).toHaveBeenCalledTimes(1);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'admin-1',
        action: 'VIEW_STUDENT_DATA',
        entityType: 'student',
        entityId: UUID,
        ipAddress: '9.9.9.9',
        metadata: expect.objectContaining({
          route: 'GET /admin/students/:id',
          search: 'budi',
          outcome: 'success',
        }),
      }),
    );
    // key tak diminta tidak ikut ter-snapshot
    expect(audit.log.mock.calls[0][0].metadata).not.toHaveProperty('secret');
  });

  it('param id non-UUID → entityId null (tidak melempar)', async () => {
    withMeta({ action: 'A', entityType: 'x', entityIdParam: 'id' });
    const req = { method: 'GET', path: '/x/abc', params: { id: 'abc' }, query: {}, user: { id: 'u' } };
    await firstValueFrom(interceptor.intercept(ctx(req), handler(of(1))));
    expect(audit.log.mock.calls[0][0].entityId).toBeNull();
  });

  it('handler error → audit outcome:error + statusCode, lalu error diteruskan', async () => {
    withMeta({ action: 'VIEW_STUDENT_DATA', entityType: 'student' });
    const req = { method: 'GET', path: '/x', params: {}, query: {}, user: { id: 'u1' } };
    await expect(
      firstValueFrom(
        interceptor.intercept(ctx(req), handler(throwError(() => new ForbiddenException()))),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ outcome: 'error', statusCode: 403 }),
      }),
    );
  });

  it('logFailures:false → error tidak ditulis ke audit', async () => {
    withMeta({ action: 'A', entityType: 'x', logFailures: false });
    const req = { method: 'GET', path: '/x', params: {}, query: {} };
    await expect(
      firstValueFrom(interceptor.intercept(ctx(req), handler(throwError(() => new Error('boom'))))),
    ).rejects.toThrow('boom');
    expect(audit.log).not.toHaveBeenCalled();
  });
});
