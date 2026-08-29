import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { Queue } from 'bullmq';

import { PrismaService } from '../../prisma/prisma.service.js';
import { NOTIFICATIONS_QUEUE } from '../../queue/queue.module.js';
import { JOB_ATTENDANCE_DONE, JOB_NOTIFY_USER } from './notifications.service.js';
import { PUSH_SENDER, type PushSender } from './push/push-sender.js';

interface NotifyUserData {
  userId: string;
  sessionId: string;
  title: string;
  body: string;
}

const DAY_LABELS = ['', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];

@Processor(NOTIFICATIONS_QUEUE, { concurrency: 5 })
export class NotificationsProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationsProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(NOTIFICATIONS_QUEUE) private readonly queue: Queue,
    @Inject(PUSH_SENDER) private readonly push: PushSender,
  ) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    switch (job.name) {
      case JOB_ATTENDANCE_DONE:
        return this.fanOut(job.data.sessionId as string);
      case JOB_NOTIFY_USER:
        return this.deliver(job.data as NotifyUserData);
      default:
        this.logger.warn(`Job tidak dikenal: ${job.name}`);
        return undefined;
    }
  }

  /** Sesi SUBMITTED → sebar job per orang tua ber-relasi APPROVED. */
  private async fanOut(sessionId: string) {
    const session = await this.prisma.attendanceSession.findUnique({
      where: { id: sessionId },
      select: {
        sessionDate: true,
        extracurricular: { select: { name: true } },
        coach: { select: { user: { select: { fullName: true } } } },
        details: { select: { studentId: true } },
      },
    });
    if (!session) {
      this.logger.warn(`fanOut: sesi ${sessionId} tidak ditemukan.`);
      return { recipients: 0 };
    }

    const studentIds = session.details.map((d) => d.studentId);
    const relations = await this.prisma.parentStudentRelation.findMany({
      where: { studentId: { in: studentIds }, approvalStatus: 'APPROVED' },
      select: { parent: { select: { userId: true } } },
    });
    const userIds = [...new Set(relations.map((r) => r.parent.userId))];

    const d = session.sessionDate;
    const dateLabel = `${DAY_LABELS[isoDow(d)]} ${d.toISOString().slice(0, 10)}`;
    const title = `Presensi ${session.extracurricular.name} selesai`;
    const body = `Kehadiran ${dateLabel} sudah dicatat oleh ${session.coach.user.fullName}.`;

    await this.queue.addBulk(
      userIds.map((userId) => ({
        name: JOB_NOTIFY_USER,
        data: { userId, sessionId, title, body } satisfies NotifyUserData,
        opts: { jobId: `notify_${sessionId}_${userId}` },
      })),
    );
    return { recipients: userIds.length };
  }

  /** Buat baris notifications (idempoten) + kirim push ke semua device token user. */
  private async deliver(data: NotifyUserData) {
    const existing = await this.prisma.notification.findFirst({
      where: {
        userId: data.userId,
        type: 'ATTENDANCE_DONE',
        payload: { path: ['sessionId'], equals: data.sessionId },
      },
      select: { id: true },
    });

    const notification =
      existing ??
      (await this.prisma.notification.create({
        data: {
          userId: data.userId,
          type: 'ATTENDANCE_DONE',
          title: data.title,
          body: data.body,
          payload: { sessionId: data.sessionId },
        },
        select: { id: true },
      }));

    const tokens = await this.prisma.deviceToken.findMany({
      where: { userId: data.userId },
      select: { token: true },
    });

    const errors: string[] = [];
    for (const { token } of tokens) {
      try {
        const res = await this.push.send(token, {
          title: data.title,
          body: data.body,
          data: { type: 'ATTENDANCE_DONE', sessionId: data.sessionId, notificationId: notification.id },
        });
        if (res.invalidToken) {
          await this.prisma.deviceToken.deleteMany({ where: { token } });
        }
      } catch (err) {
        errors.push((err as Error).message);
      }
    }

    if (errors.length) {
      // Lempar → BullMQ retry (maks 3x, backoff eksponensial). Baris notifications
      // sudah dibuat sehingga retry tidak menduplikasi (idempoten di atas).
      throw new Error(`Push gagal untuk ${errors.length}/${tokens.length} token: ${errors[0]}`);
    }
    return { notificationId: notification.id, tokens: tokens.length };
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error) {
    if (job.attemptsMade >= (job.opts.attempts ?? 1)) {
      // Job masuk "dead-letter" (removeOnFail:false) — dicatat untuk investigasi.
      this.logger.error(
        `DLQ: job ${job.name}#${job.id} gagal permanen setelah ${job.attemptsMade}x — ${err.message}`,
      );
    }
  }
}

function isoDow(d: Date): number {
  const n = d.getUTCDay();
  return n === 0 ? 7 : n;
}
