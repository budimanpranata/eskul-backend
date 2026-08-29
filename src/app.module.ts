import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import configuration from './config/configuration.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { QueueModule } from './queue/queue.module.js';
import { RedisModule } from './redis/redis.module.js';

import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';

import { AuthModule } from './modules/auth/auth.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { StudentsModule } from './modules/students/students.module.js';
import { CoachesModule } from './modules/coaches/coaches.module.js';
import { ParentsModule } from './modules/parents/parents.module.js';
import { ExtracurricularsModule } from './modules/extracurriculars/extracurriculars.module.js';
import { AttendanceModule } from './modules/attendance/attendance.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { ReportsModule } from './modules/reports/reports.module.js';
import { AnalyticsModule } from './modules/analytics/analytics.module.js';
import { AuditModule } from './modules/audit/audit.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration], cache: true }),
    // Catatan: rate limiting (@nestjs/throttler) ditambahkan di Fase 1.1/4.3
    // — versi terkini throttler belum menandai peer support NestJS 12.

    // Infrastruktur
    PrismaModule,
    RedisModule,
    QueueModule,

    // Modul fitur (kerangka Fase 0)
    AuthModule,
    UsersModule,
    StudentsModule,
    CoachesModule,
    ParentsModule,
    ExtracurricularsModule,
    AttendanceModule,
    NotificationsModule,
    ReportsModule,
    AnalyticsModule,
    AuditModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
