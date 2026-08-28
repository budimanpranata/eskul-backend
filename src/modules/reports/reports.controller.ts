import { Controller } from '@nestjs/common';
import { ReportsService } from './reports.service.js';

/**
 * Export laporan kehadiran/rapor PDF/Excel async. Fase 3.1.
 * FASE 0: kerangka controller — route ditambahkan pada fase terkait.
 */
@Controller('admin/reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}
}
