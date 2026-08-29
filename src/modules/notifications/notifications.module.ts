import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { NOTIFICATIONS_QUEUE } from '../../queue/queue.module.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsProcessor } from './notifications.processor.js';
import { NotificationsService } from './notifications.service.js';
import { PUSH_SENDER, pushSenderFactory } from './push/push-sender.js';

@Module({
  imports: [BullModule.registerQueue({ name: NOTIFICATIONS_QUEUE })],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationsProcessor,
    { provide: PUSH_SENDER, useFactory: pushSenderFactory, inject: [ConfigService] },
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
