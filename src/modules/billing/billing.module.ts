import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { NotificationsModule } from '../notifications/notifications.module.js';
import { BillingAdminController } from './billing-admin.controller.js';
import { BillingDownloadsController } from './billing-downloads.controller.js';
import { BillingParentController } from './billing-parent.controller.js';
import { BillingProofSigner } from './billing-proof-signer.js';
import { BillingService } from './billing.service.js';
import { BILLING_PROOF_STORAGE, billingProofStorageFactory } from './storage/billing-proof-storage.factory.js';

@Module({
  imports: [NotificationsModule],
  controllers: [BillingAdminController, BillingParentController, BillingDownloadsController],
  providers: [
    BillingService,
    BillingProofSigner,
    { provide: BILLING_PROOF_STORAGE, useFactory: billingProofStorageFactory, inject: [ConfigService] },
  ],
  exports: [BillingService],
})
export class BillingModule {}
