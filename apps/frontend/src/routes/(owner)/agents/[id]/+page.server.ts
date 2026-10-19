import { IssueKeyRequest, ProfileUpdate, type ApiKey, type Scope } from '@logitland/contracts';
import { error, fail } from '@sveltejs/kit';
import { AGENT_DETAILS, type AgentDetail, type KeyRow } from '#lib/fixtures/agent.js';
import { ago, shortDate } from '#lib/format.js';
import { STATUS_LABEL } from '#lib/labels.js';
import { attempt, refused, signedIn } from '#lib/server/guard.js';
import { RelayRequestError, relay, simulate } from '#lib/server/relay.js';
import { toSubscriptionRow } from '#lib/subscription-view.js';

const SCOPE_WORDS: Record<Scope, string> = { 'messages:read': 'read', 'messages:write': 'write', 'subscriptions:manage': 'subscriptions' };

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

function toKeyRow(k: ApiKey, now = Date.now()): KeyRow {
  const expired = k.expires_at !== null && Date.parse(k.expires_at) <= now;
  return {
    id: k.id,
    label: k.label,
    scopes: k.scopes.map((s) => SCOPE_WORDS[s]).join(', '),
    expiry: k.expires_at ? `${expired ? 'expired' : 'expires'} ${shortDate(k.expires_at)}` : 'no expiry',
    lastUsed: k.last_used_at ? ago(k.last_used_at, now) : 'Not used yet',
    ended: k.revoked_at ? `Revoked ${lower(ago(k.revoked_at, now))}` : expired ? `Expired ${shortDate(k.expires_at!)}` : undefined,
  };
}

function offCopy(running: number): AgentDetail['off'] {
  const intro =
    running === 0
      ? 'Its keys stop working. Messages already in Discord stay there.'
      : running === 1
        ? 'Its keys stop working and its subscription stops. Messages already in Discord stay there.'
        : running === 2
          ? 'Its keys stop working and both subscriptions stop. Messages already in Discord stay there.'
          : `Its keys stop working and all ${running} subscriptions stop. Messages already in Discord stay there.`;
  const subs = running === 0 ? [] : [running === 1 ? '1 subscription stops' : `${running} subscriptions stop`];
  return { intro, effects: [...subs, 'You can turn it back on later'] };
}

export async function load({ params, locals }) {
  const client = relay();
  if (!client || !locals.viewer) {
    const agent = AGENT_DETAILS[params.id];
    if (!agent) error(404, 'No such agent');
    return { agent, live: false };
  }

  // Relay mode: stats and the post preview have no endpoint, so the overview is left out. Subscriptions come
  // from the owner's subscription list, filtered to this agent.
  const ownerId = locals.viewer.owner_id;
  let detail;
  let subs;
  try {
    [detail, subs] = await Promise.all([client.agentDetail(ownerId, params.id), client.listSubscriptions(ownerId)]);
  } catch (e) {
    if (e instanceof RelayRequestError && (e.status === 404 || e.status === 403)) error(404, 'No such agent');
    throw e;
  }
  const { agent: a, keys } = detail;
  const subscriptions = subs.subscriptions.filter((s) => s.agent_id === a.id).map((s) => toSubscriptionRow(s, a));
  const agent: AgentDetail = {
    id: a.id,
    name: a.name,
    tier: a.tier,
    status: a.status,
    statusLabel: STATUS_LABEL[a.status],
    registered: a.created_via === 'dashboard' ? `registered by you on ${shortDate(a.created_at)}` : `signed up on ${shortDate(a.created_at)}`,
    overview: null,
    keys: keys.map((k) => toKeyRow(k)),
    subscriptions,
    profile: { avatarUrl: a.avatar_url ?? '', purpose: a.description ?? '', preview: { time: '', text: a.description ?? '' } },
    off: offCopy(subscriptions.filter((s) => s.tag !== 'stopped').length),
  };
  return { agent, live: true };
}

const randomChars = (n: number, alphabet: string) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => alphabet[b % alphabet.length]).join('');
const ALPHANUMERIC = 'ABCDEFGHJKMNPQRSTVWXYZabcdefghjkmnpqrstvwxyz0123456789';

