import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';

import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: false });
  const config = app.get(ConfigService);

  // Di belakang API Gateway / Load Balancer (dokumen desain bagian 1.1) —
  // agar `req.ip` yang dicatat ke audit_logs adalah IP klien, bukan IP proxy.
  app.set('trust proxy', 1);

  app.use(helmet());
  app.enableCors({
    origin: config.get<string[]>('cors.allowedOrigins'),
    credentials: true,
  });
  app.setGlobalPrefix(config.get<string>('apiPrefix') ?? 'api/v1');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );
  app.enableShutdownHooks();

  const port = config.get<number>('port') ?? 3000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`eskul-backend listening on http://localhost:${port}/${config.get('apiPrefix')}`);
}

await bootstrap();
