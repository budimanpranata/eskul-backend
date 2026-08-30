import { BadRequestException, Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';

import { AppModule } from './app.module.js';
import { flattenValidationErrors } from './common/validation/flatten-validation-errors.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: false });
  const config = app.get(ConfigService);
  const log = new Logger('Bootstrap');
  const isProd = config.get<string>('env') === 'production';

  // Di belakang API Gateway / Load Balancer (dokumen desain bagian 1.1) —
  // agar `req.ip` yang dicatat ke audit_logs adalah IP klien, bukan IP proxy.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      // API murni JSON → CSP tidak relevan; matikan agar tak konflik.
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'same-site' },
      // HSTS: TLS wajib (terminasi di gateway). 180 hari + subdomain + preload.
      hsts: { maxAge: 15_552_000, includeSubDomains: true, preload: true },
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );

  // CORS — hanya origin resmi. Bintang (*) DITOLAK; kredensial butuh origin eksplisit.
  const allowedOrigins = config.get<string[]>('cors.allowedOrigins') ?? [];
  if (allowedOrigins.includes('*')) {
    const msg = 'CORS_ALLOWED_ORIGINS memuat "*" — tidak diizinkan (kredensial + wildcard).';
    if (isProd) throw new Error(msg);
    log.warn(msg + ' Diabaikan.');
  }
  const safeOrigins = allowedOrigins.filter((o) => o && o !== '*');
  app.enableCors({
    origin: safeOrigins.length ? safeOrigins : false,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    maxAge: 600,
  });
  log.log(`CORS origin diizinkan: ${safeOrigins.join(', ') || '(none)'}`);

  app.setGlobalPrefix(config.get<string>('apiPrefix') ?? 'api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      // Body error validasi terstruktur & konsisten: { error, details:[{field,message}] }.
      // Endpoint kontrak (mis. /attendance/submit) memetakan ulang 400 ini ke 422.
      exceptionFactory: (errors) =>
        new BadRequestException({
          error: 'VALIDATION_ERROR',
          details: flattenValidationErrors(errors),
        }),
    }),
  );
  app.enableShutdownHooks();

  const port = config.get<number>('port') ?? 3000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`eskul-backend listening on http://localhost:${port}/${config.get('apiPrefix')}`);
}

await bootstrap();
