import { Body, Controller, Get, Ip, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import type { AuthenticatedUser } from '../../common/types/authenticated-user.js';
import {
  CreateSchoolAdminDto,
  CreateSchoolDto,
  ListSchoolsQueryDto,
  UpdateSchoolDto,
} from './dto/school.dto.js';
import { SchoolsService } from './schools.service.js';

/**
 * Pendaftaran & pengelolaan sekolah (tenant) — khusus ADMIN_SUPER (operator
 * platform). ADMIN biasa tidak bisa melihat/mengelola sekolah lain lewat
 * endpoint ini (lihat `roleSatisfies` — `@Roles('ADMIN_SUPER')` TIDAK lolos
 * untuk ADMIN biasa, berbeda dari kebanyakan controller `/admin/*` lain).
 */
@Roles('ADMIN_SUPER')
@Controller('admin/schools')
export class SchoolsController {
  constructor(private readonly schools: SchoolsService) {}

  @Get()
  list(@Query() query: ListSchoolsQueryDto) {
    return this.schools.list(query);
  }

  @Get(':id')
  getOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.schools.getById(id);
  }

  @Post()
  create(@Body() dto: CreateSchoolDto, @CurrentUser() user: AuthenticatedUser, @Ip() ip: string) {
    return this.schools.create(dto, { id: user.id, ip: ip ?? null });
  }

  @Put(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSchoolDto,
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
  ) {
    return this.schools.update(id, dto, { id: user.id, ip: ip ?? null });
  }

  @Post(':id/suspend')
  suspend(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser, @Ip() ip: string) {
    return this.schools.suspend(id, { id: user.id, ip: ip ?? null });
  }

  @Post(':id/resume')
  resume(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser, @Ip() ip: string) {
    return this.schools.resume(id, { id: user.id, ip: ip ?? null });
  }

  @Post(':id/admins')
  addAdmin(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateSchoolAdminDto,
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
  ) {
    return this.schools.addAdmin(id, dto, { id: user.id, ip: ip ?? null });
  }
}
