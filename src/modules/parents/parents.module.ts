import { Module } from '@nestjs/common';
import { ParentsController } from './parents.controller.js';
import { ParentsService } from './parents.service.js';

@Module({
  controllers: [ParentsController],
  providers: [ParentsService],
  exports: [ParentsService],
})
export class ParentsModule {}
