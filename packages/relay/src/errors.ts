import type { ErrorCode, Problem } from '@logitland/contracts';
import type { z } from 'zod';

const TITLES: Record<ErrorCode, string> = {
  invalid_request: 'The request is invalid',
  unauthorized: 'Authentication is required',
  forbidden: 'You can’t do that',
  not_found: 'Not found',
  conflict: 'That conflicts with the current state',
  expired: 'That has expired',
  rate_limited: 'Too many requests',
  idempotency_conflict: 'That idempotency key was used for a different request',
  destination_refused: 'The destination was refused',
  moderation_unavailable: 'Moderation is unavailable',
  payload_too_large: 'The request body is too large',
  misconfigured: 'The relay is not configured correctly',
  unavailable: 'That is switched off or temporarily unavailable',
  internal: 'Something went wrong in the relay',
};

export class RelayError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    readonly detail?: string,
    readonly extra: { retryAfterSeconds?: number; errors?: Problem['errors'] } = {},
  ) {
    super(detail ?? TITLES[code]);
    this.name = 'RelayError';
  }

  toProblem(): Problem {
    return {
      type: `https://logitland.invalid/problems/${this.code}`,
      title: TITLES[this.code],
      status: this.status,
      code: this.code,
      ...(this.detail ? { detail: this.detail } : {}),
      ...(this.extra.errors ? { errors: this.extra.errors } : {}),
    };
  }
}

/**
 * An error at /agent/* or /oauth2/*, which answer in auth.md's and RFC 6749's shape (`{ error, error_description }`) rather than
 * problem+json. `error` is the protocol's code: invalid_request, invalid_grant, authorization_pending, slow_down and so on.
 */
export class OAuthError extends RelayError {
  constructor(
    status: number,
    readonly error: string,
    description: string,
    extra: { retryAfterSeconds?: number } = {},
  ) {
    super(status, status === 429 ? 'rate_limited' : status === 401 ? 'unauthorized' : status === 403 ? 'forbidden' : 'invalid_request', description, extra);
  }

  toBody(): { error: string; error_description: string } {
    return { error: this.error, error_description: this.detail ?? this.error };
  }
}

/** The same failure, worded for auth.md: a problem from the rest of the relay becomes an OAuth-shaped error. */
export function asOAuthError(err: unknown): unknown {
  if (!(err instanceof RelayError) || err instanceof OAuthError) return err;
  const error = err.status === 429 ? 'rate_limited' : err.status >= 500 ? 'temporarily_unavailable' : 'invalid_request';
  const fields = err.extra.errors?.map((e) => `${e.path}: ${e.message}`).join('; ');
  return new OAuthError(err.status, error, fields ? `${err.detail} ${fields}` : (err.detail ?? err.message), err.extra);
}

export const invalid = (detail: string, errors?: Problem['errors']) => new RelayError(400, 'invalid_request', detail, { errors });
export const unauthorized = (detail?: string) => new RelayError(401, 'unauthorized', detail);
export const forbidden = (detail?: string) => new RelayError(403, 'forbidden', detail);
export const notFound = (detail?: string) => new RelayError(404, 'not_found', detail);
export const conflict = (detail?: string) => new RelayError(409, 'conflict', detail);
export const unavailable = (detail: string, retryAfterSeconds?: number) =>
  new RelayError(503, 'unavailable', detail, retryAfterSeconds === undefined ? {} : { retryAfterSeconds });
export const rateLimited = (detail: string, retryAfterSeconds: number) => new RelayError(429, 'rate_limited', detail, { retryAfterSeconds });

export function parse<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> {
  const r = schema.safeParse(value);
  if (r.success) return r.data;
  throw invalid(
    'Some fields are missing or invalid.',
    r.error.issues.map((i) => ({ path: i.path.join('.') || '(body)', message: i.message })),
  );
}
