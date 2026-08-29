import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';

import { PrismaService } from '../../prisma/prisma.service.js';
import { buildPageMeta, pageSkip, type PaginatedResult } from '../../common/dto/pagination.dto.js';
import { NOTIFICATIONS_QUEUE } from '../../queue/queue.module.js';
import type { ListNotificationsQueryDto } from './dto/notifications.dto.js';

export const JOB_ATTENDANCE_DONE = 'attendance-done';
export const JOB_NOTIFY_USER = 'notify-user';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(NOTIFICATIONS_QUEUE) private readonly queue: Queue,
  ) {}

  // ---------- device tokens ----------

  async registerDevice(userId: string, token: string, platform?: string) {
    await this.prisma.deviceToken.upsert({
      where: { token },
      create: { userId, token, platform: platform ?? null },
      update: { userId, platform: platform ?? undefined, lastSeenAt: new Date() },
    });
    return { registered: true };
  }

  async unregisterDevice(userId: string, token: string) {
    await this.prisma.deviceToken.deleteMany({ where: { token, userId } });
    return { unregistered: true };
  }

  // ---------- inbox ----------

  async list(userId: string, q: ListNotificationsQueryDto): Promise<PaginatedResult<unknown>> {
    const where = { userId, ...(q.unreadOnly ? { isRead: false } : {}) };
    const [total, data, unread] = await this.prisma.$transaction([
      this.prisma.notification.count({ where }),
      this.prisma.notification.findMany({
        where,
        orderBy: { sentAt: 'desc' },
        skip: pageSkip(q.page, q.pageSize),
        take: q.pageSize,
      }),
      this.prisma.notification.count({ where: { userId, isRead: false } }),
    ]);
    return { data, meta: { ...buildPageMeta(q.page, q.pageSize, total), unread } as never };
  }

  async unreadCount(userId: string) {
    const unread = await this.prisma.notification.count({ where: { userId, isRead: false } });
    return { unread };
  }

  async markRead(userId: string, ids: string[]) {
    const res = await this.prisma.notification.updateMany({
      where: { userId, id: { in: ids }, isRead: false },
      data: { isRead: true },
    });
    return { updated: res.count, unread: (await this.unreadCount(userId)).unread };
  }

  async markAllRead(userId: string) {
    const res = await this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });
    return { updated: res.count, unread: 0 };
  }

  // ---------- enqueue ----------

  /**
   * Non-blocking: hanya menaruh job ke queue (operasi Redis singkat), sehingga
   * response `POST /attendance/submit` tetap cepat (DoD Fase 1.5).
   */
  async enqueueAttendanceDone(sessionId: string): Promise<void> {
    try {
      await this.queue.add(
        JOB_ATTENDANCE_DONE,
        { sessionId },
        { jobId: `attn-done_${sessionId}` },
      );
    } catch (err) {
      this.logger.error(`Gagal enqueue notifikasi untuk sesi ${sessionId}: ${(err as Error).message}`);
    }
  }

  /**
   * Kirim satu notifikasi ke satu user via queue (non-blocking).
   * `jobId` & `dedupeKey` menjaga idempotensi (retry / pemanggilan ganda).
   */
  async enqueueUserNotification(params: {
    userId: string;
    type: string;
    title: string;
    body: string;
    payload?: Record<string, unknown>;
    jobId: string;
    dedupeKey: string;
  }): Promise<void> {
    try {
      await this.queue.add(
        JOB_NOTIFY_USER,
        {
          userId: params.userId,
          type: params.type,
          title: params.title,
          body: params.body,
          payload: params.payload ?? {},
          dedupeKey: params.dedupeKey,
        },
        { jobId: params.jobId },
      );
    } catch (err) {
      this.logger.error(
        `Gagal enqueue notifikasi (${params.type}) untuk user ${params.userId}: ${(err as Error).message}`,
      );
    }
  }
}
