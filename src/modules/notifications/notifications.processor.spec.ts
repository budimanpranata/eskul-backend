import type { Job } from 'bullmq';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NotificationsProcessor } from './notifications.processor.js';
import { JOB_ATTENDANCE_DONE, JOB_NOTIFY_USER } from './notifications.service.js';
import type { PushSender } from './push/push-sender.js';
import type { PrismaService } from '../../prisma/prisma.service.js';

const job = (name: string, data: unknown) =>
  ({ name, data, opts: { attempts: 3 }, attemptsMade: 1, id: 'j1' }) as unknown as Job;

describe('NotificationsProcessor', () => {
  let prisma: any;
  let queue: { addBulk: ReturnType<typeof vi.fn> };
  let push: { send: ReturnType<typeof vi.fn> };
  let proc: NotificationsProcessor;

  beforeEach(() => {
    prisma = {
      attendanceSession: { findUnique: vi.fn() },
      parentStudentRelation: { findMany: vi.fn() },
      notification: { findFirst: vi.fn(), create: vi.fn() },
      deviceToken: { findMany: vi.fn().mockResolvedValue([]), deleteMany: vi.fn() },
    };
    queue = { addBulk: vi.fn().mockResolvedValue(undefined) };
    push = { send: vi.fn().mockResolvedValue({ ok: true }) };
    proc = new NotificationsProcessor(
      prisma as unknown as PrismaService,
      queue as never,
      push as unknown as PushSender,
    );
  });

  describe('fanOut', () => {
    it('menyebar satu job per userId ortu APPROVED unik, jobId deterministik', async () => {
      prisma.attendanceSession.findUnique.mockResolvedValue({
        sessionDate: new Date('2026-08-29T00:00:00Z'),
        extracurricular: { name: 'Sepak Bola' },
        coach: { user: { fullName: 'Pak Budi' } },
        details: [{ studentId: 's1' }, { studentId: 's2' }],
      });
      prisma.parentStudentRelation.findMany.mockResolvedValue([
        { parent: { userId: 'u1' } },
        { parent: { userId: 'u2' } },
        { parent: { userId: 'u1' } }, // duplikat → harus di-dedupe
      ]);

      const res = (await proc.process(job(JOB_ATTENDANCE_DONE, { sessionId: 'sess-1' }))) as {
        recipients: number;
      };
      expect(res.recipients).toBe(2);
      const bulk = queue.addBulk.mock.calls[0][0];
      expect(bulk).toHaveLength(2);
      expect(bulk.map((b: any) => b.opts.jobId).sort()).toEqual([
        'notify_sess-1_u1',
        'notify_sess-1_u2',
      ]);
      expect(bulk[0].data.title).toContain('Sepak Bola');
      expect(bulk[0].data.body).toContain('Pak Budi');
    });

    it('sesi tidak ada → recipients 0, tidak enqueue', async () => {
      prisma.attendanceSession.findUnique.mockResolvedValue(null);
      const res = (await proc.process(job(JOB_ATTENDANCE_DONE, { sessionId: 'x' }))) as {
        recipients: number;
      };
      expect(res.recipients).toBe(0);
      expect(queue.addBulk).not.toHaveBeenCalled();
    });
  });

  describe('deliver', () => {
    const data = { userId: 'u1', sessionId: 'sess-1', title: 'T', body: 'B' };

    it('membuat baris notifications bila belum ada', async () => {
      prisma.notification.findFirst.mockResolvedValue(null);
      prisma.notification.create.mockResolvedValue({ id: 'n1' });
      await proc.process(job(JOB_NOTIFY_USER, data));
      expect(prisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: 'ATTENDANCE_DONE', payload: { sessionId: 'sess-1' } }),
        }),
      );
    });

    it('idempoten: bila notifikasi untuk sesi+user sudah ada → tidak create ulang', async () => {
      prisma.notification.findFirst.mockResolvedValue({ id: 'n-existing' });
      await proc.process(job(JOB_NOTIFY_USER, data));
      expect(prisma.notification.create).not.toHaveBeenCalled();
    });

    it('push gagal → throw (agar BullMQ retry), baris notif tetap dibuat sekali', async () => {
      prisma.notification.findFirst.mockResolvedValue(null);
      prisma.notification.create.mockResolvedValue({ id: 'n1' });
      prisma.deviceToken.findMany.mockResolvedValue([{ token: 'tok-A' }]);
      push.send.mockRejectedValue(new Error('FCM down'));

      await expect(proc.process(job(JOB_NOTIFY_USER, data))).rejects.toThrow(/Push gagal/);
      expect(prisma.notification.create).toHaveBeenCalledTimes(1);
    });

    it('token invalid → dihapus dari DB, job tetap sukses', async () => {
      prisma.notification.findFirst.mockResolvedValue({ id: 'n1' });
      prisma.deviceToken.findMany.mockResolvedValue([{ token: 'tok-bad' }]);
      push.send.mockResolvedValue({ ok: false, invalidToken: true });

      await proc.process(job(JOB_NOTIFY_USER, data));
      expect(prisma.deviceToken.deleteMany).toHaveBeenCalledWith({ where: { token: 'tok-bad' } });
    });
  });
});