export const actions = {
  revoke: async ({ request, params, locals, url }) => {
    const viewer = signedIn(locals, url);
    const key = String((await request.formData()).get('key') ?? '');
    if (!key) return fail(400, { message: 'Choose a key to revoke.' });
    const client = relay();
    if (client) {
      const r = await attempt(() => client.revokeKey(viewer.owner_id, params.id, key));
      if (!r.ok) return refused(r.refusal);
    } else {
      await simulate(700);
    }
    return { revoked: key };
  },

  issue: async ({ request, params, locals, url }) => {
    const viewer = signedIn(locals, url);
    const form = await request.formData();
    const days = String(form.get('expires_in_days') ?? '');
    const parsed = IssueKeyRequest.safeParse({ label: String(form.get('label') ?? '').trim() || undefined, expires_in_days: days ? Number(days) : undefined });
    if (!parsed.success) {
      const field = parsed.error.issues[0]?.path[0];
      return fail(400, { message: field === 'label' ? 'Use 60 characters or fewer for the label.' : 'Choose when the key expires.' });
    }
    const { label, expires_in_days } = parsed.data;

    const client = relay();
    if (client) {
      const r = await attempt(() => client.issueKey(viewer.owner_id, params.id, parsed.data));
      if (!r.ok) return refused(r.refusal);
      return { issued: { secret: r.value.secret, row: toKeyRow(r.value) } };
    }
    await simulate(800);
    // Fixtures mode: an example key in the real format. It works nowhere.
    const expires = expires_in_days ? `expires ${shortDate(new Date(Date.now() + expires_in_days * 86_400_000).toISOString())}` : 'no expiry';
    const row: KeyRow = { id: `key_${randomChars(4, ALPHANUMERIC)}`, label: label ?? null, scopes: 'read, write, subscriptions', expiry: expires, lastUsed: 'Not used yet' };
    return { issued: { secret: `lk_${randomChars(40, 'ABCDEFGHJKMNPQRSTVWXYZ0123456789')}`, row } };
  },

  off: async ({ params, locals, url }) => {
    const viewer = signedIn(locals, url);
    const client = relay();
    if (client) {
      const r = await attempt(() => client.turnOff(viewer.owner_id, params.id));
      if (!r.ok) return refused(r.refusal);
      return { status: r.value.agent.status };
    }
    await simulate(800);
    return { status: 'off' as const };
  },

  on: async ({ params, locals, url }) => {
    const viewer = signedIn(locals, url);
    const client = relay();
    if (client) {
      const r = await attempt(() => client.turnOn(viewer.owner_id, params.id));
      if (!r.ok) return refused(r.refusal);
      return { status: r.value.agent.status };
    }
    await simulate(700);
    return { status: 'active' as const };
  },

  profile: async ({ request, params, locals, url }) => {
    const viewer = signedIn(locals, url);
    const form = await request.formData();
    const text = (k: string) => String(form.get(k) ?? '').trim();
    // Only what changed goes to the relay, so unchanged text isn't moderated again.
    const patch: Record<string, string | null> = {};
    if (text('name') !== text('was_name')) patch.name = text('name');
    if (text('description') !== text('was_description')) patch.description = text('description') || null;
    if (text('avatar_url') !== text('was_avatar_url')) patch.avatar_url = text('avatar_url') || null;
    if (!Object.keys(patch).length) return { saved: true as const, unchanged: true as const };

    const parsed = ProfileUpdate.safeParse(patch);
    if (!parsed.success) {
      const fields: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? '');
        if (!key || fields[key]) continue;
        fields[key] =
          key === 'name'
            ? issue.code === 'too_big'
              ? 'Use 32 characters or fewer.'
              : 'Enter a name of 2 to 32 characters.'
            : key === 'description'
              ? 'Use 280 characters or fewer.'
              : 'Enter a full https:// address, or leave it empty.';
      }
      return fail(400, { message: '', policy: null, fields });
    }

    const client = relay();
    if (client) {
      const r = await attempt(() => client.updateAgent(viewer.owner_id, params.id, parsed.data));
      if (!r.ok) return refused(r.refusal);
      return { saved: true as const, unchanged: false as const, name: r.value.agent.name };
    }
    await simulate(700);
    // Fixtures mode: a name containing "impersonat" shows how a moderation refusal reads.
    if (/impersonat/i.test(parsed.data.name ?? '')) {
      return fail(422, { message: 'That name looks like it is pretending to be someone else.', policy: 'impersonation' as const, fields: {} as Record<string, string> });
    }
    return { saved: true as const, unchanged: false as const, name: parsed.data.name };
  },
};
