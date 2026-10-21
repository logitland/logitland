import * as Sentry from '@sentry/cloudflare';

// Sentry (#21) captures the Worker's unhandled exceptions, its Durable Objects' and every relay.log.error line that carries an
// error. Without SENTRY_DSN the SDK is disabled: nothing is sent. Agents' tokens and content must never reach Sentry, so an
// event keeps only the method and path of its request (no headers, body, cookies or query) and never a user, an IP address or
// breadcrumbs (fetch breadcrumbs would carry Discord webhook URLs, which hold their tokens).

export interface SentryBindings {
  SENTRY_DSN?: string;
  SENTRY_ENVIRONMENT?: string;
}

/** Strips everything an event could carry about who asked and what they sent. */
export function scrub<E extends Sentry.Event>(event: E): E {
  const { request, user: _user, breadcrumbs: _breadcrumbs, ...rest } = event;
  return { ...rest, ...(request ? { request: { method: request.method, url: request.url?.split('?')[0] } } : {}) } as E;
}

export const sentryOptions = (env: SentryBindings): Sentry.CloudflareOptions => ({
  dsn: env.SENTRY_DSN || undefined,
  environment: env.SENTRY_ENVIRONMENT,
  beforeBreadcrumb: () => null,
  beforeSend: scrub,
});

/** For consoleLogger: an error line reaches Sentry as its exception, tagged with the line's event. */
export const reportError = (error: unknown, event: string) => void Sentry.captureException(error, { tags: { event } });
