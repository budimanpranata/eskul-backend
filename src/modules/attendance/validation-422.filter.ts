import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';

/**
 * Endpoint kontrak `POST /attendance/submit` (dokumen desain 4.1) memakai kode
 * 422 untuk kegagalan validasi, sedangkan ValidationPipe global melempar 400.
 * Filter ini memetakan ulang error validasi terstruktur (body ber-`error:
 * 'VALIDATION_ERROR'`) menjadi 422 tanpa mengubah bentuk body.
 */
@Catch(BadRequestException)
export class Validation422Filter implements ExceptionFilter {
  catch(exception: BadRequestException, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const body = exception.getResponse();

    if (body && typeof body === 'object' && (body as { error?: string }).error === 'VALIDATION_ERROR') {
      res.status(422).json(body);
      return;
    }
    res.status(exception.getStatus()).json(body);
  }
}
