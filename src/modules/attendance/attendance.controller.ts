import { Body, Controller, HttpCode, Ip, Post, UseFilters } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import type { AuthenticatedUser } from '../../common/types/authenticated-user.js';
import { AttendanceService } from './attendance.service.js';
import { SubmitAttendanceDto } from './dto/submit-attendance.dto.js';
import { Validation422Filter } from './validation-422.filter.js';

/** Presensi + materi latihan (Pembina). Kontrak: dokumen desain bagian 4.1. */
@Roles('PEMBINA')
@Controller('attendance')
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Post('submit')
  @HttpCode(201)
  @UseFilters(Validation422Filter) // 400 validasi -> 422 sesuai kontrak
  submit(
    @Body() dto: SubmitAttendanceDto,
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
  ) {
    return this.attendance.submit(dto, { userId: user.id, ip: ip ?? null });
  }
}
