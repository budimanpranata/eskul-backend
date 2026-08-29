import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';

import { PERIODIC_QUEUE } from '../../queue/queue.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { PeriodicReportsController } from './periodic-reports.controller.js';
import { PeriodicReportsProcessor } from './periodic-reports.processor.js';
import { PeriodicReportsService } from './periodic-reports.service.js';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    BullModule.registerQueue({ name: PERIODIC_QUEUE }),
    NotificationsModule,
  ],
  controllers: [PeriodicReportsController],
  providers: [PeriodicReportsService, PeriodicReportsProcessor],
  exports: [PeriodicReportsService],
})
export class PeriodicReportsModule {}
