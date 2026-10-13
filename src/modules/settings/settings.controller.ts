import { Controller, Get, Header, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';

import { Public } from '../../common/decorators/public.decorator.js';
import { SettingsService } from './settings.service.js';

/** Pengaturan tampilan aplikasi — endpoint publik (dipanggil sebelum login). */
@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Public()
  @Get('branding')
  getBranding() {
    return this.settings.getBranding();
  }

  @Public()
  @Get('branding/logo')
  @Header('Cache-Control', 'public, max-age=3600')
  async logo(@Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    const { buffer, contentType } = await this.settings.getLogoBuffer();
    res.set({ 'Content-Type': contentType, 'Content-Length': String(buffer.length) });
    return new StreamableFile(buffer);
  }
}
