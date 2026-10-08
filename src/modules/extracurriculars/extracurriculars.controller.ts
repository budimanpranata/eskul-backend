import {
  Body,
  Controller,
  Delete,
  Get,
  Ip,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';

import { Audit } from '../../common/decorators/audit.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { PaginationQueryDto } from '../../common/dto/pagination.dto.js';
import { tenantScope, type AuthenticatedUser } from '../../common/types/authenticated-user.js';
import {
  AddMembersDto,
  CreateExtracurricularDto,
  CreateScheduleDto,
  ListExtracurricularsQueryDto,
  UpdateExtracurricularDto,
  UpdateScheduleDto,
} from './dto/extracurricular.dto.js';
import { ExtracurricularsService } from './extracurriculars.service.js';

/** Ekskul + jadwal + keanggotaan — khusus role ADMIN. */
@Roles('ADMIN')
@Controller('admin/extracurriculars')
export class ExtracurricularsController {
  constructor(private readonly ekskul: ExtracurricularsService) {}

  private actor(user: AuthenticatedUser, ip: string) {
    return { id: user.id, ip: ip ?? null, schoolId: tenantScope(user) };
  }

  // --- ekskul ---
  @Get()
  list(@Query() query: ListExtracurricularsQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.ekskul.list(query, tenantScope(user));
  }

  /** Daftar ringkas ekskul aktif — di-cache Redis (Fase 4.4). Untuk dropdown filter. */
  @Get('catalog')
  catalog(@CurrentUser() user: AuthenticatedUser) {
    return this.ekskul.activeCatalog(tenantScope(user));
  }

  @Get(':id')
  getOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.ekskul.getById(id, tenantScope(user));
  }

  @Post()
  create(
    @Body() dto: CreateExtracurricularDto,
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
  ) {
    return this.ekskul.create(dto, this.actor(user, ip));
  }

  @Put(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateExtracurricularDto,
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
  ) {
    return this.ekskul.update(id, dto, this.actor(user, ip));
  }

  @Delete(':id')
  deactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
  ) {
    return this.ekskul.deactivate(id, this.actor(user, ip));
  }

  @Post(':id/reactivate')
  reactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
  ) {
    return this.ekskul.reactivate(id, this.actor(user, ip));
  }

  // --- jadwal ---
  @Post(':id/schedules')
  addSchedule(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateScheduleDto,
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
  ) {
    return this.ekskul.addSchedule(id, dto, this.actor(user, ip));
  }

  @Put(':id/schedules/:scheduleId')
  updateSchedule(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('scheduleId', ParseUUIDPipe) scheduleId: string,
    @Body() dto: UpdateScheduleDto,
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
  ) {
    return this.ekskul.updateSchedule(id, scheduleId, dto, this.actor(user, ip));
  }

  @Delete(':id/schedules/:scheduleId')
  removeSchedule(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('scheduleId', ParseUUIDPipe) scheduleId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
  ) {
    return this.ekskul.removeSchedule(id, scheduleId, this.actor(user, ip));
  }

  // --- anggota ---
  @Get(':id/members')
  @Audit({ action: 'VIEW_EXTRACURRICULAR_ROSTER', entityType: 'extracurricular', entityIdParam: 'id' })
  listMembers(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: PaginationQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.ekskul.listMembers(id, q.page, q.pageSize, tenantScope(user));
  }

  @Post(':id/members')
  addMembers(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddMembersDto,
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
  ) {
    return this.ekskul.addMembers(id, dto, this.actor(user, ip));
  }

  @Delete(':id/members/:studentId')
  removeMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
  ) {
    return this.ekskul.removeMember(id, studentId, this.actor(user, ip));
  }
}
