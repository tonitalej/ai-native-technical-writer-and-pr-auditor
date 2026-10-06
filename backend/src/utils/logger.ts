import pino, { type Logger, type LoggerOptions } from 'pino';

import { sanitizeForLog } from './redact.js';

export type AppLogger = Logger;

const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'token',
  'password',
  'authorization',
  'ciphertext',
  'raw_diff',
  '*.token',
  '*.password',
  '*.authorization',
  '*.ciphertext',
  '*.raw_diff',
];

export function createLogger(level: string, destination?: pino.DestinationStream): AppLogger {
  const options: LoggerOptions = {
    level,
    redact: {
      paths: REDACT_PATHS,
      censor: '[Redacted]',
    },
    formatters: {
      log(object) {
        return sanitizeForLog(object) as Record<string, unknown>;
      },
    },
    hooks: {
      logMethod(args, method) {
        const sanitized = args.map((arg) => (typeof arg === 'string' ? sanitizeForLog(arg) : arg));
        method.apply(this, sanitized as Parameters<typeof method>);
      },
    },
  };
  return destination ? pino(options, destination) : pino(options);
}
