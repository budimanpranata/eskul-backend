import { Controller } from '@nestjs/common';
import { NotificationsService } from './notifications.service.js';

/**
 * Notifikasi push (FCM) via job queue + riwayat in-app. Fase 1.5.
 * FASE 0: kerangka controller — route ditambahkan pada fase terkait.
 */
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}
}
