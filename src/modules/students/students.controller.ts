import { Controller } from '@nestjs/common';
import { StudentsService } from './students.service.js';

/**
 * Data master siswa + generate qr_token + rotasi token. Fase 1.2 / 2.2.
 * FASE 0: kerangka controller — route ditambahkan pada fase terkait.
 */
@Controller('admin/students')
export class StudentsController {
  constructor(private readonly studentsService: StudentsService) {}
}
