import { Controller } from '@nestjs/common';
import { UsersService } from './users.service.js';

/**
 * Manajemen akun users lintas-role + registrasi FCM token.
 * FASE 0: kerangka controller — route ditambahkan pada fase terkait.
 */
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}
}
