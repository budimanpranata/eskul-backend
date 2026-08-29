import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { Queue } from 'bullmq';

import { PrismaService } from '../../prisma/prisma.service.js';
import { PERIODIC_QUEUE } from '../../queue/queue.module.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { classifyTrend, keySafe, type PeriodWindow } from './period.js';
import { JOB_PERIODIC_BATCH, JOB_PERIODIC_FANOUT } from './periodic-reports.service.js';

/** Distribusi beban: siswa dipecah ke batch, tiap batch ditunda progresif. */
const BATCH_SIZE = 200;
const BATCH_DELAY_MS = 750;

interface StudentSummary {
  totalSessions: number;
  hadir: number;
  izin: number;
  sakit: number;
  alpa: number;
  attendancePct: number;
  avgActiveness: number | null;
  prevAttendancePct?: number | null;
  trend?: 'naik' | 'turun' | 'stabil';
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

@Processor(PERIODIC_QUEUE, { concurrency: 3 })
export class PeriodicReportsProcessor extends WorkerHost {
  private readonly logger = new Logger(PeriodicReportsProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(PERIODIC_QUEUE) private readonly queue: Queue,
    private readonly notifications: NotificationsService,
  ) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    switch (job.name) {
      case JOB_PERIODIC_FANOUT:
        return this.fanOut(job.data.window as PeriodWindow, (job.data.runId as string) ?? null);
      case JOB_PERIODIC_BATCH:
        return this.processBatch(
          job.data.window as PeriodWindow,
          job.data.studentIds as string[],
          (job.data.runId as string) ?? null,
        );
      default:
        this.logger.warn(`Job tidak dikenal: ${job.name}`);
        return undefined;
    }
  }

  /** Kumpulkan siswa yang punya wali APPROVED, pecah ke batch ber-delay progresif. */
  private async fanOut(window: PeriodWindow, runId: string | null) {
    const rels = await this.prisma.parentStudentRelation.findMany({
      where: { approvalStatus: 'APPROVED' },
      select: { studentId: true },
      distinct: ['studentId'],
    });
    const studentIds = rels.map((r) => r.studentId);
    const batches = chunk(studentIds, BATCH_SIZE);

    const suffix = runId ? `_${runId}` : '';
    if (batches.length) {
      await this.queue.addBulk(
        batches.map((ids, i) => ({
          name: JOB_PERIODIC_BATCH,
          data: { window, studentIds: ids, runId },
          opts: {
            jobId: `periodic_batch_${keySafe(window.key)}_${i}${suffix}`,
            delay: i * BATCH_DELAY_MS,
          },
        })),
      );
    }
    this.logger.log(
      `Fan-out ${window.key}: ${studentIds.length} siswa → ${batches.length} batch (jeda ${BATCH_DELAY_MS}ms).`,
    );
    return { students: studentIds.length, batches: batches.length };
  }

  /** Hitung ringkasan tiap siswa di batch → enqueue satu notifikasi per wali APPROVED. */
  private async processBatch(window: PeriodWindow, studentIds: string[], runId: string | null) {
    const type = window.type === 'weekly' ? 'WEEKLY_REPORT' : 'MONTHLY_REPORT';
    const prefix = window.type === 'weekly' ? 'wr' : 'mr';
    let sent = 0;
    let skippedNoData = 0;

    for (const studentId of studentIds) {
      const summary = await this.buildSummary(window, studentId);
      // Tidak ada sesi pada periode → tidak ada yang dilaporkan.
      if (summary.totalSessions === 0) {
        skippedNoData += 1;
        continue;
      }

      const parents = await this.prisma.parentStudentRelation.findMany({
        where: { studentId, approvalStatus: 'APPROVED' },
        select: {
          parent: { select: { userId: true } },
          student: { select: { fullName: true } },
        },
      });
      if (!parents.length) continue;

      const studentName = parents[0].student.fullName;
      const { title, body } = renderMessage(window, studentName, summary);
      const dedupeKey = `${prefix}:${window.key}:${studentId}`;

      for (const p of parents) {
        await this.notifications.enqueueUserNotification({
          userId: p.parent.userId,
          type,
          title,
          body,
          payload: {
            periodType: window.type,
            periodKey: window.key,
            periodLabel: window.label,
            from: window.from,
            to: window.to,
            studentId,
            studentName,
            ...summary,
          },
          // jobId deterministik → retry batch tidak menambah job baru.
          // Forced re-run pakai suffix runId agar job benar-benar dijalankan lagi;
          // `dedupeKey` di bawah tetap mencegah baris notifikasi ganda.
          jobId: `notify_${prefix}_${keySafe(window.key)}_${p.parent.userId}_${studentId}${
            runId ? `_${runId}` : ''
          }`,
          dedupeKey,
        });
        sent += 1;
      }
    }
    return { students: studentIds.length, sent, skippedNoData };
  }

