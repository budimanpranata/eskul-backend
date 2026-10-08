import { Body, Controller, Get, Ip, Param, ParseUUIDPipe, Put, Query } from '@nestjs/common';

import { Audit } from '../../common/decorators/audit.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { tenantScope, type AuthenticatedUser } from '../../common/types/authenticated-user.js';
import { ApproveRelationDto, ListRelationsQueryDto } from './dto/parent.dto.js';
import { ParentsService } from './parents.service.js';

/**
 * Persetujuan relasi ortu–siswa untuk Admin (dokumen desain 4.3).
 * Versi minimal untuk Fase 1.4; notifikasi & deteksi kecurigaan menyusul di Fase 2.4.
 */
@Roles('ADMIN')
@Controller('admin/parent-relations')
export class AdminParentRelationsController {
  constructor(private readonly parents: ParentsService) {}

  @Get()
  @Audit({ action: 'LIST_PARENT_RELATIONS', entityType: 'parent_student_relation', captureQuery: ['status'] })
  list(@Query() query: ListRelationsQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.parents.listRelations(query.status, query.page, query.pageSize, tenantScope(user));
  }

  @Put(':id/approve')
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApproveRelationDto,
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
  ) {
    return this.parents.decideRelation(id, dto, { userId: user.id, ip: ip ?? null }, tenantScope(user));
  }
}
