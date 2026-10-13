import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Ip,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import { Audit } from '../../common/decorators/audit.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import type { AuthenticatedUser } from '../../common/types/authenticated-user.js';
import type { UploadedFile as UploadedProofFile } from '../../common/types/uploaded-file.js';
import { BillingService } from './billing.service.js';
import { ParentInvoicesQueryDto, SubmitPaymentDto } from './dto/billing.dto.js';

/** Tagihan ekskul — sisi Orang Tua: lihat tagihan anak + ajukan pembayaran. */
@Roles('ORANGTUA')
@Controller('parent/billing')
export class BillingParentController {
  constructor(private readonly billing: BillingService) {}

  @Get('invoices')
  @Audit({ action: 'LIST_CHILD_INVOICES', entityType: 'invoice', captureQuery: ['studentId', 'status'] })
  list(@Query() query: ParentInvoicesQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.billing.parentInvoices(query.studentId, query.status, user.id);
  }

  @Get('invoices/:id')
  @Audit({ action: 'VIEW_CHILD_INVOICE', entityType: 'invoice', entityIdParam: 'id' })
  getOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.billing.parentInvoiceDetail(id, user.id);
  }

  @Post('invoices/:id/pay')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  pay(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SubmitPaymentDto,
    @UploadedFile() file: UploadedProofFile | undefined,
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
  ) {
    if (dto.method === 'TRANSFER' && !file) {
      throw new BadRequestException('Bukti transfer (gambar) wajib diunggah pada field "file".');
    }
    return this.billing.submitPayment(id, dto.method, dto.note, file, { userId: user.id, ip: ip ?? null });
  }
}
