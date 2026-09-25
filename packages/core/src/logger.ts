import pino from 'pino';
import { getConfig } from '@localy/config';

let instance: pino.Logger | undefined;

export function getLogger(): pino.Logger {
  if (!instance) {
    const cfg = getConfig();
    instance = pino({
      level: cfg.isTest ? 'silent' : cfg.LOG_LEVEL,
      base: { service: process.env.LOCALY_SERVICE ?? 'localy' },
      redact: {
        paths: [
          'password',
          '*.password',
          'token',
          '*.token',
          'accessToken',
          'refreshToken',
          '*.accessToken',
          '*.refreshToken',
          'req.headers.authorization',
          'req.headers.cookie',
          'headers.authorization',
          'headers.cookie',
        ],
        censor: '[redacted]',
      },
      transport:
        cfg.isDevelopment && process.stdout.isTTY
          ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } }
          : undefined,
    });
  }
  return instance;
}

export const logger = new Proxy({} as pino.Logger, {
  get(_t, prop: string) {
    const l = getLogger() as unknown as Record<string, unknown>;
    const v = l[prop];
    return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(l) : v;
  },
});
