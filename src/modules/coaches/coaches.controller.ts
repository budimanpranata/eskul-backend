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
import { tenantScope, type AuthenticatedUser } from '../../common/types/authenticated-user.js';
import { CoachesService } from './coaches.service.js';
import { CreateCoachDto } from './dto/create-coach.dto.js';
import { ListCoachesQueryDto } from './dto/list-coaches-query.dto.js';
import { UpdateCoachDto } from './dto/update-coach.dto.js';

/** Data master guru pembina — khusus role ADMIN. */
@Roles('ADMIN')
@Controller('admin/coaches')
export class CoachesController {
  constructor(private readonly coaches: CoachesService) {}

  @Get()
  @Audit({ action: 'LIST_COACHES', entityType: 'coach', captureQuery: ['search', 'isActive'] })
  list(@Query() query: ListCoachesQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.coaches.list(query, tenantScope(user));
  }

  @Get(':id')
  @Audit({ action: 'VIEW_COACH_DATA', entityType: 'coach', entityIdParam: 'id' })
  getOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.coaches.getById(id, tenantScope(user));
  }

  @Post()
  create(@Body() dto: CreateCoachDto, @CurrentUser() user: AuthenticatedUser, @Ip() ip: string) {
    return this.coaches.create(dto, { id: user.id, ip: ip ?? null, schoolId: tenantScope(user) });
  }

  @Put(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCoachDto,
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
  ) {
    return this.coaches.update(id, dto, { id: user.id, ip: ip ?? null, schoolId: tenantScope(user) });
  }

  @Delete(':id')
  deactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
  ) {
    return this.coaches.deactivate(id, { id: user.id, ip: ip ?? null, schoolId: tenantScope(user) });
  }

  @Post(':id/reactivate')
  reactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
  ) {
    return this.coaches.reactivate(id, { id: user.id, ip: ip ?? null, schoolId: tenantScope(user) });
  }
}
