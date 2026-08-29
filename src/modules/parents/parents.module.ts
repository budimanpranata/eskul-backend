import { Module } from '@nestjs/common';
import { AdminParentRelationsController } from './admin-parent-relations.controller.js';
import { ParentsController } from './parents.controller.js';
import { ParentsService } from './parents.service.js';

@Module({
  controllers: [ParentsController, AdminParentRelationsController],
  providers: [ParentsService],
  exports: [ParentsService],
})
export class ParentsModule {}
