import { Controller } from '@nestjs/common';
import { CoachesService } from './coaches.service.js';

/**
 * Data master guru pembina + jadwal ampu. Fase 1.2.
 * FASE 0: kerangka controller — route ditambahkan pada fase terkait.
 */
@Controller('admin/coaches')
export class CoachesController {
  constructor(private readonly coachesService: CoachesService) {}
}
