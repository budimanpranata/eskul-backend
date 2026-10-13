import { Body, Controller, Get, Ip, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';

import { Audit } from '../../common/decorators/audit.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { tenantScope, type AuthenticatedUser } from '../../common/types/authenticated-user.js';
import { BillingService } from './billing.service.js';
import {
  BillingReportQueryDto,
  CreateInvoiceDto,
  GenerateInvoicesDto,
  ListInvoicesQueryDto,
  ListPaymentsQueryDto,
  VerifyPaymentDto,
} from './dto/billing.dto.js';

/**
 * Tagihan ekskul (billing) — sisi Admin: generate massal, tagihan satuan,
 * daftar + report lunas/belum, dan validasi pengajuan pembayaran ortu.
 */
@Roles('ADMIN')
@Controller('admin/billing')
export class BillingAdminController {
  constructor(private readonly billing: BillingService) {}

  private actor(user: AuthenticatedUser, ip: string) {
    return { id: user.id, ip: ip ?? null, schoolId: tenantScope(user) };
  }

  @Post('invoices/generate')
  generate(@Body() dto: GenerateInvoicesDto, @CurrentUser() user: AuthenticatedUser, @Ip() ip: string) {
    return this.billing.generateInvoices(dto, this.actor(user, ip));
  }

  @Post('invoices')
  create(@Body() dto: CreateInvoiceDto, @CurrentUser() user: AuthenticatedUser, @Ip() ip: string) {
    return this.billing.createInvoice(dto, this.actor(user, ip));
  }

  @Get('invoices')
  @Audit({
    action: 'LIST_INVOICES',
    entityType: 'invoice',
    captureQuery: ['status', 'period', 'classGrade', 'extracurricularId', 'studentId'],
  })
  list(@Query() query: ListInvoicesQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.billing.listInvoices(query, tenantScope(user));
  }

  @Get('report')
  @Audit({ action: 'VIEW_BILLING_REPORT', entityType: 'invoice', captureQuery: ['period', 'extracurricularId', 'classGrade'] })
  report(@Query() query: BillingReportQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.billing.report(query, tenantScope(user));
  }

  @Get('invoices/:id')
  @Audit({ action: 'VIEW_INVOICE', entityType: 'invoice', entityIdParam: 'id' })
  getOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.billing.getInvoiceById(id, tenantScope(user));
  }

  @Post('invoices/:id/cancel')
  cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser, @Ip() ip: string) {
    return this.billing.cancelInvoice(id, this.actor(user, ip));
  }

  @Get('payments')
  @Audit({ action: 'LIST_PAYMENTS', entityType: 'payment', captureQuery: ['status'] })
  listPayments(@Query() query: ListPaymentsQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.billing.listPayments(query, tenantScope(user));
  }

  @Put('payments/:id/verify')
  verify(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VerifyPaymentDto,
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
  ) {
    return this.billing.verifyPayment(id, dto, this.actor(user, ip));
  }
}
