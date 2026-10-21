import { isHttpError } from '@sveltejs/kit';

/**
 * The words to show for a failed relay call: the relay's own, which name the problem and the fix. Takes a thrown command
 * error or a query's `error`.
 */
export function messageOf(error: unknown): string {
  if (isHttpError(error)) return error.body.message;
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') return error.message;
  return 'Something went wrong. Try again.';
}
