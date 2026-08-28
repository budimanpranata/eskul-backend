/**
 * Konfigurasi environment terpusat.
 * Nilai dibaca dari process.env (lihat .env.example).
 * Fase 0: hanya kerangka — belum ada validasi schema env (menyusul di Fase 1).
 */
export default () => ({
  env: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),
  apiPrefix: process.env.API_PREFIX ?? 'api/v1',

  database: {
    url: process.env.DATABASE_URL,
  },

  redis: {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
  },

  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET,
    accessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    refreshTtl: process.env.JWT_REFRESH_TTL ?? '30d',
  },

  storage: {
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION ?? 'us-east-1',
    bucket: process.env.S3_BUCKET ?? 'eskul-media',
    accessKey: process.env.S3_ACCESS_KEY,
    secretKey: process.env.S3_SECRET_KEY,
    signedUrlTtlSeconds: parseInt(process.env.S3_SIGNED_URL_TTL ?? '300', 10),
  },

  fcm: {
    projectId: process.env.FCM_PROJECT_ID,
    credentialsPath: process.env.FCM_CREDENTIALS_PATH,
  },

  cors: {
    // daftar origin dipisah koma, mis. "https://admin.ekskul-sd.sch.id,http://localhost:5173"
    allowedOrigins: (process.env.CORS_ALLOWED_ORIGINS ?? 'http://localhost:5173')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
  },
});
