import { Body, Controller, Get, Ip, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';

import { Audit } from '../../common/decorators/audit.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { RateLimit } from '../../common/decorators/rate-limit.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import type { AuthenticatedUser } from '../../common/types/authenticated-user.js';
import { ChildProgressQueryDto, LinkRequestDto } from './dto/parent.dto.js';
import { ParentsService } from './parents.service.js';

/** Aplikasi Orang Tua (dokumen desain bagian 4.2 & 4.3). */
@Roles('ORANGTUA')
@Controller('parent')
export class ParentsController {
  constructor(private readonly parents: ParentsService) {}

  @Get('children')
  @Audit({ action: 'LIST_LINKED_CHILDREN', entityType: 'student' })
  children(@CurrentUser() user: AuthenticatedUser) {
    return this.parents.children(user.id);
  }

  // Batasi enumerasi NIS (walau sudah ada verifikasi nama + cooldown 24 jam per relasi).
  @RateLimit({ limit: 12, windowSeconds: 600, scope: 'parent:link-request' })
  @Post('link-request')
  linkRequest(
    @Body() dto: LinkRequestDto,
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
  ) {
    return this.parents.linkRequest(dto, { userId: user.id, ip: ip ?? null });
  }

  @Get('child-progress/:studentId')
  childProgress(
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Query() query: ChildProgressQueryDto,
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
  ) {
    return this.parents.childProgress(studentId, query, { userId: user.id, ip: ip ?? null });
  }
}
