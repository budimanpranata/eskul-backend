import {
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import type { AuthenticatedUser } from '../../common/types/authenticated-user.js';
import { AttendanceService } from './attendance.service.js';

/** Endpoint pendukung aplikasi Pembina (dokumen desain bagian 4.3). */
@Roles('PEMBINA')
@Controller('coach')
export class CoachController {
  constructor(private readonly attendance: AttendanceService) {}

  @Get('today-sessions')
  today(@CurrentUser() user: AuthenticatedUser) {
    return this.attendance.todaySessions(user.id);
  }

  @Get('extracurriculars/:id/roster')
  roster(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.attendance.roster(user.id, id);
  }

  @Get('sessions')
  history(
    @CurrentUser() user: AuthenticatedUser,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.attendance.history(user.id, Math.min(Math.max(limit, 1), 100));
  }
}
