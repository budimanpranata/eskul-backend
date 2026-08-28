import { IsJWT, IsNotEmpty } from 'class-validator';

export class RefreshDto {
  @IsJWT({ message: 'Format refresh token tidak valid.' })
  @IsNotEmpty({ message: 'Refresh token wajib diisi.' })
  refreshToken!: string;
}
