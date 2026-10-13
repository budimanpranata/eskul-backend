import { Controller, Get, Header, Param, ParseUUIDPipe, Query, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';

import { Audit } from '../../common/decorators/audit.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { BillingService } from './billing.service.js';

/**
 * Unduh bukti transfer — `@Public()`; otorisasi murni dari signature HMAC +
 * kedaluwarsa pada URL (pola yang sama dengan `ReportsController.download`,
 * Fase 3.1). Dipakai baik oleh web admin maupun mobile ortu.
 */
@Controller('billing/payments')
export class BillingDownloadsController {
  constructor(private readonly billing: BillingService) {}

  @Public()
  @Get(':id/proof')
  @Audit({ action: 'VIEW_PAYMENT_PROOF', entityType: 'payment', entityIdParam: 'id' })
  @Header('Cache-Control', 'no-store')
  async proof(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('expires') expires: string,
    @Query('sig') sig: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { buffer, fileName, contentType } = await this.billing.resolveProofDownload(id, Number(expires), sig ?? '');
    res.set({
      'Content-Type': contentType,
      'Content-Disposition': `inline; filename="${fileName}"`,
      'Content-Length': String(buffer.length),
    });
    return new StreamableFile(buffer);
  }
}
