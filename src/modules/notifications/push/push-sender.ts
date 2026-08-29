import { existsSync } from 'node:fs';

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export const PUSH_SENDER = Symbol('PUSH_SENDER');

export interface PushMessage {
  title: string;
  body: string;
  data?: Record<string, string>;
}

export interface PushSendResult {
  ok: boolean;
  /** true bila token ditolak permanen (harus dihapus dari DB). */
  invalidToken?: boolean;
}

export interface PushSender {
  send(token: string, message: PushMessage): Promise<PushSendResult>;
}

/**
 * Sender default untuk development: mencatat ke log, tidak mengirim apa pun.
 * `PUSH_FAIL_TOKENS` (csv substring) → simulasikan kegagalan (untuk uji retry/DLQ).
 */
@Injectable()
export class LoggingPushSender implements PushSender {
  private readonly logger = new Logger('PushSender(log)');
  private readonly failMarkers: string[];

  constructor(config: ConfigService) {
    this.failMarkers = (process.env.PUSH_FAIL_TOKENS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    void config;
  }

  async send(token: string, message: PushMessage): Promise<PushSendResult> {
    if (this.failMarkers.some((m) => token.includes(m))) {
      throw new Error(`Simulasi kegagalan push untuk token ${token.slice(0, 12)}…`);
    }
    this.logger.log(`(dev) push → ${token.slice(0, 12)}… : ${message.title}`);
    return { ok: true };
  }
}

/**
 * Sender produksi: Firebase Cloud Messaging via firebase-admin.
 * Aktif hanya bila `FCM_CREDENTIALS_PATH` menunjuk service-account JSON yang ada.
 */
@Injectable()
export class FirebasePushSender implements PushSender {
  private readonly logger = new Logger('PushSender(fcm)');
  private messaging: { send: (m: unknown) => Promise<string> } | null = null;
  private initialized = false;

  constructor(private readonly config: ConfigService) {}

  private async ensureInit(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    const credPath = this.config.get<string>('fcm.credentialsPath');
    if (!credPath || !existsSync(credPath)) {
      this.logger.warn('FCM_CREDENTIALS_PATH tidak valid — push FCM dinonaktifkan.');
      return;
    }
    // Tipe firebase-admin di ESM cukup rumit; path ini hanya aktif di produksi.
    const imported = (await import('firebase-admin')) as unknown as Record<string, unknown>;
    const admin = (imported.default ?? imported) as {
      apps: unknown[];
      initializeApp: (o: unknown) => unknown;
      credential: { cert: (p: string) => unknown };
      messaging: (app?: unknown) => { send: (m: unknown) => Promise<string> };
    };
    const app = admin.apps.length
      ? admin.apps[0]
      : admin.initializeApp({ credential: admin.credential.cert(credPath) });
    this.messaging = admin.messaging(app);
  }

  async send(token: string, message: PushMessage): Promise<PushSendResult> {
    await this.ensureInit();
    if (!this.messaging) return { ok: false };
    try {
      await this.messaging.send({
        token,
        notification: { title: message.title, body: message.body },
        data: message.data ?? {},
      });
      return { ok: true };
    } catch (err) {
      const code = (err as { errorInfo?: { code?: string } }).errorInfo?.code ?? '';
      const invalidToken =
        code.includes('registration-token-not-registered') || code.includes('invalid-argument');
      if (invalidToken) return { ok: false, invalidToken: true };
      throw err; // biarkan BullMQ me-retry
    }
  }
}

/** Pilih implementasi berdasarkan konfigurasi. */
export function pushSenderFactory(config: ConfigService): PushSender {
  const credPath = config.get<string>('fcm.credentialsPath');
  if (credPath && existsSync(credPath)) return new FirebasePushSender(config);
  return new LoggingPushSender(config);
}
