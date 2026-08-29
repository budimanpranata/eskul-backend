import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { AdminParentRelationsController } from './admin-parent-relations.controller.js';
import { ParentsController } from './parents.controller.js';
import { ParentsService } from './parents.service.js';

@Module({
  imports: [NotificationsModule],
  controllers: [ParentsController, AdminParentRelationsController],
  providers: [ParentsService],
  exports: [ParentsService],
})
export class ParentsModule {}