  private async buildSummary(window: PeriodWindow, studentId: string): Promise<StudentSummary> {
    const pct = (hadir: number, total: number) =>
      total ? Math.round((hadir / total) * 1000) / 10 : 0;

    const rows = await this.attendanceRows(studentId, window.from, window.to);
    const counts = { hadir: 0, izin: 0, sakit: 0, alpa: 0 };
    let scoreSum = 0;
    let scoreN = 0;
    for (const r of rows) {
      if (r.status === 'HADIR') counts.hadir += 1;
      else if (r.status === 'IZIN') counts.izin += 1;
      else if (r.status === 'SAKIT') counts.sakit += 1;
      else if (r.status === 'ALPA') counts.alpa += 1;
      if (r.activenessScore != null) {
        scoreSum += r.activenessScore;
        scoreN += 1;
      }
    }
    const attendancePct = pct(counts.hadir, rows.length);
    const summary: StudentSummary = {
      totalSessions: rows.length,
      ...counts,
      attendancePct,
      avgActiveness: scoreN ? Math.round((scoreSum / scoreN) * 10) / 10 : null,
    };

    if (window.type === 'monthly' && window.prev) {
      const prevRows = await this.attendanceRows(studentId, window.prev.from, window.prev.to);
      const prevPct = prevRows.length
        ? pct(prevRows.filter((r) => r.status === 'HADIR').length, prevRows.length)
        : null;
      summary.prevAttendancePct = prevPct;
      summary.trend = classifyTrend(attendancePct, prevPct);
    }
    return summary;
  }

  private attendanceRows(studentId: string, from: string, to: string) {
    return this.prisma.attendanceDetail.findMany({
      where: {
        studentId,
        session: {
          status: { in: ['SUBMITTED', 'SYNCED'] },
          sessionDate: {
            gte: new Date(`${from}T00:00:00.000Z`),
            lte: new Date(`${to}T00:00:00.000Z`),
          },
        },
      },
      select: { status: true, activenessScore: true },
    });
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

function renderMessage(window: PeriodWindow, studentName: string, s: StudentSummary) {
  const act = s.avgActiveness == null ? '-' : s.avgActiveness.toFixed(1);
  if (window.type === 'weekly') {
    return {
      title: `Ringkasan mingguan ${studentName}`,
      body:
        `Minggu ${window.label}: ${s.totalSessions} sesi, hadir ${s.hadir} (${s.attendancePct}%), ` +
        `izin ${s.izin}, sakit ${s.sakit}, alpa ${s.alpa}. Rata-rata keaktifan ${act}.`,
    };
  }
  const trendWord =
    s.trend === 'naik' ? 'meningkat' : s.trend === 'turun' ? 'menurun' : 'stabil';
  const vsPrev =
    s.prevAttendancePct == null
      ? ''
      : ` Kehadiran ${trendWord} dari ${s.prevAttendancePct}% bulan sebelumnya.`;
  return {
    title: `Ringkasan bulanan ${studentName}`,
    body:
      `${window.label}: ${s.totalSessions} sesi, hadir ${s.hadir} (${s.attendancePct}%), ` +
      `izin ${s.izin}, sakit ${s.sakit}, alpa ${s.alpa}. Rata-rata keaktifan ${act}.${vsPrev}`,
  };
}
