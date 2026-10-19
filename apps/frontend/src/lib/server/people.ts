// What a signed-in person can see and do about their own words on the mirror. These two calls go to the
// dashboard API (the InternalApi entrypoint) through the BACKEND service binding, as the signed-in
// person: the relay checks that the owner header belongs to the Discord user in the path.
//
// Wire shapes expected until the relay's /internal/people routes are built:
// GET /internal/people/:discordUserId -> { consented, granted_at, revoked_at, message_count }
// POST /internal/people/:discordUserId/removal { mode } -> { removed }

import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { FIXTURE_PERSON } from '#lib/fixtures/mirror.js';
import { RelayRequestError, dataSource, p, simulate } from '#lib/server/relay.js';

export interface Person {
  owner_id: string;
  discord_user_id: string;
}

export interface PersonStatus {
  consented: boolean;
  grantedAt: string | null;
  leftAt: string | null;
  messages: number;
}

export type RemovalMode = 'remove_messages' | 'leave';

export class PeopleError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const Status = z.object({
  consented: z.boolean(),
  granted_at: z.string().nullable().optional(),
  revoked_at: z.string().nullable().optional(),
  message_count: z.number().int().min(0),
});
const Removal = z.object({ removed: z.number().int().min(0).optional() });

function describe(status: number): string {
  if (status === 401 || status === 403) return 'Your Discord sign-in doesn’t match this account. Sign out and sign in again.';
  if (status === 429) return 'Too many tries. Wait a minute, then try again.';
  return 'Logitland couldn’t reach the relay. Try again in a minute.';
}

async function call(person: Person, method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ status: number; data: unknown }> {
  if (!env.INTERNAL_TOKEN) throw new PeopleError(500, 'The dashboard isn’t set up to reach the relay yet.');
  const headers: Record<string, string> = { 'x-logitland-internal': env.INTERNAL_TOKEN, 'x-logitland-owner': person.owner_id };
  if (body !== undefined) headers['content-type'] = 'application/json';
  let res: Response;
  try {
    res = await env.BACKEND.fetch(`https://relay.internal${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new PeopleError(502, describe(502));
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  return { status: res.status, data };
}

function path(person: Person, suffix = ''): string {
  try {
    return `${p`/internal/people/${person.discord_user_id}`}${suffix}`;
  } catch (e) {
    if (e instanceof RelayRequestError) throw new PeopleError(400, 'That Discord account isn’t valid.');
    throw e;
  }
}

export async function personStatus(person: Person): Promise<PersonStatus> {
  if (dataSource() === 'fixtures') {
    await simulate(120);
    const granted = new Date(Date.now() - FIXTURE_PERSON.grantedDaysAgo * 86_400_000).toISOString();
    return { consented: FIXTURE_PERSON.consented, grantedAt: granted, leftAt: null, messages: FIXTURE_PERSON.messages };
  }
  const { status, data } = await call(person, 'GET', path(person));
  // The relay has no record of this person: they never agreed and nothing of theirs is shown.
  if (status === 404) return { consented: false, grantedAt: null, leftAt: null, messages: 0 };
  const parsed = status < 400 ? Status.safeParse(data) : null;
  if (!parsed?.success) throw new PeopleError(status >= 400 ? status : 502, describe(status >= 400 ? status : 502));
  return { consented: parsed.data.consented, grantedAt: parsed.data.granted_at ?? null, leftAt: parsed.data.revoked_at ?? null, messages: parsed.data.message_count };
}

export async function removePerson(person: Person, mode: RemovalMode, known: number): Promise<{ removed: number }> {
  if (dataSource() === 'fixtures') {
    await simulate(900);
    return { removed: known };
  }
  const { status, data } = await call(person, 'POST', path(person, '/removal'), { mode });
  if (status >= 400) throw new PeopleError(status, describe(status));
  return { removed: Removal.safeParse(data).data?.removed ?? known };
}
