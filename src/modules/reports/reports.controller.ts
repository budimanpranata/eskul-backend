import {
  Controller,
  Get,
  Header,
  HttpCode,
  Ip,
  Param,
  ParseUUIDPipe,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';

import { Audit } from '../../common/decorators/audit.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { PaginationQueryDto } from '../../common/dto/pagination.dto.js';
import { tenantScope, type AuthenticatedUser } from '../../common/types/authenticated-user.js';
import {
  ReportExportQueryDto,
  ReportPreviewQueryDto,
} from './dto/report-query.dto.js';
import { ReportsService } from './reports.service.js';

/**
 * Export laporan kehadiran/rapor PDF/Excel (dokumen desain 4 / 5.3). Fase 3.1.
 *
 * Semua endpoint butuh role ADMIN, KECUALI `GET downloads/:id` yang `@Public()`
 * dan diamankan oleh signature HMAC + kedaluwarsa pada URL-nya.
 */
@Controller('admin/reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  /** Preview tabel data sebelum export. */
  @Roles('ADMIN')
  @Get('attendance/preview')
  @Audit({
    action: 'PREVIEW_REPORT',
    entityType: 'report',
    captureQuery: ['classGrade', 'extracurricularId', 'dateFrom', 'dateTo'],
  })
  preview(@Query() query: ReportPreviewQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.reports.preview(query, tenantScope(user));
  }

  /** Kontrak §4: memicu job export ASINKRON. Balas 202 + resource status. */
  @Roles('ADMIN')
  @Get('attendance')
  @HttpCode(202)
  requestExport(
    @Query() query: ReportExportQueryDto,
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
  ) {
    return this.reports.requestExport(query, { userId: user.id, ip: ip ?? null }, tenantScope(user));
  }

  /** Riwayat permintaan export (+ signed downloadUrl bila sudah siap). */
  @Roles('ADMIN')
  @Get('exports')
  listExports(@Query() query: PaginationQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.reports.listExports(query, tenantScope(user));
  }

  /** Status satu permintaan export (dipakai polling web admin). */
  @Roles('ADMIN')
  @Get('exports/:id')
  getExport(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.reports.getExport(id, tenantScope(user));
  }

  /** Unduh file — hanya lewat signed URL yang valid & belum kedaluwarsa. */
  @Public()
  @Get('downloads/:id')
  @Audit({ action: 'DOWNLOAD_REPORT', entityType: 'report_export', entityIdParam: 'id' })
  @Header('Cache-Control', 'no-store')
  async download(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('expires') expires: string,
    @Query('sig') sig: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { buffer, fileName, contentType } = await this.reports.resolveDownload(
      id,
      Number(expires),
      sig ?? '',
    );
    res.set({
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Content-Length': String(buffer.length),
    });
    return new StreamableFile(buffer);
  }
}
