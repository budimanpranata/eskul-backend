import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  HttpCode,
  Ip,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';

import { Audit } from '../../common/decorators/audit.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import type { AuthenticatedUser } from '../../common/types/authenticated-user.js';
import { AttendanceService } from './attendance.service.js';
import { QrScanDto } from './dto/qr-scan.dto.js';

/** Endpoint pendukung aplikasi Pembina (dokumen desain bagian 4.3). */
@Roles('PEMBINA')
@Controller('coach')
export class CoachController {
  constructor(private readonly attendance: AttendanceService) {}

  @Get('summary')
  summary(@CurrentUser() user: AuthenticatedUser) {
    return this.attendance.summary(user.id);
  }

  @Get('today-sessions')
  today(@CurrentUser() user: AuthenticatedUser) {
    return this.attendance.todaySessions(user.id);
  }

  @Get('extracurriculars/:id/roster')
  @Audit({ action: 'VIEW_EXTRACURRICULAR_ROSTER', entityType: 'extracurricular', entityIdParam: 'id' })
  roster(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.attendance.roster(user.id, id);
  }

  @Post('students/qr-scan')
  @HttpCode(200)
  qrScan(
    @Body() dto: QrScanDto,
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
  ) {
    return this.attendance.resolveQrScan(user.id, dto.qr_token, dto.extracurricular_id, ip ?? null);
  }

  @Get('sessions')
  history(
    @CurrentUser() user: AuthenticatedUser,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.attendance.history(user.id, Math.min(Math.max(limit, 1), 100));
  }
}
