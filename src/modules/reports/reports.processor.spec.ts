import type { Job } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';

import { ReportsProcessor } from './reports.processor.js';
import { JOB_GENERATE_REPORT, type ReportsService } from './reports.service.js';

const job = (name: string, data: unknown) =>
  ({ name, data, opts: { attempts: 3 }, attemptsMade: 1, id: 'j1' }) as unknown as Job;

describe('ReportsProcessor', () => {
  it('meneruskan JOB_GENERATE_REPORT ke ReportsService.runExportJob', async () => {
    const reports = { runExportJob: vi.fn().mockResolvedValue({ rowCount: 3, fileSize: 10 }) };
    const proc = new ReportsProcessor(reports as unknown as ReportsService);
    const res = await proc.process(job(JOB_GENERATE_REPORT, { exportId: 'exp-9' }));
    expect(reports.runExportJob).toHaveBeenCalledWith('exp-9');
    expect(res).toEqual({ rowCount: 3, fileSize: 10 });
  });

  it('job tak dikenal → tidak memanggil service', async () => {
    const reports = { runExportJob: vi.fn() };
    const proc = new ReportsProcessor(reports as unknown as ReportsService);
    await proc.process(job('sesuatu-lain', {}));
    expect(reports.runExportJob).not.toHaveBeenCalled();
  });
});
