import { PartialType } from '@nestjs/mapped-types';
import { CreateStudentDto } from './create-student.dto.js';

/** Semua field opsional; NIS tetap boleh diubah tapi divalidasi keunikannya di service. */
export class UpdateStudentDto extends PartialType(CreateStudentDto) {}
