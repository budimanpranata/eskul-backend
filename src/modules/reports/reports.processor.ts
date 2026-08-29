import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';

import { REPORTS_QUEUE } from '../../queue/queue.module.js';
import { JOB_GENERATE_REPORT, ReportsService } from './reports.service.js';

/**
 * Worker BullMQ untuk generate file export (PDF/Excel) di luar request thread.
 * Retry 3x + backoff eksponensial + dead-letter mengikuti config `QueueModule`.
 */
@Processor(REPORTS_QUEUE, { concurrency: 2 })
export class ReportsProcessor extends WorkerHost {
  private readonly logger = new Logger(ReportsProcessor.name);

  constructor(private readonly reports: ReportsService) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    if (job.name !== JOB_GENERATE_REPORT) {
      this.logger.warn(`Job tidak dikenal: ${job.name}`);
      return undefined;
    }
    const exportId = job.data.exportId as string;
    return this.reports.runExportJob(exportId);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error) {
    if (job.attemptsMade >= (job.opts.attempts ?? 1)) {
      this.logger.error(
        `DLQ: job ${job.name}#${job.id} gagal permanen setelah ${job.attemptsMade}x — ${err.message}`,
      );
    }
  }
}
