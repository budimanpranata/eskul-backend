import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { SettingsAdminController } from './settings-admin.controller.js';
import { SettingsController } from './settings.controller.js';
import { SettingsService } from './settings.service.js';
import { BRANDING_LOGO_STORAGE, brandingLogoStorageFactory } from './storage/branding-logo-storage.factory.js';

@Module({
  controllers: [SettingsController, SettingsAdminController],
  providers: [
    SettingsService,
    { provide: BRANDING_LOGO_STORAGE, useFactory: brandingLogoStorageFactory, inject: [ConfigService] },
  ],
  exports: [SettingsService],
})
export class SettingsModule {}
