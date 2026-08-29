import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

export const NOTIFICATIONS_QUEUE = 'notifications';
export const REPORTS_QUEUE = 'reports';
export const PERIODIC_QUEUE = 'periodic-reports';

/**
 * Infrastruktur job queue (BullMQ di atas Redis).
 * Dipakai untuk pekerjaan asinkron: push notification (Fase 1.5), export (Fase 3), dst.
 */
@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('redis.host'),
          port: config.get<number>('redis.port'),
          password: config.get<string>('redis.password') || undefined,
        },
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 1000 }, // 1s, 2s, 4s
          removeOnComplete: 200,
          removeOnFail: false, // simpan job gagal sebagai dead-letter untuk inspeksi
        },
      }),
    }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
