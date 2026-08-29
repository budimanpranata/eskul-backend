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

import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { PaginationQueryDto } from '../../common/dto/pagination.dto.js';
import type { AuthenticatedUser } from '../../common/types/authenticated-user.js';
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
  preview(@Query() query: ReportPreviewQueryDto) {
    return this.reports.preview(query);
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
    return this.reports.requestExport(query, { userId: user.id, ip: ip ?? null });
  }

  /** Riwayat permintaan export (+ signed downloadUrl bila sudah siap). */
  @Roles('ADMIN')
  @Get('exports')
  listExports(@Query() query: PaginationQueryDto) {
    return this.reports.listExports(query);
  }

  /** Status satu permintaan export (dipakai polling web admin). */
  @Roles('ADMIN')
  @Get('exports/:id')
  getExport(@Param('id', ParseUUIDPipe) id: string) {
    return this.reports.getExport(id);
  }

  /** Unduh file — hanya lewat signed URL yang valid & belum kedaluwarsa. */
  @Public()
  @Get('downloads/:id')
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
