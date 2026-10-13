import { Body, Controller, Ip, Put, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import type { AuthenticatedUser } from '../../common/types/authenticated-user.js';
import type { UploadedFile as UploadedLogoFile } from '../../common/types/uploaded-file.js';
import { UpdateBrandingDto } from './dto/settings.dto.js';
import { SettingsService } from './settings.service.js';

/**
 * Pengaturan tampilan aplikasi (nama + logo di layar login) — khusus
 * ADMIN_SUPER. Platform-wide, bukan per-sekolah (lihat catatan di service).
 */
@Roles('ADMIN_SUPER')
@Controller('admin/settings')
export class SettingsAdminController {
  constructor(private readonly settings: SettingsService) {}

  @Put('branding')
  @UseInterceptors(FileInterceptor('logo', { limits: { fileSize: 2 * 1024 * 1024 } }))
  update(
    @Body() dto: UpdateBrandingDto,
    @UploadedFile() file: UploadedLogoFile | undefined,
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
  ) {
    return this.settings.updateBranding(dto, file, { id: user.id, ip: ip ?? null });
  }
}
