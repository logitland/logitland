import { error, type RequestEvent } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';

/**
 * Calls the relay's internal API through the `RELAY` service binding (the backend's `InternalApi` entrypoint, which the
 * internet can't reach). Owner and admin routes act for the signed-in owner, sent as `x-logitland-owner`; pass `owner`
 * only before a session exists (signing in). A relay error becomes the same SvelteKit error, with the relay's words.
 */
export async function relay<T>(
  event: Pick<RequestEvent, 'locals'>,
  path: `/internal/${string}`,
  init: { method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; body?: unknown; owner?: string } = {},
): Promise<T> {
  const owner = init.owner ?? event.locals.owner?.id;
  const res = await env.RELAY.fetch(`https://relay${path}`, {
    method: init.method ?? 'GET',
    headers: {
      'x-logitland-internal': env.INTERNAL_TOKEN,
      ...(owner && { 'x-logitland-owner': owner }),
      ...(init.body !== undefined && { 'content-type': 'application/json' }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (res.status === 204) return undefined as T;
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    // The relay answers errors as problem+json.
    const problem = json as { detail?: string; title?: string } | null;
    error(res.status, problem?.detail ?? problem?.title ?? res.statusText);
  }
  return json as T;
}
