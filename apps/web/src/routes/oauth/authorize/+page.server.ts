import { LoganAuthorization, type LoganConsent, type LoganRedirect } from '@logitland/contracts';
import { error, redirect } from '@sveltejs/kit';
import { relay } from '#lib/server/relay.js';
import type { RequestEvent } from './$types';

// The Logan admin MCP's authorization endpoint (OAuth 2.1 with PKCE). An MCP client sends the person here; they sign in with
// Discord if they haven't, and allow or cancel. The relay checks the request and the person's logan power, and issues the code
// the browser carries back to the client.

const FIELDS = LoganAuthorization.keyof().options;

/** The client's authorization request, from the query (the page) or the hidden fields (its form). */
function requestFrom(source: URLSearchParams | FormData): LoganAuthorization {
  const fields = FIELDS.flatMap((name) => {
    const value = source.get(name);
    return typeof value === 'string' ? [[name, value]] : [];
  });
  const parsed = LoganAuthorization.safeParse(Object.fromEntries(fields));
  if (!parsed.success) error(400, 'This sign-in link is incomplete. Start again from your MCP client.');
  return parsed.data;
}

export const load = async (event) => {
  const owner = event.locals.owner;
  if (!owner) redirect(303, `/sign-in?next=${encodeURIComponent(event.url.pathname + event.url.search)}`);
  const request = requestFrom(event.url.searchParams);
  const consent = await relay<LoganConsent>(event, `/internal/owners/${owner.id}/logan/consent`, { method: 'POST', body: request });
  return { request, consent, username: owner.username };
};

const decide = (decision: 'allow' | 'deny') => async (event: RequestEvent) => {
  const owner = event.locals.owner;
  if (!owner) error(401, 'Your session ended. Start again from your MCP client.');
  const request = requestFrom(await event.request.formData());
  const { redirect_to } = await relay<LoganRedirect>(event, `/internal/owners/${owner.id}/logan/authorize`, { method: 'POST', body: { ...request, decision } });
  redirect(303, redirect_to, { external: true });
};

export const actions = { allow: decide('allow'), deny: decide('deny') };
