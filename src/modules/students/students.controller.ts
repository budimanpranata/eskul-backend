import {
  BadRequestException,
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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import { Audit } from '../../common/decorators/audit.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { tenantScope, type AuthenticatedUser } from '../../common/types/authenticated-user.js';
import type { UploadedFile as UploadedExcelFile } from '../../common/types/uploaded-file.js';
import { CreateStudentDto } from './dto/create-student.dto.js';
import { ListStudentsQueryDto } from './dto/list-students-query.dto.js';
import { UpdateStudentDto } from './dto/update-student.dto.js';
import { StudentsService } from './students.service.js';

/** Data master siswa — semua endpoint khusus role ADMIN (dokumen desain bagian 2.3 AD-01). */
@Roles('ADMIN')
@Controller('admin/students')
export class StudentsController {
  constructor(private readonly students: StudentsService) {}

  @Get()
  @Audit({
    action: 'LIST_STUDENTS',
    entityType: 'student',
    captureQuery: ['search', 'classGrade', 'isActive', 'page', 'pageSize'],
  })
  list(@Query() query: ListStudentsQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.students.list(query, tenantScope(user));
  }

  @Get(':id')
  @Audit({ action: 'VIEW_STUDENT_DATA', entityType: 'student', entityIdParam: 'id' })
  getOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.students.getById(id, tenantScope(user));
  }

  @Post()
  create(
    @Body() dto: CreateStudentDto,
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
  ) {
    return this.students.create(dto, { id: user.id, ip: ip ?? null, schoolId: tenantScope(user) });
  }

  @Put(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStudentDto,
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
  ) {
    return this.students.update(id, dto, { id: user.id, ip: ip ?? null, schoolId: tenantScope(user) });
  }

  /** Soft-delete (is_active=false). Tidak menghapus baris. */
  @Delete(':id')
  deactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
  ) {
    return this.students.deactivate(id, { id: user.id, ip: ip ?? null, schoolId: tenantScope(user) });
  }

  @Post(':id/reactivate')
  reactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
  ) {
    return this.students.reactivate(id, { id: user.id, ip: ip ?? null, schoolId: tenantScope(user) });
  }

  /** Rotasi qr_token (kartu hilang) — token lama langsung tidak berlaku. */
  @Post(':id/rotate-qr')
  rotateQr(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
  ) {
    return this.students.rotateQrToken(id, { id: user.id, ip: ip ?? null, schoolId: tenantScope(user) });
  }

  @Post('import')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
    }),
  )
  import(
    @UploadedFile() file: UploadedExcelFile | undefined,
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
  ) {
    if (!file) throw new BadRequestException('File Excel (.xlsx) wajib diunggah pada field "file".');
    const name = file.originalname?.toLowerCase() ?? '';
    if (!name.endsWith('.xlsx') && !name.endsWith('.xlsm')) {
      throw new BadRequestException('Format harus .xlsx.');
    }
    return this.students.importFromExcel(file.buffer, { id: user.id, ip: ip ?? null, schoolId: tenantScope(user) });
  }
}
