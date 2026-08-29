import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { AttendanceController } from './attendance.controller.js';
import { AttendanceService } from './attendance.service.js';
import { CoachController } from './coach.controller.js';

@Module({
  imports: [NotificationsModule],
  controllers: [AttendanceController, CoachController],
  providers: [AttendanceService],
  exports: [AttendanceService],
})
export class AttendanceModule {}
