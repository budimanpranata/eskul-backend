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

import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import type { AuthenticatedUser } from '../../common/types/authenticated-user.js';
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
  list(@Query() query: ListCoachesQueryDto) {
    return this.coaches.list(query);
  }

  @Get(':id')
  getOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.coaches.getById(id);
  }

  @Post()
  create(@Body() dto: CreateCoachDto, @CurrentUser() user: AuthenticatedUser, @Ip() ip: string) {
    return this.coaches.create(dto, { id: user.id, ip: ip ?? null });
  }

  @Put(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCoachDto,
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
  ) {
    return this.coaches.update(id, dto, { id: user.id, ip: ip ?? null });
  }

  @Delete(':id')
  deactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
  ) {
    return this.coaches.deactivate(id, { id: user.id, ip: ip ?? null });
  }

  @Post(':id/reactivate')
  reactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
  ) {
    return this.coaches.reactivate(id, { id: user.id, ip: ip ?? null });
  }
}
