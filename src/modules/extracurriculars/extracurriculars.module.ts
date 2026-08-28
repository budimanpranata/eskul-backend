import { Module } from '@nestjs/common';
import { ExtracurricularsController } from './extracurriculars.controller.js';
import { ExtracurricularsService } from './extracurriculars.service.js';

@Module({
  controllers: [ExtracurricularsController],
  providers: [ExtracurricularsService],
  exports: [ExtracurricularsService],
})
export class ExtracurricularsModule {}
