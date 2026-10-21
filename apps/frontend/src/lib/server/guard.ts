// Shared bits for form actions: who is asking, and how a relay refusal becomes a form failure.
import type { PolicyCode } from '@logitland/contracts';
import { error, fail, redirect } from '@sveltejs/kit';
import { RelayRequestError } from './relay.js';

type Viewer = NonNullable<App.Locals['viewer']>;

/** The signed-in person, or a redirect to sign in (and back). */
export function signedIn(locals: App.Locals, url: URL): Viewer {
  if (!locals.viewer) redirect(303, `/login?next=${encodeURIComponent(url.pathname)}`);
  return locals.viewer;
}

/** An admin, or 403. Actions don't run the layout's load, so each one checks for itself (the relay checks too). */
export function adminOnly(locals: App.Locals): Viewer {
  if (!locals.viewer?.is_admin) error(403, 'This console is for relay admins.');
  return locals.viewer;
}

export interface Refusal {
  status: number;
  message: string;
  /** The moderation policy behind the refusal, when the relay names one. */
  policy: PolicyCode | null;
  /** Messages for single fields, keyed by the relay's field path (`name`, `description`, …). */
  fields: Record<string, string>;
}

export function refusalOf(e: RelayRequestError): Refusal {
  const fields: Record<string, string> = {};
  for (const item of e.problem?.errors ?? []) fields[item.path.split('.')[0] ?? ''] ??= item.message;
  return { status: e.status, message: e.message, policy: e.policy, fields };
}

/** Run a relay call. A refusal comes back as a value; anything else is a real error and throws. */
export async function attempt<T>(call: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; refusal: Refusal }> {
  try {
    return { ok: true, value: await call() };
  } catch (e) {
    if (e instanceof RelayRequestError) return { ok: false, refusal: refusalOf(e) };
    throw e;
  }
}

/** A refusal as the form failure the page shows. Extra values (the row it was about) ride along. */
export function refused<E extends Record<string, unknown>>(r: Refusal, extra?: E) {
  return fail(r.status >= 400 && r.status < 600 ? r.status : 502, { message: r.message, policy: r.policy, fields: r.fields, ...extra });
}
