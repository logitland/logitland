// What a signed-in person can see and do about their own messages. These two calls go to the
// dashboard API (the InternalApi entrypoint) through the BACKEND service binding, as the signed-in person:
// the relay checks that x-logitland-person (the Discord user the dashboard verified at sign-in) is the one in the path
// (401 when the header is missing, 403 when it belongs to someone else). No owner account is needed: a person who signs
// in only to remove their messages is known by their Discord ID alone.
//
// GET /internal/people/:discordUserId -> ConsentStatus
// POST /internal/people/:discordUserId/removal { mode } -> PersonRemoval

import { env } from 'cloudflare:workers';
import { ConsentStatus, PersonRemoval, type PersonRemovalMode } from '@logitland/contracts';
import { FIXTURE_PERSON } from '#lib/fixtures/mirror.js';
import { RelayRequestError, dataSource, p, simulate } from '#lib/server/relay.js';

export interface Person {
  discord_user_id: string;
}

export class PeopleError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function describe(status: number): string {
  if (status === 401 || status === 403) return 'Your Discord sign-in doesn’t match this account. Sign out and sign in again.';
  if (status === 429) return 'Too many tries. Wait a minute, then try again.';
  return 'Logitland couldn’t reach the relay. Try again in a minute.';
}

async function call(person: Person, method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ status: number; data: unknown }> {
  if (!env.INTERNAL_TOKEN) throw new PeopleError(500, 'The dashboard isn’t set up to reach the relay yet.');
  const headers: Record<string, string> = { 'x-logitland-internal': env.INTERNAL_TOKEN, 'x-logitland-person': person.discord_user_id };
  if (body !== undefined) headers['content-type'] = 'application/json';
  let res: Response;
  try {
    res = await env.BACKEND.fetch(`https://relay.internal${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new PeopleError(502, describe(502));
  }
  return { status: res.status, data: res.status === 204 ? null : await res.json().catch(() => null) };
}

function path(person: Person, suffix = ''): string {
  try {
    return `${p`/internal/people/${person.discord_user_id}`}${suffix}`;
  } catch (e) {
    if (e instanceof RelayRequestError) throw new PeopleError(400, 'That Discord account isn’t valid.');
    throw e;
  }
}

/** In fixtures mode, ?preview= shows the other places a person can be: left, hidden (never agreed, messages remain), error, role-failed. */
function fixtureStatus(preview: string | null): ConsentStatus {
  const granted = new Date(Date.now() - FIXTURE_PERSON.grantedDaysAgo * 86_400_000).toISOString();
  const left = new Date(Date.now() - 3 * 86_400_000).toISOString();
  if (preview === 'left') return { agreed: false, method: 'command', granted_at: granted, revoked_at: left, mirrored_messages: 0 };
  if (preview === 'hidden') return { agreed: false, method: null, granted_at: null, revoked_at: null, mirrored_messages: 3 };
  return { agreed: FIXTURE_PERSON.agreed, method: 'command', granted_at: granted, revoked_at: null, mirrored_messages: FIXTURE_PERSON.messages };
}

export async function personStatus(person: Person, preview: string | null = null): Promise<ConsentStatus> {
  if (dataSource() === 'fixtures') {
    await simulate(120);
    if (preview === 'error') throw new PeopleError(502, describe(502));
    return fixtureStatus(preview);
  }
  const { status, data } = await call(person, 'GET', path(person));
  const parsed = status < 400 ? ConsentStatus.safeParse(data) : null;
  if (!parsed?.success) throw new PeopleError(status >= 400 ? status : 502, describe(status >= 400 ? status : 502));
  return parsed.data;
}

export async function removePerson(person: Person, mode: PersonRemovalMode, preview: string | null = null): Promise<PersonRemoval> {
  if (dataSource() === 'fixtures') {
    await simulate(900);
    if (preview === 'error') throw new PeopleError(502, describe(502));
    const before = fixtureStatus(preview);
    const consent: ConsentStatus =
      mode === 'leave' ? { ...before, agreed: false, revoked_at: new Date().toISOString(), mirrored_messages: 0 } : { ...before, mirrored_messages: 0 };
    return { mode, removed_messages: before.mirrored_messages, role_removed: mode === 'leave' ? preview !== 'role-failed' : null, consent };
  }
  const { status, data } = await call(person, 'POST', path(person, '/removal'), { mode });
  if (status >= 400) throw new PeopleError(status, describe(status));
  const parsed = PersonRemoval.safeParse(data);
  if (!parsed.success) throw new PeopleError(502, describe(502));
  return parsed.data;
}
