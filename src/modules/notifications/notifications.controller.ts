import { Body, Controller, Delete, Get, HttpCode, Post, Query } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../common/types/authenticated-user.js';
import {
  ListNotificationsQueryDto,
  MarkReadDto,
  RegisterDeviceDto,
  UnregisterDeviceDto,
} from './dto/notifications.dto.js';
import { NotificationsService } from './notifications.service.js';

/** Notifikasi in-app + registrasi device token FCM. Semua butuh autentikasi (role apa pun). */
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Post('devices')
  @HttpCode(200)
  registerDevice(@CurrentUser() user: AuthenticatedUser, @Body() dto: RegisterDeviceDto) {
    return this.notifications.registerDevice(user.id, dto.token, dto.platform);
  }

  @Delete('devices')
  @HttpCode(200)
  unregisterDevice(@CurrentUser() user: AuthenticatedUser, @Body() dto: UnregisterDeviceDto) {
    return this.notifications.unregisterDevice(user.id, dto.token);
  }

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListNotificationsQueryDto) {
    return this.notifications.list(user.id, query);
  }

  @Get('unread-count')
  unreadCount(@CurrentUser() user: AuthenticatedUser) {
    return this.notifications.unreadCount(user.id);
  }

  @Post('read')
  @HttpCode(200)
  markRead(@CurrentUser() user: AuthenticatedUser, @Body() dto: MarkReadDto) {
    return this.notifications.markRead(user.id, dto.ids);
  }

  @Post('read-all')
  @HttpCode(200)
  markAllRead(@CurrentUser() user: AuthenticatedUser) {
    return this.notifications.markAllRead(user.id);
  }
}
