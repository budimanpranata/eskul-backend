import type { Job } from 'bullmq';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../prisma/prisma.service.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import { monthlyWindow, weeklyWindow } from './period.js';
import { PeriodicReportsProcessor } from './periodic-reports.processor.js';
import { JOB_PERIODIC_BATCH, JOB_PERIODIC_FANOUT } from './periodic-reports.service.js';

const job = (name: string, data: unknown) =>
  ({ name, data, opts: { attempts: 3 }, attemptsMade: 1, id: 'j1' }) as unknown as Job;

const WEEK = weeklyWindow(new Date('2026-08-30T11:00:00.000Z')); // weekly:2026-08-24

describe('PeriodicReportsProcessor', () => {
  let prisma: any;
  let queue: { addBulk: ReturnType<typeof vi.fn> };
  let notifications: { enqueueUserNotification: ReturnType<typeof vi.fn> };
  let proc: PeriodicReportsProcessor;

  beforeEach(() => {
    prisma = {
      parentStudentRelation: { findMany: vi.fn() },
      attendanceDetail: { findMany: vi.fn().mockResolvedValue([]) },
    };
    queue = { addBulk: vi.fn().mockResolvedValue(undefined) };
    notifications = { enqueueUserNotification: vi.fn().mockResolvedValue(undefined) };
    proc = new PeriodicReportsProcessor(
      prisma as unknown as PrismaService,
      queue as never,
      notifications as unknown as NotificationsService,
    );
  });

  describe('fanOut', () => {
    it('memecah siswa ber-wali APPROVED ke batch dengan delay progresif + jobId deterministik', async () => {
      // 450 siswa → batch size 200 → 3 batch
      prisma.parentStudentRelation.findMany.mockResolvedValue(
        Array.from({ length: 450 }, (_, i) => ({ studentId: `s${i}` })),
      );

      const res = (await proc.process(job(JOB_PERIODIC_FANOUT, { window: WEEK }))) as {
        students: number;
        batches: number;
      };

      expect(res).toEqual({ students: 450, batches: 3 });
      const bulk = queue.addBulk.mock.calls[0][0];
      expect(bulk.map((b: any) => b.opts.delay)).toEqual([0, 750, 1500]);
      expect(bulk.map((b: any) => b.opts.jobId)).toEqual([
        'periodic_batch_weekly_2026-08-24_0',
        'periodic_batch_weekly_2026-08-24_1',
        'periodic_batch_weekly_2026-08-24_2',
      ]);
      expect(bulk[0].data.studentIds).toHaveLength(200);
      expect(bulk[2].data.studentIds).toHaveLength(50);
    });

    it('tidak ada siswa → tidak addBulk', async () => {
      prisma.parentStudentRelation.findMany.mockResolvedValue([]);
      const res = (await proc.process(job(JOB_PERIODIC_FANOUT, { window: WEEK }))) as {
        batches: number;
      };
      expect(res.batches).toBe(0);
      expect(queue.addBulk).not.toHaveBeenCalled();
    });
  });

  describe('processBatch (weekly)', () => {
    it('siswa dengan sesi → 1 notifikasi per wali APPROVED, jobId + dedupeKey deterministik', async () => {
      prisma.attendanceDetail.findMany.mockResolvedValue([
        { status: 'HADIR', activenessScore: 5 },
        { status: 'HADIR', activenessScore: 3 },
        { status: 'ALPA', activenessScore: null },
      ]);
      prisma.parentStudentRelation.findMany.mockResolvedValue([
        { parent: { userId: 'u1' }, student: { fullName: 'Andi' } },
        { parent: { userId: 'u2' }, student: { fullName: 'Andi' } },
      ]);

      await proc.process(job(JOB_PERIODIC_BATCH, { window: WEEK, studentIds: ['stud-1'] }));

      expect(notifications.enqueueUserNotification).toHaveBeenCalledTimes(2);
      const first = notifications.enqueueUserNotification.mock.calls[0][0];
      expect(first).toMatchObject({
        userId: 'u1',
        type: 'WEEKLY_REPORT',
        jobId: 'notify_wr_weekly_2026-08-24_u1_stud-1',
        dedupeKey: 'wr:weekly:2026-08-24:stud-1',
      });
      expect(first.body).toContain('66.7%'); // hadir 2 / 3 sesi
      expect(first.body).toContain('4.0'); // rata-rata (5+3)/2
      expect(first.payload).toMatchObject({ periodKey: 'weekly:2026-08-24', totalSessions: 3, hadir: 2 });
    });

    it('siswa tanpa sesi di periode → dilewati, tidak ada notifikasi', async () => {
      prisma.attendanceDetail.findMany.mockResolvedValue([]);
      const res = (await proc.process(
        job(JOB_PERIODIC_BATCH, { window: WEEK, studentIds: ['s-empty'] }),
      )) as { sent: number; skippedNoData: number };
      expect(res).toMatchObject({ sent: 0, skippedNoData: 1 });
      expect(prisma.parentStudentRelation.findMany).not.toHaveBeenCalled();
      expect(notifications.enqueueUserNotification).not.toHaveBeenCalled();
    });
  });

  describe('processBatch (monthly, tren)', () => {
    it('menyertakan tren vs bulan sebelumnya di payload & body', async () => {
      const MONTH = monthlyWindow(new Date('2026-09-01T00:00:00.000Z')); // monthly:2026-08, prev 07
      // panggilan 1 = bulan berjalan (Agu): 8 hadir / 10; panggilan 2 = prev (Jul): 5 hadir / 10
      prisma.attendanceDetail.findMany
        .mockResolvedValueOnce([
          ...Array(8).fill({ status: 'HADIR', activenessScore: 4 }),
          ...Array(2).fill({ status: 'ALPA', activenessScore: null }),
        ])
        .mockResolvedValueOnce([
          ...Array(5).fill({ status: 'HADIR', activenessScore: null }),
          ...Array(5).fill({ status: 'IZIN', activenessScore: null }),
        ]);
      prisma.parentStudentRelation.findMany.mockResolvedValue([
        { parent: { userId: 'u1' }, student: { fullName: 'Bella' } },
      ]);

      await proc.process(job(JOB_PERIODIC_BATCH, { window: MONTH, studentIds: ['stud-9'] }));

      const call = notifications.enqueueUserNotification.mock.calls[0][0];
      expect(call.type).toBe('MONTHLY_REPORT');
      expect(call.dedupeKey).toBe('mr:monthly:2026-08:stud-9');
      expect(call.payload).toMatchObject({ trend: 'naik', prevAttendancePct: 50, attendancePct: 80 });
      expect(call.body).toContain('meningkat');
    });
  });
});
