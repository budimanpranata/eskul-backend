import { Controller } from '@nestjs/common';
import { AttendanceService } from './attendance.service.js';

/**
 * Sesi presensi + materi latihan + evaluasi (submit idempoten). Fase 1.3 / 2.x.
 * FASE 0: kerangka controller — route ditambahkan pada fase terkait.
 */
@Controller('attendance')
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}
}
