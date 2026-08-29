export type PeriodType = 'weekly' | 'monthly';

export interface PeriodWindow {
  type: PeriodType;
  /** kunci unik & stabil untuk idempotensi, mis. `weekly:2026-08-24` / `monthly:2026-07`. */
  key: string;
  /** rentang inklusif, `YYYY-MM-DD`. */
  from: string;
  to: string;
  /** label ramah manusia untuk isi notifikasi. */
  label: string;
  /** hanya untuk monthly: rentang bulan sebelumnya (untuk hitung tren). */
  prev?: { from: string; to: string; key: string; label: string };
}

const ID_MONTHS = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];
const ID_MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

/** Bagian tanggal (y, m 1-12, d) untuk `now` pada zona Asia/Jakarta. */
export function jakartaParts(now: Date): { y: number; m: number; d: number } {
  const s = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' }); // YYYY-MM-DD
  const [y, m, d] = s.split('-').map(Number);
  return { y, m, d };
}

function ymd(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function addDays(dateStr: string, delta: number): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** 1=Senin ... 7=Minggu untuk `YYYY-MM-DD`. */
function isoDow(dateStr: string): number {
  const n = new Date(`${dateStr}T00:00:00.000Z`).getUTCDay();
  return n === 0 ? 7 : n;
}

function lastDayOfMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate(); // m = 1-12 → hari 0 bulan berikutnya
}

/**
 * Minggu (Senin–Minggu) yang sedang berjalan / berakhir pada `now`.
 * Cron menembak Minggu 18:00 → ringkasan untuk Senin s/d hari ini (Minggu).
 */
export function weeklyWindow(now: Date): PeriodWindow {
  const { y, m, d } = jakartaParts(now);
  const today = ymd(y, m, d);
  const monday = addDays(today, -(isoDow(today) - 1));
  const sunday = addDays(monday, 6);
  const [my, mm, md] = monday.split('-').map(Number);
  const [, , sd] = sunday.split('-').map(Number);
  const label =
    mm === Number(sunday.split('-')[1])
      ? `${md}–${sd} ${ID_MONTHS_SHORT[mm - 1]} ${my}`
      : `${md} ${ID_MONTHS_SHORT[mm - 1]} – ${sd} ${ID_MONTHS_SHORT[Number(sunday.split('-')[1]) - 1]} ${my}`;
  return { type: 'weekly', key: `weekly:${monday}`, from: monday, to: sunday, label };
}

/**
 * Bulan kalender **sebelumnya** relatif `now`. Cron menembak tanggal 1 → ringkasan
 * untuk bulan yang baru saja selesai, plus rentang bulan sebelum-nya untuk tren.
 */
export function monthlyWindow(now: Date): PeriodWindow {
  const { y, m } = jakartaParts(now);
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  const from = ymd(py, pm, 1);
  const to = ymd(py, pm, lastDayOfMonth(py, pm));

  const ppy = pm === 1 ? py - 1 : py;
  const ppm = pm === 1 ? 12 : pm - 1;
  const prevFrom = ymd(ppy, ppm, 1);
  const prevTo = ymd(ppy, ppm, lastDayOfMonth(ppy, ppm));

  return {
    type: 'monthly',
    key: `monthly:${py}-${String(pm).padStart(2, '0')}`,
    from,
    to,
    label: `${ID_MONTHS[pm - 1]} ${py}`,
    prev: {
      from: prevFrom,
      to: prevTo,
      key: `monthly:${ppy}-${String(ppm).padStart(2, '0')}`,
      label: `${ID_MONTHS[ppm - 1]} ${ppy}`,
    },
  };
}

export type Trend = 'naik' | 'turun' | 'stabil';

/** Bandingkan dua persentase kehadiran; ambang ±5 poin dianggap "stabil". */
export function classifyTrend(current: number, previous: number | null): Trend {
  if (previous == null) return 'stabil';
  const diff = current - previous;
  if (diff > 5) return 'naik';
  if (diff < -5) return 'turun';
  return 'stabil';
}

/** Aman dipakai sebagai bagian jobId BullMQ (tak boleh mengandung `:`). */
export function keySafe(key: string): string {
  return key.replace(/[:]/g, '_');
}
