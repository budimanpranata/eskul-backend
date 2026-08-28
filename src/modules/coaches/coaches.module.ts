import { Module } from '@nestjs/common';
import { CoachesController } from './coaches.controller.js';
import { CoachesService } from './coaches.service.js';

@Module({
  controllers: [CoachesController],
  providers: [CoachesService],
  exports: [CoachesService],
})
export class CoachesModule {}
