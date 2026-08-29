import { Module } from '@nestjs/common';
import { AttendanceController } from './attendance.controller.js';
import { AttendanceService } from './attendance.service.js';
import { CoachController } from './coach.controller.js';

@Module({
  controllers: [AttendanceController, CoachController],
  providers: [AttendanceService],
  exports: [AttendanceService],
})
export class AttendanceModule {}
