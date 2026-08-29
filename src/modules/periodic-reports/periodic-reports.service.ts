import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Queue } from 'bullmq';

import { RedisService } from '../../redis/redis.service.js';
import { PERIODIC_QUEUE } from '../../queue/queue.module.js';
import {
  keySafe,
  monthlyWindow,
  weeklyWindow,
  type PeriodType,
  type PeriodWindow,
} from './period.js';

export const JOB_PERIODIC_FANOUT = 'periodic-fanout';
export const JOB_PERIODIC_BATCH = 'periodic-batch';

/** Kunci lock ditahan cukup lama agar cron yang restart di jam sama tidak dobel. */
const LOCK_TTL_SECONDS = 6 * 60 * 60;

export interface DispatchResult {
  key: string;
  window: PeriodWindow;
  enqueued: boolean;
  skipped?: boolean;
}

/**
 * Laporan berkala otomatis ke orang tua (Fase 3.3).
 * Cron hanya *memicu* — pekerjaan berat (fan-out + batch) berjalan di BullMQ
 * worker sehingga generate ribuan laporan tidak membebani proses utama.
 */
@Injectable()
export class PeriodicReportsService {
  private readonly logger = new Logger(PeriodicReportsService.name);

  constructor(
    private readonly redis: RedisService,
    @InjectQueue(PERIODIC_QUEUE) private readonly queue: Queue,
  ) {}

  @Cron('0 18 * * 0', { name: 'weekly-parent-reports', timeZone: 'Asia/Jakarta' })
  weeklyCron(): Promise<DispatchResult> {
    this.logger.log('Cron: ringkasan mingguan orang tua');
    return this.runWeekly(new Date());
  }

  @Cron('0 6 1 * *', { name: 'monthly-parent-reports', timeZone: 'Asia/Jakarta' })
  monthlyCron(): Promise<DispatchResult> {
    this.logger.log('Cron: ringkasan bulanan orang tua');
    return this.runMonthly(new Date());
  }

  runWeekly(now: Date, opts: { force?: boolean } = {}): Promise<DispatchResult> {
    return this.dispatch(weeklyWindow(now), opts);
  }

  runMonthly(now: Date, opts: { force?: boolean } = {}): Promise<DispatchResult> {
    return this.dispatch(monthlyWindow(now), opts);
  }

  run(type: PeriodType, now: Date, opts: { force?: boolean } = {}): Promise<DispatchResult> {
    return type === 'weekly' ? this.runWeekly(now, opts) : this.runMonthly(now, opts);
  }

  private async dispatch(
    window: PeriodWindow,
    opts: { force?: boolean },
  ): Promise<DispatchResult> {
    // Run-guard: satu periode hanya dijadwalkan sekali (kecuali `force`).
    if (!opts.force) {
      const acquired = await this.redis.client
        .set(`periodic:lock:${window.key}`, '1', 'EX', LOCK_TTL_SECONDS, 'NX')
        .catch((err: Error) => {
          this.logger.warn(`Lock periodik gagal (${window.key}): ${err.message}`);
          return 'OK'; // Redis bermasalah → jangan blokir; idempotensi hilir tetap menjaga.
        });
      if (acquired !== 'OK') {
        this.logger.log(`Periode ${window.key} sudah dijadwalkan sebelumnya — dilewati.`);
        return { key: window.key, window, enqueued: false, skipped: true };
      }
    }

    // Scheduled run → jobId deterministik (idempoten: cron dobel tidak menggandakan
    // pekerjaan). Forced run (ops / uji ulang) → jobId unik agar benar-benar jalan
    // lagi; idempotensi tetap dijaga `dedupeKey` di hilir (`notify-user`).
    const runId = opts.force ? String(Date.now()) : null;
    const suffix = runId ? `_${runId}` : '';
    await this.queue.add(
      JOB_PERIODIC_FANOUT,
      { window, runId },
      { jobId: `periodic_fanout_${keySafe(window.key)}${suffix}` },
    );
    this.logger.log(`Fan-out laporan ${window.type} untuk periode ${window.label} di-enqueue.`);
    return { key: window.key, window, enqueued: true };
  }
}
