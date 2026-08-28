import { Controller } from '@nestjs/common';
import { ExtracurricularsService } from './extracurriculars.service.js';

/**
 * Ekskul, jadwal, dan keanggotaan siswa. Fase 1.2.
 * FASE 0: kerangka controller — route ditambahkan pada fase terkait.
 */
@Controller('admin/extracurriculars')
export class ExtracurricularsController {
  constructor(private readonly extracurricularsService: ExtracurricularsService) {}
}
