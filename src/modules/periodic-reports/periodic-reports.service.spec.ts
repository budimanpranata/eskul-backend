import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RedisService } from '../../redis/redis.service.js';
import { JOB_PERIODIC_FANOUT, PeriodicReportsService } from './periodic-reports.service.js';

describe('PeriodicReportsService.dispatch', () => {
  let redisSet: ReturnType<typeof vi.fn>;
  let queueAdd: ReturnType<typeof vi.fn>;
  let svc: PeriodicReportsService;

  const SUNDAY_18_WIB = new Date('2026-08-30T11:00:00.000Z');

  beforeEach(() => {
    redisSet = vi.fn().mockResolvedValue('OK');
    queueAdd = vi.fn().mockResolvedValue(undefined);
    svc = new PeriodicReportsService(
      { client: { set: redisSet } } as unknown as RedisService,
      { add: queueAdd } as never,
    );
  });

  it('run pertama: ambil lock (SET NX), enqueue fan-out dengan jobId deterministik', async () => {
    const res = await svc.runWeekly(SUNDAY_18_WIB);

    expect(redisSet).toHaveBeenCalledWith('periodic:lock:weekly:2026-08-24', '1', 'EX', expect.any(Number), 'NX');
    expect(queueAdd).toHaveBeenCalledWith(
      JOB_PERIODIC_FANOUT,
      { window: expect.objectContaining({ key: 'weekly:2026-08-24' }), runId: null },
      { jobId: 'periodic_fanout_weekly_2026-08-24' },
    );
    expect(res).toMatchObject({ key: 'weekly:2026-08-24', enqueued: true });
  });

  it('run kedua di periode sama: lock gagal → skipped, tidak enqueue', async () => {
    redisSet.mockResolvedValueOnce(null); // SET NX gagal (key sudah ada)
    const res = await svc.runWeekly(SUNDAY_18_WIB);

    expect(res).toMatchObject({ enqueued: false, skipped: true });
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it('force:true → lewati lock, enqueue dengan jobId unik (bisa dijalankan ulang)', async () => {
    const res = await svc.runMonthly(new Date('2026-09-01T00:00:00.000Z'), { force: true });
    expect(redisSet).not.toHaveBeenCalled();
    expect(queueAdd).toHaveBeenCalledWith(
      JOB_PERIODIC_FANOUT,
      { window: expect.objectContaining({ key: 'monthly:2026-08' }), runId: expect.any(String) },
      { jobId: expect.stringMatching(/^periodic_fanout_monthly_2026-08_\d+$/) },
    );
    expect(res.enqueued).toBe(true);
  });

  it('Redis bermasalah saat ambil lock → tidak memblokir (tetap enqueue)', async () => {
    redisSet.mockRejectedValueOnce(new Error('redis down'));
    const res = await svc.runWeekly(SUNDAY_18_WIB);
    expect(res.enqueued).toBe(true);
    expect(queueAdd).toHaveBeenCalled();
  });
});
