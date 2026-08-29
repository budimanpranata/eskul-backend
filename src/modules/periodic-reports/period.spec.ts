import { describe, expect, it } from 'vitest';

import { classifyTrend, keySafe, monthlyWindow, weeklyWindow } from './period.js';

// 18:00 WIB = 11:00 UTC
const wib = (iso: string) => new Date(iso);

describe('weeklyWindow', () => {
  it('Minggu 18:00 → Senin s/d Minggu minggu berjalan', () => {
    const w = weeklyWindow(wib('2026-08-30T11:00:00.000Z')); // Minggu 30 Agu, 18:00 WIB
    expect(w).toMatchObject({
      type: 'weekly',
      key: 'weekly:2026-08-24',
      from: '2026-08-24',
      to: '2026-08-30',
    });
    expect(w.label).toContain('Agu');
  });

  it('pergantian bulan di tengah minggu tetap konsisten', () => {
    const w = weeklyWindow(wib('2026-11-01T11:00:00.000Z')); // Minggu 1 Nov
    expect(w.from).toBe('2026-10-26');
    expect(w.to).toBe('2026-11-01');
    expect(w.key).toBe('weekly:2026-10-26');
  });
});

describe('monthlyWindow', () => {
  it('tanggal 1 → bulan kalender sebelumnya + rentang bulan sebelum-nya untuk tren', () => {
    const w = monthlyWindow(wib('2026-09-01T00:00:00.000Z'));
    expect(w).toMatchObject({ type: 'monthly', key: 'monthly:2026-08', from: '2026-08-01', to: '2026-08-31' });
    expect(w.label).toBe('Agustus 2026');
    expect(w.prev).toMatchObject({ key: 'monthly:2026-07', from: '2026-07-01', to: '2026-07-31' });
  });

  it('1 Januari → bulan Desember tahun sebelumnya', () => {
    const w = monthlyWindow(wib('2026-01-01T00:00:00.000Z'));
    expect(w.key).toBe('monthly:2025-12');
    expect(w.from).toBe('2025-12-01');
    expect(w.to).toBe('2025-12-31');
    expect(w.prev?.key).toBe('monthly:2025-11');
  });

  it('menghitung hari terakhir bulan dengan benar (Feb non-kabisat)', () => {
    const w = monthlyWindow(wib('2026-03-01T00:00:00.000Z'));
    expect(w.to).toBe('2026-02-28');
  });
});

describe('classifyTrend', () => {
  it('selisih > +5 → naik, < -5 → turun, di antaranya → stabil', () => {
    expect(classifyTrend(80, 70)).toBe('naik');
    expect(classifyTrend(70, 80)).toBe('turun');
    expect(classifyTrend(72, 70)).toBe('stabil');
    expect(classifyTrend(65, 70)).toBe('stabil');
  });
  it('tanpa data pembanding → stabil', () => {
    expect(classifyTrend(90, null)).toBe('stabil');
  });
});

describe('keySafe', () => {
  it('mengganti ":" agar aman jadi jobId BullMQ', () => {
    expect(keySafe('weekly:2026-08-24')).toBe('weekly_2026-08-24');
    expect(keySafe('monthly:2026-08')).toBe('monthly_2026-08');
  });
});
