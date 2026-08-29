import {
  type CallHandler,
  type ExecutionContext,
  HttpException,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { catchError, tap, throwError } from 'rxjs';

import { AUDIT_KEY, type AuditMeta } from '../decorators/audit.decorator.js';
import type { AuthenticatedUser } from '../types/authenticated-user.js';
import { AuditService } from '../../modules/audit/audit.service.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Interceptor global: bila handler diberi `@Audit(meta)`, tulis satu baris
 * `audit_logs` otomatis setelah request selesai (sukses maupun gagal).
 *
 * Kegagalan menulis audit TIDAK menggagalkan request (dijamin `AuditService.log`).
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler) {
    const meta = this.reflector.getAllAndOverride<AuditMeta | undefined>(AUDIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!meta) return next.handle();

    const req = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const base = this.baseEntry(req, meta);

    return next.handle().pipe(
      tap(() => {
        void this.audit.log({ ...base, metadata: { ...base.metadata, outcome: 'success' } });
      }),
      catchError((err: unknown) => {
        if (meta.logFailures !== false) {
          const status = err instanceof HttpException ? err.getStatus() : 500;
          void this.audit.log({
            ...base,
            metadata: { ...base.metadata, outcome: 'error', statusCode: status },
          });
        }
        return throwError(() => err);
      }),
    );
  }

  private baseEntry(req: Request & { user?: AuthenticatedUser }, meta: AuditMeta) {
    const params = (req.params ?? {}) as Record<string, string>;
    const query = (req.query ?? {}) as Record<string, unknown>;

    const rawId = meta.entityIdParam ? params[meta.entityIdParam] : undefined;
    const entityId = rawId && UUID_RE.test(rawId) ? rawId : null;

    const snapshot: Record<string, unknown> = {
      route: `${req.method} ${req.route?.path ?? req.path}`,
    };
    for (const k of meta.captureParams ?? []) {
      if (params[k] != null) snapshot[k] = params[k];
    }
    for (const k of meta.captureQuery ?? []) {
      if (query[k] != null && query[k] !== '') snapshot[k] = query[k];
    }

    return {
      userId: req.user?.id ?? null,
      action: meta.action,
      entityType: meta.entityType,
      entityId,
      ipAddress: req.ip ?? null,
      metadata: snapshot,
    };
  }
}
