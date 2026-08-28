import { Controller } from '@nestjs/common';
import { ParentsService } from './parents.service.js';

/**
 * Relasi ortu-siswa, link-request, dashboard child-progress. Fase 1.4 / 2.4.
 * FASE 0: kerangka controller — route ditambahkan pada fase terkait.
 */
@Controller('parent')
export class ParentsController {
  constructor(private readonly parentsService: ParentsService) {}
}
