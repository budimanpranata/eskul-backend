/**
 * Bentuk minimal file hasil `FileInterceptor` (Multer, memory storage).
 * Dipakai agar tidak bergantung pada augmentasi namespace `Express.Multer`
 * yang tidak stabil lintas versi @types.
 */
export interface UploadedFile {
  fieldname: string;
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}
