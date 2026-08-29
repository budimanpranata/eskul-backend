import type { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';

import { ReportSigner } from './report-signer.js';

const cfg = (over: Record<string, unknown> = {}): ConfigService =>
  ({
    get: (k: string) =>
      ({
        'reports.signingSecret': 'test-secret',
        'reports.signedUrlTtlSeconds': 3600,
        ...over,
      })[k],
  }) as unknown as ConfigService;

describe('ReportSigner', () => {
  it('buildDownloadPath menghasilkan path + sig + expires yang bisa diverifikasi', () => {
    const s = new ReportSigner(cfg());
    const now = new Date('2026-08-29T10:00:00Z');
    const { path, expiresAt } = s.buildDownloadPath('exp-1', now);

    expect(expiresAt.getTime()).toBe(now.getTime() + 3600_000);
    const url = new URL('http://x' + path);
    const expires = Number(url.searchParams.get('expires'));
    const sig = url.searchParams.get('sig')!;
    expect(s.verify('exp-1', expires, sig, now)).toBe(true);
  });

  it('menolak signature yang dirusak', () => {
    const s = new ReportSigner(cfg());
    const now = new Date('2026-08-29T10:00:00Z');
    const { path } = s.buildDownloadPath('exp-1', now);
    const url = new URL('http://x' + path);
    const expires = Number(url.searchParams.get('expires'));
    expect(s.verify('exp-1', expires, 'not-the-real-sig', now)).toBe(false);
  });

  it('menolak exportId lain dengan signature yang sama', () => {
    const s = new ReportSigner(cfg());
    const now = new Date('2026-08-29T10:00:00Z');
    const { path } = s.buildDownloadPath('exp-1', now);
    const url = new URL('http://x' + path);
    const expires = Number(url.searchParams.get('expires'));
    const sig = url.searchParams.get('sig')!;
    expect(s.verify('exp-2', expires, sig, now)).toBe(false);
  });

  it('menolak URL yang sudah kedaluwarsa', () => {
    const s = new ReportSigner(cfg());
    const issued = new Date('2026-08-29T10:00:00Z');
    const { path } = s.buildDownloadPath('exp-1', issued);
    const url = new URL('http://x' + path);
    const expires = Number(url.searchParams.get('expires'));
    const sig = url.searchParams.get('sig')!;
    const later = new Date(issued.getTime() + 3600_000 + 1000);
    expect(s.verify('exp-1', expires, sig, later)).toBe(false);
  });

  it('secret berbeda → signature tidak kompatibel', () => {
    const now = new Date('2026-08-29T10:00:00Z');
    const a = new ReportSigner(cfg());
    const b = new ReportSigner(cfg({ 'reports.signingSecret': 'other-secret' }));
    const { path } = a.buildDownloadPath('exp-1', now);
    const url = new URL('http://x' + path);
    const expires = Number(url.searchParams.get('expires'));
    const sig = url.searchParams.get('sig')!;
    expect(b.verify('exp-1', expires, sig, now)).toBe(false);
  });
});
