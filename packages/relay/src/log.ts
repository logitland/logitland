// Structured logs for Workers Logs. Pass IDs and counts only: never message text, keys, tokens,
// webhook URLs, destination URLs or IP addresses.

/** Primitive values (IDs, counts, flags), plus `error`, which is reduced to its name and message. */
export type LogFields = Record<string, unknown>;

export interface Logger {
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}

const errorName = (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message.slice(0, 200)}` : String(e).slice(0, 200));

/** Receives the `error` of every error line, named by its event: the Worker passes Sentry's captureException. */
export type ErrorReporter = (error: unknown, event: string) => void;

export function consoleLogger(base: LogFields = {}, report?: ErrorReporter): Logger {
  const line = (level: string, event: string, fields: LogFields = {}) => {
    const { error, ...rest } = fields;
    return JSON.stringify({ level, event, ...base, ...rest, ...(error === undefined ? {} : { error: errorName(error) }) });
  };
  return {
    info: (event, fields) => console.log(line('info', event, fields)),
    warn: (event, fields) => console.warn(line('warn', event, fields)),
    error: (event, fields) => {
      console.error(line('error', event, fields));
      if (report && fields?.error !== undefined) report(fields.error, event);
    },
  };
}

/** Collects log lines in memory, for tests. */
export function memoryLogger(): Logger & { lines: { level: string; event: string; fields: LogFields }[] } {
  const lines: { level: string; event: string; fields: LogFields }[] = [];
  const push =
    (level: string) =>
    (event: string, fields: LogFields = {}) => {
      const { error, ...rest } = fields;
      lines.push({ level, event, fields: { ...rest, ...(error === undefined ? {} : { error: errorName(error) }) } });
    };
  return { lines, info: push('info'), warn: push('warn'), error: push('error') };
}
