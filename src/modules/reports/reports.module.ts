import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { REPORTS_QUEUE } from '../../queue/queue.module.js';
import { ReportsController } from './reports.controller.js';
import { ReportsProcessor } from './reports.processor.js';
import { ReportsService } from './reports.service.js';
import { ReportSigner } from './report-signer.js';
import { reportStorageFactory } from './storage/report-storage.factory.js';
import { REPORT_STORAGE } from './storage/report-storage.js';

@Module({
  imports: [BullModule.registerQueue({ name: REPORTS_QUEUE })],
  controllers: [ReportsController],
  providers: [
    ReportsService,
    ReportsProcessor,
    ReportSigner,
    { provide: REPORT_STORAGE, useFactory: reportStorageFactory, inject: [ConfigService] },
  ],
  exports: [ReportsService],
})
export class ReportsModule {}
