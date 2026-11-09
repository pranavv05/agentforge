import { randomBytes } from 'node:crypto';
import pino, { type Logger } from 'pino';

/**
 * Structured logging.
 *
 * Every run carries a correlation id that is threaded through transitions, LLM calls
 * and audit entries, so a run is reconstructable after the fact from either the logs
 * or the database alone. That is a hard requirement of the quality bar, not a nicety:
 * the whole governance claim is "you can prove what happened".
 */

export const logger: Logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  // Timestamps as ISO strings so log lines collate with the TEXT timestamps in SQLite.
  timestamp: pino.stdTimeFunctions.isoTime,
  // null (not undefined) is how pino is told to omit pid/hostname.
  base: null,
  redact: {
    // Defence in depth. No key is ever intentionally logged, but a careless
    // `logger.info({ env })` should not be able to leak one either.
    paths: ['apiKey', 'api_key', 'ANTHROPIC_API_KEY', '*.apiKey', 'headers.authorization'],
    censor: '[redacted]',
  },
});

/** A fresh correlation id. Short enough to paste into a SQL `WHERE` by hand. */
export function newCorrelationId(): string {
  return `run_${Date.now().toString(36)}${randomBytes(4).toString('hex')}`;
}

/** A child logger bound to one run. */
export function runLogger(correlationId: string, bindings: Record<string, unknown> = {}): Logger {
  return logger.child({ correlation_id: correlationId, ...bindings });
}
