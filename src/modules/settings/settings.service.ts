import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { UploadedFile } from '../../common/types/uploaded-file.js';
import type { ReportStorage } from '../reports/storage/report-storage.js';
import { BRANDING_LOGO_STORAGE } from './storage/branding-logo-storage.factory.js';
import type { UpdateBrandingDto } from './dto/settings.dto.js';

const SETTINGS_ID = 'default';
export const DEFAULT_APP_NAME = 'Eskul';

const MAX_LOGO_SIZE = 2 * 1024 * 1024; // 2 MB
const ALLOWED_LOGO_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};

interface Actor {
  id: string;
  ip: string | null;
}

/**
 * Pengaturan tampilan aplikasi (nama + logo di layar login) — singleton
 * platform-wide, dikelola ADMIN_SUPER. Kosong/NULL → klien (web admin & mobile)
 * pakai fallback bawaan masing-masing (nama 'Eskul', logo default di aset app).
 */
@Injectable()
export class SettingsService {
  private readonly apiPrefix: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    @Inject(BRANDING_LOGO_STORAGE) private readonly storage: ReportStorage,
  ) {
    this.apiPrefix = (this.config.get<string>('apiPrefix') ?? 'api/v1').replace(/^\/|\/$/g, '');
  }

  /** GET /settings/branding — `@Public()`, dipanggil sebelum login. */
  async getBranding(): Promise<{ appName: string; logoUrl: string | null }> {
    const row = await this.prisma.appSettings.findUnique({ where: { id: SETTINGS_ID } });
    return {
      appName: row?.appName?.trim() || DEFAULT_APP_NAME,
      logoUrl: row?.logoKey ? this.buildLogoUrl(row.updatedAt.getTime()) : null,
    };
  }

  /** PUT /admin/settings/branding — ADMIN_SUPER. */
  async updateBranding(dto: UpdateBrandingDto, file: UploadedFile | undefined, actor: Actor) {
    const previous = await this.prisma.appSettings.findUnique({ where: { id: SETTINGS_ID } });

    let logoKey: string | undefined;
    if (file) {
      const ext = ALLOWED_LOGO_MIME[file.mimetype];
      if (!ext) throw new BadRequestException('Format logo harus PNG/JPEG/WebP/SVG.');
      if (file.size > MAX_LOGO_SIZE) throw new BadRequestException('Ukuran logo maksimal 2 MB.');
      logoKey = `branding/logo-${Date.now()}.${ext}`;
      await this.storage.put(logoKey, file.buffer, file.mimetype);
    }

    const appName = dto.appName !== undefined ? dto.appName.trim() || null : undefined;

    const updated = await this.prisma.appSettings.upsert({
      where: { id: SETTINGS_ID },
      update: {
        ...(appName !== undefined ? { appName } : {}),
        ...(logoKey !== undefined ? { logoKey } : {}),
        updatedById: actor.id,
      },
      create: {
        id: SETTINGS_ID,
        appName: appName ?? null,
        logoKey: logoKey ?? null,
        updatedById: actor.id,
      },
    });

    await this.audit.log({
      userId: actor.id,
      action: 'UPDATE_APP_SETTINGS',
      entityType: 'app_settings',
      entityId: null,
      ipAddress: actor.ip,
      metadata: { appName: updated.appName, logoChanged: logoKey !== undefined },
    });

    // Best-effort: buang file logo lama agar tidak menumpuk di disk.
    if (logoKey !== undefined && previous?.logoKey && previous.logoKey !== logoKey) {
      await this.storage.remove(previous.logoKey).catch(() => undefined);
    }

    return {
      appName: updated.appName?.trim() || DEFAULT_APP_NAME,
      logoUrl: updated.logoKey ? this.buildLogoUrl(updated.updatedAt.getTime()) : null,
    };
  }

  /** GET /settings/branding/logo — `@Public()`, stream bytes logo saat ini. */
  async getLogoBuffer(): Promise<{ buffer: Buffer; contentType: string }> {
    const row = await this.prisma.appSettings.findUnique({ where: { id: SETTINGS_ID } });
    if (!row?.logoKey) throw new NotFoundException('Logo belum diatur.');
    const buffer = await this.storage.get(row.logoKey);
    const ext = row.logoKey.split('.').pop() ?? 'png';
    return { buffer, contentType: mimeForExt(ext) };
  }

  /** `?v=` cache-busting berdasarkan waktu update — browser tak perlu nunggu TTL cache lama. */
  private buildLogoUrl(updatedAtMs: number): string {
    return `/${this.apiPrefix}/settings/branding/logo?v=${updatedAtMs}`;
  }
}

function mimeForExt(ext: string): string {
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'svg') return 'image/svg+xml';
  return 'image/jpeg';
}
