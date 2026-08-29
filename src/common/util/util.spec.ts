import { describe, expect, it } from 'vitest';

import { definedKeys } from './defined-keys.js';
import { generateQrToken } from './qr-token.js';
import {
  formatTimeOfDay,
  isValidHHmm,
  minutesOfDay,
  parseTimeOfDay,
} from './time-of-day.js';

describe('generateQrToken', () => {
  it('menghasilkan token acak base64url, tidak berulang, muat di VARCHAR(64)', () => {
    const a = generateQrToken();
    const b = generateQrToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a.length).toBeLessThanOrEqual(64);
    expect(a.length).toBeGreaterThanOrEqual(32);
  });
});

describe('definedKeys', () => {
  it('hanya mengembalikan properti yang tidak undefined', () => {
    expect(definedKeys({ a: 1, b: undefined, c: null, d: '' })).toEqual(['a', 'c', 'd']);
  });
});

describe('time-of-day', () => {
  it('isValidHHmm', () => {
    expect(isValidHHmm('00:00')).toBe(true);
    expect(isValidHHmm('23:59')).toBe(true);
    expect(isValidHHmm('24:00')).toBe(false);
    expect(isValidHHmm('7:00')).toBe(false);
  });

  it('parse + format round-trip', () => {
    expect(formatTimeOfDay(parseTimeOfDay('15:30'))).toBe('15:30');
    expect(formatTimeOfDay(parseTimeOfDay('06:05'))).toBe('06:05');
  });

  it('parseTimeOfDay menolak format salah', () => {
    expect(() => parseTimeOfDay('9am')).toThrow();
  });

  it('minutesOfDay untuk perbandingan overlap', () => {
    expect(minutesOfDay('15:00')).toBe(900);
    expect(minutesOfDay('16:30')).toBe(990);
    // overlap: A(15:00-16:30) vs B(16:00-17:00) -> s<oe && e>os
    const s = minutesOfDay('16:00');
    const e = minutesOfDay('17:00');
    const os = minutesOfDay('15:00');
    const oe = minutesOfDay('16:30');
    expect(s < oe && e > os).toBe(true);
    // no overlap: C(16:30-17:30) vs A -> boundary touch, tidak dianggap bentrok
    const s2 = minutesOfDay('16:30');
    expect(s2 < oe).toBe(false);
  });
});
