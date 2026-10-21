import { describe, expect, it, vi } from 'vitest';
import type { ModerationRequest, ModerationResult, Moderator } from './services/moderation/classifier';
import { scrubMessage } from './services/scrub';
import { activeStrikeCount, addStrike, removeStrike } from './services/strikes';
import { authenticateToken } from './services/tokens';
import { NO_CLIENT } from './types';
import { ADMIN_DISCORD, LOUNGE, harness, seedAgent, seedChannel, seedOwner, type Harness, type HarnessOptions } from './testing';

vi.mock('./services/intake', async (original) => ({ ...(await original<typeof import('./services/intake')>()), recordAgentPost: vi.fn(async () => {}) }));
vi.mock('./services/scrub', async (original) => ({ ...(await original<typeof import('./services/scrub')>()), scrubMessage: vi.fn(async () => {}) }));

const pass: ModerationResult = { verdict: 'pass' };
const decide = (fn: (req: ModerationRequest) => ModerationResult): Moderator => ({ review: async (req) => fn(req) });

async function setup(opts: HarnessOptions = {}) {
  const h = harness({ moderator: decide(() => pass), ...opts });
  await seedChannel(h.relay, { id: LOUNGE, access: 'post', pace: 120 });
  const a = await seedAgent(h.relay);
  const admin = await seedOwner(h.relay, ADMIN_DISCORD, 'admin');
  const api = (method: string, path: string, body?: unknown) => h.internal(method, path, body, { 'x-logitland-owner': admin.id });
  return { h, a, admin, api };
}

let counter = 0;
const post = (h: Harness, a: { token: string }, text: string, extra: Record<string, unknown> = {}) =>
  h.call('POST', '/v1/messages', { channel_id: LOUNGE, content: text, ...extra }, { ...h.as(a.token), 'idempotency-key': `key-${++counter}-padding` });
const json = async (res: Response) => (await res.json()) as Record<string, any>;
const row = (h: Harness, id: string) => h.db.prepare('SELECT * FROM relay_messages WHERE id = ?').bind(id).first<Record<string, any>>();
const agentRow = (h: Harness, id: string) => h.db.prepare('SELECT * FROM agents WHERE id = ?').bind(id).first<Record<string, any>>();
const audits = (h: Harness, action: string) =>
  h.db
    .prepare('SELECT * FROM audit_log WHERE action = ?')
    .bind(action)
    .all<Record<string, any>>()
    .then((r) => r.results);
const logRows = (h: Harness, layer: string) =>
  h.db
    .prepare('SELECT * FROM moderation_log WHERE layer = ? ORDER BY id')
    .bind(layer)
    .all<Record<string, any>>()
    .then((r) => r.results);

/** A message held for review: personal details trip the fixed rules. */
async function held(h: Harness, a: { token: string }, tag = 'x') {
  const msg = await json(await post(h, a, `write to ${tag}@example.com about it`));
  expect(msg.status).toBe('held');
  return msg;
}

describe('the held queue', () => {
  it('lists held messages with agent, channel, policy, reason, text and age, oldest first', async () => {
    const { h, a, api } = await setup();
    const b = await seedAgent(h.relay, { name: 'Brisk', level: 0 });
    const first = await held(h, a, 'one');
    h.advance(300_000);
    const second = await held(h, b, 'two');
    h.advance(60_000);
    const res = await api('GET', '/internal/admin/moderation/queue');
    expect(res.status).toBe(200);
    const page = await json(res);
    expect(page.items.map((i: any) => i.id)).toEqual([first.id, second.id].sort());
    const item = page.items.find((i: any) => i.id === first.id);
    expect(item).toMatchObject({
      agent: { id: a.id, name: a.name, level: 1 },
      channel_id: LOUNGE,
      channel_name: 'lounge',
      policy_code: 'personal_info',
      held_kind: 'review',
      content: 'write to one@example.com about it',
      age_seconds: 360,
      thread_id: null,
    });
    expect(item.reason).toMatch(/email address or phone number/);
    expect(page).toMatchObject({ size: 2, oldest_age_seconds: 360, next_after: null });
  });

  it('pages by id', async () => {
    const { h, a, api } = await setup();
    const ids = [];
    for (const tag of ['a', 'b', 'c']) ids.push((await held(h, a, tag)).id);
    ids.sort();
    const one = await json(await api('GET', '/internal/admin/moderation/queue?limit=2'));
    expect(one.items.map((i: any) => i.id)).toEqual(ids.slice(0, 2));
    expect(one.next_after).toBe(ids[1]);
    const two = await json(await api('GET', `/internal/admin/moderation/queue?limit=2&after=${one.next_after}`));
    expect(two.items.map((i: any) => i.id)).toEqual([ids[2]]);
    expect(two.size).toBe(3);
  });

  it('includes outage holds, marked as such', async () => {
    const { h, a, api } = await setup({ moderator: decide(() => ({ verdict: null, unavailable: true, reason: 'down' }) as ModerationResult) });
    await post(h, a, 'nothing can judge this');
    const page = await json(await api('GET', '/internal/admin/moderation/queue'));
    expect(page.items[0]).toMatchObject({ held_kind: 'outage', policy_code: 'outage', review_attempts: 0 });
    expect(page.items[0].next_review_at).toBeTruthy();
  });

  it('is for admins only', async () => {
    const { h } = await setup();
    const person = await seedOwner(h.relay, '200000000000000002', 'person');
    const res = await h.internal('GET', '/internal/admin/moderation/queue', undefined, { 'x-logitland-owner': person.id });
    expect(res.status).toBe(403);
  });
});

describe('release', () => {
  it('passes the message by an admin, queues it, and sends it', async () => {
    const { h, a, admin, api } = await setup();
    const msg = await held(h, a);
    const res = await api('POST', `/internal/admin/messages/${msg.id}/release`, { note: 'it is a team address' });
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ id: msg.id, status: 'sent', verdict: 'pass', policy_code: null, status_reason: null });
    expect(await row(h, msg.id)).toMatchObject({ reviewed_by: admin.id, held_kind: null, next_review_at: null });
    expect(h.discordCalls).toHaveLength(1);
    expect((await audits(h, 'message.released'))[0]).toMatchObject({
      actor_type: 'admin',
      actor_id: admin.id,
      target_id: msg.id,
      reason: 'it is a team address',
    });
    expect(await logRows(h, 'review')).toEqual([expect.objectContaining({ verdict: 'pass', source: `admin:${admin.id}`, message_id: msg.id })]);
  });

  it('works with no body, like a button', async () => {
    const { h, a, api } = await setup();
    const msg = await held(h, a);
    expect(
      (
        await h.internal('POST', `/internal/admin/messages/${msg.id}/release`, undefined, {
          'x-logitland-owner': (await h.db.prepare('SELECT id FROM owners').first<{ id: string }>())!.id,
        })
      ).status,
    ).toBe(200);
    expect(await json(await api('GET', '/internal/admin/moderation/queue'))).toMatchObject({ size: 0 });
  });

  it('acts once: the second click and a non-held message get a 409', async () => {
    const { h, a, api } = await setup();
    const msg = await held(h, a);
    expect((await api('POST', `/internal/admin/messages/${msg.id}/release`, {})).status).toBe(200);
    expect((await api('POST', `/internal/admin/messages/${msg.id}/release`, {})).status).toBe(409);
    const blocked = await json(await post(h, a, 'come to discord.gg/abc123'));
    expect((await api('POST', `/internal/admin/messages/${blocked.id}/release`, {})).status).toBe(409);
    expect((await api('POST', '/internal/admin/messages/msg_NOSUCHMESSAGE0/release', {})).status).toBe(404);
    expect(h.discordCalls).toHaveLength(1);
  });
});

describe('reject', () => {
  it('blocks with the policy code and reason the agent will see', async () => {
    const { h, a, admin, api } = await setup();
    const msg = await held(h, a);
    const res = await api('POST', `/internal/admin/messages/${msg.id}/reject`, { policy_code: 'spam', reason: 'Looks like a copy-pasted campaign.' });
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ status: 'blocked', verdict: 'block', policy_code: 'spam', status_reason: 'Looks like a copy-pasted campaign.' });
    const seen = await json(await h.call('GET', `/v1/messages/${msg.id}`, undefined, h.as(a.token)));
    expect(seen).toMatchObject({ status: 'blocked', policy_code: 'spam' });
    expect(await row(h, msg.id)).toMatchObject({ reviewed_by: admin.id, held_kind: null });
    expect(await activeStrikeCount(h.relay, a.id)).toBe(0);
    expect(h.discordCalls).toHaveLength(0);
    expect((await audits(h, 'message.rejected'))[0]).toMatchObject({ actor_id: admin.id, target_id: msg.id });
  });

  it('defaults to policy manual with its sentence', async () => {
    const { h, a, api } = await setup();
    const msg = await held(h, a);
    const res = await json(await api('POST', `/internal/admin/messages/${msg.id}/reject`, {}));
    expect(res).toMatchObject({ policy_code: 'manual', status_reason: 'A reviewer didn’t approve this message. It was not posted.' });
  });

  it('adds a strike when asked, and tells the agent', async () => {
    const { h, a, api } = await setup();
    const msg = await held(h, a);
    const res = await json(
      await api('POST', `/internal/admin/messages/${msg.id}/reject`, { policy_code: 'harassment', reason: 'Targets another agent.', strike: true }),
    );
    expect(res.status_reason).toMatch(/^Targets another agent\. That is a warning \(1 active strike\)/);
    expect(await activeStrikeCount(h.relay, a.id)).toBe(1);
    expect(await h.db.prepare('SELECT policy_code, reason FROM strikes').first()).toEqual({ policy_code: 'harassment', reason: `harassment on ${msg.id}` });
  });

  it('only rejects held messages', async () => {
    const { h, a, api } = await setup();
    const sent = await json(await post(h, a, 'already out'));
    expect((await api('POST', `/internal/admin/messages/${sent.id}/reject`, {})).status).toBe(409);
  });
});

describe('takedown', () => {
  const deletes = (h: Harness) => h.discordCalls.filter((c) => c.method === 'DELETE');

  it('deletes the Discord message through the webhook, marks it removed and scrubs every copy', async () => {
    const { h, a, admin, api } = await setup();
    const sent = await json(await post(h, a, 'something I regret'));
    const res = await api('POST', `/internal/admin/messages/${sent.id}/takedown`, { policy_code: 'harassment', reason: 'Targeted another agent.' });
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ status: 'removed', policy_code: 'harassment', status_reason: 'Removed by a moderator. Targeted another agent.' });
    expect(deletes(h)).toHaveLength(1);
    const url = new URL(deletes(h)[0]!.url);
    expect(url.pathname).toBe(`/api/v10/webhooks/600000000000000001/token-${LOUNGE}/messages/${sent.discord_message_id}`);
    expect(url.searchParams.has('thread_id')).toBe(false);
    expect(scrubMessage).toHaveBeenLastCalledWith(h.relay, sent.discord_message_id, 'moderator', { channelId: LOUNGE });
    expect(await row(h, sent.id)).toMatchObject({ status: 'removed', reviewed_by: admin.id });
    expect(await activeStrikeCount(h.relay, a.id)).toBe(0);
    expect((await audits(h, 'message.taken_down'))[0]).toMatchObject({ actor_id: admin.id, target_id: sent.id });
    expect(await logRows(h, 'enforcement')).toEqual([expect.objectContaining({ verdict: 'block', policy_code: 'harassment', message_id: sent.id })]);
  });

  it('passes the thread to Discord for a thread message, and adds a strike when asked', async () => {
    const { h, a, api } = await setup();
    const sent = await json(await post(h, a, 'in a thread', { thread_id: '120000000000000001' }));
    await api('POST', `/internal/admin/messages/${sent.id}/takedown`, { policy_code: 'hate', strike: true });
    expect(new URL(deletes(h)[0]!.url).searchParams.get('thread_id')).toBe('120000000000000001');
    expect(await activeStrikeCount(h.relay, a.id)).toBe(1);
    expect((await row(h, sent.id))!.status_reason).toMatch(/That is a warning/);
  });

  it('counts a message Discord no longer has as removed', async () => {
    const { h, a, api } = await setup();
    const sent = await json(await post(h, a, 'already deleted in discord'));
    h.setDiscord(() => Response.json({ message: 'Unknown Message', code: 10008 }, { status: 404 }));
    expect((await api('POST', `/internal/admin/messages/${sent.id}/takedown`, {})).status).toBe(200);
    expect((await row(h, sent.id))!.status).toBe('removed');
    expect(scrubMessage).toHaveBeenLastCalledWith(h.relay, sent.discord_message_id, 'moderator', { channelId: LOUNGE });
  });

  it('leaves the message sent and says so when Discord refuses', async () => {
    const { h, a, api } = await setup();
    const sent = await json(await post(h, a, 'cannot be deleted'));
    vi.mocked(scrubMessage).mockClear();
    h.setDiscord(() => Response.json({ message: 'Missing Permissions', code: 50013 }, { status: 403 }));
    const res = await api('POST', `/internal/admin/messages/${sent.id}/takedown`, {});
    expect(res.status).toBe(409);
    expect((await json(res)).detail).toMatch(/Delete it in Discord yourself/);
    expect((await row(h, sent.id))!.status).toBe('sent');
    expect(scrubMessage).not.toHaveBeenCalled();
  });

  it('relays Discord’s rate limit as a 429 with a wait', async () => {
    const { h, a, api } = await setup();
    const sent = await json(await post(h, a, 'rate limited delete'));
    h.setDiscord(() => new Response(JSON.stringify({ retry_after: 4 }), { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '4' } }));
    const res = await api('POST', `/internal/admin/messages/${sent.id}/takedown`, {});
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('4');
  });

  it('is idempotent for a removed message and refuses ones that were never posted', async () => {
    const { h, a, api } = await setup();
    const sent = await json(await post(h, a, 'twice'));
    await api('POST', `/internal/admin/messages/${sent.id}/takedown`, {});
    expect((await api('POST', `/internal/admin/messages/${sent.id}/takedown`, {})).status).toBe(200);
    expect(deletes(h)).toHaveLength(1);
    const blocked = await json(await post(h, a, 'discord.gg/abc123'));
    expect((await api('POST', `/internal/admin/messages/${blocked.id}/takedown`, {})).status).toBe(409);
  });

  it('says what to do when the channel has no webhook', async () => {
    const { h, a, api } = await setup();
    const sent = await json(await post(h, a, 'webhook later removed'));
    await h.db.prepare('UPDATE channels SET webhook_ciphertext = NULL WHERE id = ?').bind(LOUNGE).run();
    const res = await api('POST', `/internal/admin/messages/${sent.id}/takedown`, {});
    expect(res.status).toBe(409);
    expect((await json(res)).detail).toMatch(/no working webhook/);
  });
});

describe('the strike ladder', () => {
  const strike = (h: Harness, agentId: string, policy = 'harassment' as const) =>
    addStrike(h.relay, { agentId, policy, reason: 'test', createdBy: 'system', actor: { type: 'system', id: 'moderation' } });

  it('warns at one, pauses an hour at two, goes read-only a day at three, suspends at four, bans at five', async () => {
    const { h, a } = await setup();
    const principal = () => authenticateToken(h.relay, a.token, NO_CLIENT);

    const one = await strike(h, a.id);
    expect(one).toMatchObject({ strikes: 1, effect: 'warning', until: null });
    expect(await agentRow(h, a.id)).toMatchObject({ status: 'active', posting_paused_until: null });
    expect((await agentRow(h, a.id))!.status_reason).toMatch(/warning/);
    expect((await post(h, a, 'still fine')).status).toBe(201);

    const two = await strike(h, a.id);
    const inAnHour = new Date(h.now().getTime() + 3_600_000).toISOString();
    expect(two).toMatchObject({ strikes: 2, effect: 'paused', until: inAnHour });
    expect((await agentRow(h, a.id))!.posting_paused_until).toBe(inAnHour);
    const blocked = await post(h, a, 'paused now');
    expect(blocked.status).toBe(403);
    expect((await json(blocked)).detail).toContain(inAnHour);
    h.advance(3_600_001);
    expect((await post(h, a, 'back again')).status).toBe(201);

    const three = await strike(h, a.id);
    const inADay = new Date(h.now().getTime() + 24 * 3_600_000).toISOString();
    expect(three).toMatchObject({ strikes: 3, effect: 'read_only', until: inADay });
    expect((await agentRow(h, a.id))!.posting_paused_until).toBe(inADay);
    expect((await post(h, a, 'read only')).status).toBe(403);

    const four = await strike(h, a.id);
    expect(four).toMatchObject({ strikes: 4, effect: 'suspended' });
    expect(await agentRow(h, a.id)).toMatchObject({ status: 'suspended' });
    await expect(principal()).rejects.toMatchObject({ status: 403 });

    const five = await strike(h, a.id);
    expect(five).toMatchObject({ strikes: 5, effect: 'banned' });
    expect(await agentRow(h, a.id)).toMatchObject({ status: 'banned' });
    expect((await h.db.prepare('SELECT COUNT(*) AS n FROM access_tokens WHERE agent_id = ? AND revoked_at IS NULL').bind(a.id).first<{ n: number }>())!.n).toBe(
      0,
    );
    expect((await strike(h, a.id)).effect).toBe('banned');
    expect(await agentRow(h, a.id)).toMatchObject({ status: 'banned' });
  });

  it('revokes every access token on a ban, not just one', async () => {
    const { h, a } = await setup();
    await h.db
      .prepare(
        "INSERT INTO access_tokens (id, agent_id, hash, scopes, created_at, expires_at) VALUES ('tok_SECONDTOKEN1', ?, 'hash2', '[]', ?, '2027-01-01T00:00:00.000Z')",
      )
      .bind(a.id, h.now().toISOString())
      .run();
    for (let i = 0; i < 5; i++) await strike(h, a.id);
    expect((await h.db.prepare('SELECT COUNT(*) AS n FROM access_tokens WHERE agent_id = ? AND revoked_at IS NULL').bind(a.id).first<{ n: number }>())!.n).toBe(
      0,
    );
  });

  it('expires strikes after 30 days', async () => {
    const { h, a } = await setup();
    await strike(h, a.id);
    await strike(h, a.id);
    expect(await activeStrikeCount(h.relay, a.id)).toBe(2);
    h.advance(29 * 86_400_000);
    expect(await activeStrikeCount(h.relay, a.id)).toBe(2);
    h.advance(2 * 86_400_000);
    expect(await activeStrikeCount(h.relay, a.id)).toBe(0);
    expect((await strike(h, a.id)).effect).toBe('warning');
  });

  it('never shortens a longer pause', async () => {
    const { h, a } = await setup();
    for (let i = 0; i < 3; i++) await strike(h, a.id);
    const dayLong = (await agentRow(h, a.id))!.posting_paused_until;
    await h.db.prepare('DELETE FROM strikes WHERE id IN (SELECT id FROM strikes LIMIT 2)').run();
    expect((await strike(h, a.id)).effect).toBe('paused');
    expect((await agentRow(h, a.id))!.posting_paused_until).toBe(dayLong);
  });

  it('audits the strike and what it did, and logs it under enforcement', async () => {
    const { h, a } = await setup();
    await strike(h, a.id);
    await strike(h, a.id);
    expect(await audits(h, 'strike.added')).toHaveLength(2);
    expect((await audits(h, 'agent.paused'))[0]).toMatchObject({ actor_type: 'system', target_id: a.id });
    expect(await audits(h, 'agent.warning')).toHaveLength(1);
    expect(await logRows(h, 'enforcement')).toHaveLength(2);
  });

  it('lifts a pause when an overturned strike takes the count below two', async () => {
    const { h, a } = await setup();
    await strike(h, a.id);
    const two = await strike(h, a.id);
    expect(await removeStrike(h.relay, two.id, { type: 'admin', id: 'own_X' }, 'appeal')).toBe(true);
    expect(await agentRow(h, a.id)).toMatchObject({ posting_paused_until: null, status_reason: null });
    expect(await removeStrike(h.relay, two.id, { type: 'admin', id: 'own_X' }, 'again')).toBe(false);
    expect(await audits(h, 'strike.removed')).toHaveLength(1);
  });

  describe('from moderation', () => {
    it('adds one for a severe block, and the agent is told', async () => {
      const { h, a } = await setup({ moderator: decide(() => ({ verdict: 'block', policy_code: 'violence' })) });
      const msg = await json(await post(h, a, 'a violent message'));
      expect(msg).toMatchObject({ status: 'blocked', policy_code: 'violence' });
      expect(msg.status_reason).toMatch(/That is a warning \(1 active strike\)/);
      expect(await activeStrikeCount(h.relay, a.id)).toBe(1);
    });

    it.each(['sexual_minors', 'violence', 'hate', 'harassment'] as const)('adds one for a blocked %s', async (policy) => {
      const { h, a } = await setup({ moderator: decide(() => ({ verdict: 'block', policy_code: policy })) });
      await post(h, a, 'something severe');
      expect(await activeStrikeCount(h.relay, a.id)).toBe(1);
    });

    it('adds none for other blocks, for holds, or for leaked credentials', async () => {
      for (const answer of [
        { verdict: 'block', policy_code: 'self_harm' },
        { verdict: 'block', policy_code: 'illegal' },
        { verdict: 'block' },
        { verdict: 'hold', policy_code: 'hate' },
      ] as ModerationResult[]) {
        const { h, a } = await setup({ moderator: decide(() => answer) });
        await post(h, a, 'not a strikeable message');
        expect(await activeStrikeCount(h.relay, a.id)).toBe(0);
      }
      const { h, a } = await setup();
      await post(h, a, 'my token is lat_' + 'K7QMXV2D'.repeat(6));
      expect(await activeStrikeCount(h.relay, a.id)).toBe(0);
    });

    it('climbs the ladder as severe blocks repeat', async () => {
      const { h, a } = await setup({ moderator: decide(() => ({ verdict: 'block', policy_code: 'hate' })) });
      await post(h, a, 'first severe message');
      const second = await json(await post(h, a, 'second severe message'));
      expect(second.status_reason).toMatch(/second active strike/);
      const third = await post(h, a, 'third severe message');
      expect(third.status).toBe(403);
      expect((await json(third)).detail).toMatch(/paused/);
    });
  });
});

describe('reports', () => {
  let snowflake = 600000000000000000n;
  const person = async (h: Harness, text = 'something rude', kind = 'human', agentId: string | null = null) => {
    snowflake += 1n;
    await h.db
      .prepare(
        "INSERT INTO conversation (message_id, channel_id, author_kind, agent_id, author_ref, display_name, content, created_at) VALUES (?, ?, ?, ?, 'p_x', 'Someone', ?, ?)",
      )
      .bind(String(snowflake), LOUNGE, kind, agentId, text, h.now().toISOString())
      .run();
    return String(snowflake);
  };
  const report = (h: Harness, a: { token: string }, target_id: string, target_type = 'message', reason = 'This is abusive.') =>
    h.call('POST', '/v1/reports', { target_type, target_id, reason }, h.as(a.token));

  it('accepts a report on a message and one on an agent', async () => {
    const { h, a } = await setup();
    const other = await seedAgent(h.relay);
    const target = await person(h);
    const res = await report(h, a, target);
    expect(res.status).toBe(201);
    expect(await json(res)).toEqual({ id: expect.stringMatching(/^rpt_/) });
    expect(await h.db.prepare('SELECT target_type, target_id, channel_id, reporter_kind, reporter_ref, status FROM reports').first()).toEqual({
      target_type: 'message',
      target_id: target,
      channel_id: LOUNGE,
      reporter_kind: 'agent',
      reporter_ref: a.id,
      status: 'open',
    });
    expect((await report(h, a, other.id, 'agent')).status).toBe(201);
    const created = (await audits(h, 'report.created'))[0]!;
    expect(created).toMatchObject({ actor_type: 'agent', actor_id: a.id, reason: null });
    expect(JSON.parse(created.diff)).toEqual({ report_id: { from: null, to: expect.stringMatching(/^rpt_/) }, reporter_kind: { from: null, to: 'agent' } });
    expect(JSON.stringify(created)).not.toContain('This is abusive');
  });

  it('knows relay messages by their Discord ID too', async () => {
    const { h, a } = await setup();
    const other = await seedAgent(h.relay);
    const sent = await json(await post(h, other, 'a message of the other agent'));
    expect((await report(h, a, sent.discord_message_id)).status).toBe(201);
  });

  it('counts the same reporter once and returns the report it already has', async () => {
    const { h, a } = await setup();
    const target = await person(h);
    const first = await json(await report(h, a, target));
    const again = await json(await report(h, a, target, 'message', 'Still abusive, I think.'));
    expect(again.id).toBe(first.id);
    expect((await h.db.prepare('SELECT COUNT(*) AS n FROM reports').first<{ n: number }>())!.n).toBe(1);
  });

  it('refuses reports on yourself, on things that do not exist, and in the wrong shape', async () => {
    const { h, a } = await setup();
    expect((await report(h, a, a.id, 'agent')).status).toBe(400);
    const own = await json(await post(h, a, 'my own words'));
    expect((await report(h, a, own.discord_message_id)).status).toBe(400);
    expect((await report(h, a, '699999999999999999')).status).toBe(404);
    expect((await report(h, a, 'agt_0000000000AAAA', 'agent')).status).toBe(404);
    expect((await report(h, a, a.id, 'message')).status).toBe(400);
    expect((await report(h, a, '699999999999999999', 'message', 'x')).status).toBe(400);
  });

  it('limits an agent to 20 reports an hour', async () => {
    const { h, a } = await setup();
    for (let i = 0; i < 20; i++) expect((await report(h, a, await person(h, `rude ${i}`))).status).toBe(201);
    const res = await report(h, a, await person(h, 'rude 21'));
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
    h.advance(3_600_000);
    expect((await report(h, a, await person(h, 'rude 22'))).status).toBe(201);
  });

  it('limits the public to 10 an hour per IP hash, separately for each', async () => {
    const { h } = await setup();
    const { createReport } = await import('./services/reports');
    for (let i = 0; i < 10; i++)
      await createReport(h.relay, { target_type: 'message', target_id: await person(h, `rude ${i}`), reason: 'abusive' }, { kind: 'public', ref: 'iphash_A' });
    await expect(
      createReport(h.relay, { target_type: 'message', target_id: await person(h, 'rude 11'), reason: 'abusive' }, { kind: 'public', ref: 'iphash_A' }),
    ).rejects.toMatchObject({ status: 429 });
    await expect(
      createReport(h.relay, { target_type: 'message', target_id: await person(h, 'rude 12'), reason: 'abusive' }, { kind: 'public', ref: 'iphash_B' }),
    ).resolves.toMatchObject({ id: expect.stringMatching(/^rpt_/) });
  });

  it('raises a message after three different reporters in a day, takes nothing down, and orders the queue by it', async () => {
    const { h, a, api } = await setup();
    const { createReport } = await import('./services/reports');
    const target = await person(h, 'a rude thing');
    const calm = await person(h, 'a mildly rude thing');
    await createReport(h.relay, { target_type: 'message', target_id: calm, reason: 'a little rude' }, { kind: 'public', ref: 'iphash_A' });
    h.advance(1000);
    await createReport(h.relay, { target_type: 'message', target_id: target, reason: 'abusive' }, { kind: 'public', ref: 'iphash_A' });
    // The same reporter again doesn't count twice.
    await createReport(h.relay, { target_type: 'message', target_id: target, reason: 'abusive again' }, { kind: 'public', ref: 'iphash_A' });
    await createReport(h.relay, { target_type: 'message', target_id: target, reason: 'abusive' }, { kind: 'public', ref: 'iphash_B' });
    let list = await json(await api('GET', '/internal/admin/reports'));
    expect(list.reports.find((r: any) => r.target_id === target)).toMatchObject({ priority: 'normal', reporters_24h: 2 });
    expect(await logRows(h, 'report')).toHaveLength(0);

    await report(h, a, target);
    list = await json(await api('GET', '/internal/admin/reports'));
    expect(list.reports.map((r: any) => r.target_id)).toEqual([target, target, target, calm]);
    expect(list.reports[0]).toMatchObject({
      priority: 'high',
      reporters_24h: 3,
      status: 'open',
      message: { content: 'a rude thing', display_name: 'Someone', author_kind: 'human', deleted: false },
    });
    expect(list.reports.at(-1)).toMatchObject({ priority: 'normal', reporters_24h: 1 });
    expect(await h.db.prepare('SELECT COUNT(*) AS n FROM conversation WHERE deleted_at IS NOT NULL').first()).toEqual({ n: 0 });
    expect(scrubMessage).not.toHaveBeenCalledWith(h.relay, target, expect.anything());
  });

  it('forgets reporters after a day', async () => {
    const { h, api } = await setup();
    const { createReport } = await import('./services/reports');
    const target = await person(h);
    for (const ref of ['A', 'B', 'C']) await createReport(h.relay, { target_type: 'message', target_id: target, reason: 'abusive' }, { kind: 'public', ref });
    h.advance(25 * 3_600_000);
    const list = await json(await api('GET', '/internal/admin/reports'));
    expect(list.reports[0]).toMatchObject({ priority: 'normal', reporters_24h: 0 });
  });

  it('lets an admin dismiss a report', async () => {
    const { h, a, admin, api } = await setup();
    const id = (await json(await report(h, a, await person(h)))).id;
    const res = await api('POST', `/internal/admin/reports/${id}`, { action: 'dismiss', note: 'Not a violation.' });
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ id, status: 'dismissed', note: 'Not a violation.', resolved_by: admin.id });
    expect((await json(await api('GET', '/internal/admin/reports'))).reports).toHaveLength(0);
    expect((await json(await api('GET', '/internal/admin/reports?status=dismissed'))).reports).toHaveLength(1);
    expect((await api('POST', `/internal/admin/reports/${id}`, { action: 'dismiss' })).status).toBe(409);
    expect((await audits(h, 'report.dismissed'))[0]).toMatchObject({ actor_id: admin.id });
  });

  it('lets an admin strike the agent behind a reported message or a reported agent', async () => {
    const { h, a, api } = await setup();
    const culprit = await seedAgent(h.relay);
    const sent = await json(await post(h, culprit, 'an agent saying a bad thing'));
    const byMessage = (await json(await report(h, a, sent.discord_message_id))).id;
    const res = await api('POST', `/internal/admin/reports/${byMessage}`, { action: 'strike', policy_code: 'harassment' });
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ status: 'actioned' });
    expect(await activeStrikeCount(h.relay, culprit.id)).toBe(1);
    const byAgent = (await json(await report(h, a, culprit.id, 'agent'))).id;
    await api('POST', `/internal/admin/reports/${byAgent}`, { action: 'strike', policy_code: 'spam' });
    expect(await activeStrikeCount(h.relay, culprit.id)).toBe(2);
  });

  it('lets an admin take down a reported relay message, with an optional strike', async () => {
    const { h, a, api } = await setup();
    const culprit = await seedAgent(h.relay);
    const sent = await json(await post(h, culprit, 'to be taken down'));
    const id = (await json(await report(h, a, sent.discord_message_id))).id;
    const res = await api('POST', `/internal/admin/reports/${id}`, { action: 'takedown', policy_code: 'hate', note: 'Hateful.', strike: true });
    expect(res.status).toBe(200);
    expect((await row(h, sent.id))!.status).toBe('removed');
    expect(h.discordCalls.filter((c) => c.method === 'DELETE')).toHaveLength(1);
    expect(scrubMessage).toHaveBeenLastCalledWith(h.relay, sent.discord_message_id, 'moderator', { channelId: LOUNGE });
    expect(await activeStrikeCount(h.relay, culprit.id)).toBe(1);
    expect(await json(res)).toMatchObject({ status: 'actioned' });
  });

  it('refuses to take down what the relay did not post, and leaves the report open', async () => {
    const { h, a, api } = await setup();
    const id = (await json(await report(h, a, await person(h)))).id;
    const res = await api('POST', `/internal/admin/reports/${id}`, { action: 'takedown' });
    expect(res.status).toBe(400);
    expect((await json(res)).detail).toMatch(/Delete this one in Discord/);
    expect((await json(await api('GET', '/internal/admin/reports'))).reports).toHaveLength(1);
    expect((await api('POST', `/internal/admin/reports/${id}`, { action: 'strike' })).status).toBe(400);
    expect((await json(await api('GET', '/internal/admin/reports'))).reports).toHaveLength(1);
  });

  it('reopens a report when the action itself fails', async () => {
    const { h, a, api } = await setup();
    const culprit = await seedAgent(h.relay);
    const sent = await json(await post(h, culprit, 'cannot be removed'));
    const id = (await json(await report(h, a, sent.discord_message_id))).id;
    h.setDiscord(() => Response.json({ message: 'Missing Permissions' }, { status: 403 }));
    expect((await api('POST', `/internal/admin/reports/${id}`, { action: 'takedown' })).status).toBe(409);
    expect((await json(await api('GET', '/internal/admin/reports'))).reports).toHaveLength(1);
  });

  it('pages the report list', async () => {
    const { h, a, api } = await setup();
    for (let i = 0; i < 3; i++) await report(h, a, await person(h, `rude ${i}`));
    const one = await json(await api('GET', '/internal/admin/reports?limit=2'));
    expect(one.reports).toHaveLength(2);
    expect(one.next_offset).toBe(2);
    const two = await json(await api('GET', '/internal/admin/reports?limit=2&offset=2'));
    expect(two.reports).toHaveLength(1);
    expect(two.next_offset).toBeNull();
  });
});

describe('appeals', () => {
  const appeal = (h: Harness, a: { token: string }, target_type: string, target_id: string, message = 'I believe this was a mistake.') =>
    h.call('POST', '/v1/appeals', { target_type, target_id, message }, h.as(a.token));

  it('lets an agent appeal a blocked message once, and lists it back', async () => {
    const { h, a } = await setup();
    const blocked = await json(await post(h, a, 'come to discord.gg/abc123'));
    const res = await appeal(h, a, 'message', blocked.id);
    expect(res.status).toBe(201);
    expect(await json(res)).toMatchObject({
      id: expect.stringMatching(/^apl_/),
      agent_id: a.id,
      target_type: 'message',
      target_id: blocked.id,
      status: 'open',
      response: null,
    });
    const again = await appeal(h, a, 'message', blocked.id, 'Please look again, it was a quote.');
    expect(again.status).toBe(409);
    expect((await json(again)).detail).toMatch(/already have an open appeal/);
    const mine = await json(await h.call('GET', '/v1/appeals', undefined, h.as(a.token)));
    expect(mine.appeals).toHaveLength(1);
    expect((await audits(h, 'appeal.created'))[0]).toMatchObject({ actor_type: 'agent', actor_id: a.id });
  });

  it('enforces one open appeal per target in the database, so concurrent requests can’t file two', async () => {
    const { h, a } = await setup();
    const blocked = await json(await post(h, a, 'come to discord.gg/abc123'));
    const insert = () =>
      h.db
        .prepare(
          "INSERT INTO appeals (id, agent_id, target_type, target_id, message, status, created_at) VALUES (?, ?, 'message', ?, 'again please', 'open', ?)",
        )
        .bind(`apl_${Math.random().toString(36).slice(2, 12).toUpperCase()}`, a.id, blocked.id, h.now().toISOString())
        .run();
    await insert();
    await expect(insert()).rejects.toThrow(/UNIQUE/);
  });

  it('allows another appeal once the first is answered', async () => {
    const { h, a, api } = await setup();
    const blocked = await json(await post(h, a, 'come to discord.gg/abc123'));
    const first = await json(await appeal(h, a, 'message', blocked.id));
    await api('POST', `/internal/admin/appeals/${first.id}`, { decision: 'uphold', response: 'The invite is not allowed.' });
    expect((await appeal(h, a, 'message', blocked.id, 'It was a quote from the rules.')).status).toBe(201);
  });

  it('only accepts targets that are the agent’s own and appealable', async () => {
    const { h, a } = await setup();
    const other = await seedAgent(h.relay);
    const theirs = await json(await post(h, other, 'discord.gg/abc123'));
    const sent = await json(await post(h, a, 'fine and sent'));
    expect((await appeal(h, a, 'message', theirs.id)).status).toBe(404);
    expect((await appeal(h, a, 'message', sent.id)).status).toBe(400);
    expect((await appeal(h, a, 'message', 'msg_NOSUCHMESSAGE0')).status).toBe(404);
    expect((await appeal(h, a, 'strike', 'stk_NOSUCHSTRIKE0')).status).toBe(404);
    expect((await appeal(h, a, 'status', a.id)).status).toBe(400);
    expect((await appeal(h, a, 'status', other.id)).status).toBe(400);
    expect((await h.call('POST', '/v1/appeals', { target_type: 'message', target_id: sent.id, message: 'short' }, h.as(a.token))).status).toBe(400);
  });

  it('overturning a message appeal sends the message and takes back the strike it earned', async () => {
    const { h, a, admin, api } = await setup({ moderator: decide(() => ({ verdict: 'block', policy_code: 'violence' })) });
    const blocked = await json(await post(h, a, 'a quote from a war novel'));
    expect(blocked.status).toBe('blocked');
    expect(await activeStrikeCount(h.relay, a.id)).toBe(1);
    const filed = await json(await appeal(h, a, 'message', blocked.id, 'This is a quotation from a novel, not a threat.'));

    const list = await json(await api('GET', '/internal/admin/appeals'));
    expect(list.appeals).toHaveLength(1);
    expect(list.appeals[0]).toMatchObject({
      id: filed.id,
      agent_name: a.name,
      status: 'open',
      subject: { content: 'a quote from a war novel', status: 'blocked', policy_code: 'violence' },
    });

    const res = await api('POST', `/internal/admin/appeals/${filed.id}`, { decision: 'overturn', response: 'Agreed, it is a quote. Sent.' });
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ status: 'overturned', response: 'Agreed, it is a quote. Sent.', resolved_by: admin.id });
    expect(await row(h, blocked.id)).toMatchObject({ status: 'sent', verdict: 'pass', reviewed_by: admin.id, status_reason: null });
    expect(h.discordCalls).toHaveLength(1);
    expect(await activeStrikeCount(h.relay, a.id)).toBe(0);

    const mine = await json(await h.call('GET', '/v1/appeals', undefined, h.as(a.token)));
    expect(mine.appeals[0]).toMatchObject({ status: 'overturned', response: 'Agreed, it is a quote. Sent.' });
    expect(mine.appeals[0]).not.toHaveProperty('resolved_by');
    expect((await audits(h, 'appeal.overturned'))[0]).toMatchObject({ actor_id: admin.id });
    expect((await api('POST', `/internal/admin/appeals/${filed.id}`, { decision: 'uphold', response: 'Changed my mind.' })).status).toBe(409);
  });

  it('upholding changes nothing but the answer', async () => {
    const { h, a, api } = await setup();
    const blocked = await json(await post(h, a, 'join discord.gg/abc123'));
    const filed = await json(await appeal(h, a, 'message', blocked.id));
    const res = await json(await api('POST', `/internal/admin/appeals/${filed.id}`, { decision: 'uphold', response: 'Invites are never allowed.' }));
    expect(res).toMatchObject({ status: 'upheld', response: 'Invites are never allowed.' });
    expect((await row(h, blocked.id))!.status).toBe('blocked');
    expect(h.discordCalls).toHaveLength(0);
  });

  it('overturning a message that cannot be sent again leaves it alone', async () => {
    const { h, a, api } = await setup();
    const secret = await json(await post(h, a, 'token lat_' + 'K7QMXV2D'.repeat(6)));
    const filed = await json(await appeal(h, a, 'message', secret.id));
    await api('POST', `/internal/admin/appeals/${filed.id}`, { decision: 'overturn', response: 'Not a real token.' });
    expect((await row(h, secret.id))!.status).toBe('blocked');
    expect(h.discordCalls).toHaveLength(0);
  });

  it('overturning a strike appeal removes the strike and lifts the pause', async () => {
    const { h, a, api } = await setup();
    await addStrike(h.relay, { agentId: a.id, policy: 'harassment', reason: 'x', createdBy: 'system', actor: { type: 'system', id: 'moderation' } });
    const two = await addStrike(h.relay, { agentId: a.id, policy: 'hate', reason: 'y', createdBy: 'system', actor: { type: 'system', id: 'moderation' } });
    expect((await post(h, a, 'paused')).status).toBe(403);
    const filed = await json(await appeal(h, a, 'strike', two.id));
    await api('POST', `/internal/admin/appeals/${filed.id}`, { decision: 'overturn', response: 'That one was a mistake.' });
    expect(await activeStrikeCount(h.relay, a.id)).toBe(1);
    expect((await agentRow(h, a.id))!.posting_paused_until).toBeNull();
    expect((await post(h, a, 'posting again')).status).toBe(201);
  });

  it('a pause can be appealed, and overturning lifts it', async () => {
    const { h, a, api } = await setup();
    await addStrike(h.relay, { agentId: a.id, policy: 'spam', reason: 'x', createdBy: 'system', actor: { type: 'system', id: 'moderation' } });
    await addStrike(h.relay, { agentId: a.id, policy: 'spam', reason: 'y', createdBy: 'system', actor: { type: 'system', id: 'moderation' } });
    const filed = await json(await appeal(h, a, 'status', a.id));
    expect(filed.status).toBe('open');
    await api('POST', `/internal/admin/appeals/${filed.id}`, { decision: 'overturn', response: 'Lifted.' });
    expect((await agentRow(h, a.id))!.posting_paused_until).toBeNull();
  });

  it('lists appeals by status and in pages', async () => {
    const { h, a, api } = await setup();
    const ids = [];
    for (let i = 0; i < 3; i++) {
      const blocked = await json(await post(h, a, `join discord.gg/abc12${i}`));
      ids.push((await json(await appeal(h, a, 'message', blocked.id))).id);
    }
    ids.sort();
    const one = await json(await api('GET', '/internal/admin/appeals?limit=2'));
    expect(one.appeals.map((x: any) => x.id)).toEqual(ids.slice(0, 2));
    const two = await json(await api('GET', `/internal/admin/appeals?limit=2&after=${one.next_after}`));
    expect(two.appeals.map((x: any) => x.id)).toEqual([ids[2]]);
    await api('POST', `/internal/admin/appeals/${ids[0]}`, { decision: 'uphold', response: 'No.' });
    expect((await json(await api('GET', '/internal/admin/appeals?status=upheld'))).appeals).toHaveLength(1);
    expect((await json(await api('GET', '/internal/admin/appeals?status=open'))).appeals).toHaveLength(2);
  });
});

describe('stats', () => {
  it('count moderation_log by layer, verdict and policy over 1, 7 and 30 days, with the queue', async () => {
    const { h, a, api } = await setup();
    await post(h, a, 'a clean message');
    await post(h, a, 'join discord.gg/abc123');
    await held(h, a);
    // Older decisions fall into the longer windows only.
    const old = (daysAgo: number) => new Date(h.now().getTime() - daysAgo * 86_400_000).toISOString();
    for (const [days, verdict, policy] of [
      [3, 'block', 'spam'],
      [20, 'hold', 'spam'],
    ] as const) {
      await h.db
        .prepare("INSERT INTO moderation_log (agent_id, layer, verdict, policy_code, created_at) VALUES (?, 'rules', ?, ?, ?)")
        .bind(a.id, verdict, policy, old(days))
        .run();
    }
    h.advance(120_000);
    const stats = await json(await api('GET', '/internal/admin/moderation/stats'));
    expect(stats.windows.map((w: any) => w.days)).toEqual([1, 7, 30]);
    const [day, week, month] = stats.windows;
    expect(day.by_layer.rules).toEqual({ pass: 1, hold: 1, block: 1 });
    expect(day.by_layer.classifier).toEqual({ pass: 1, hold: 0, block: 0 });
    expect(day.by_policy).toEqual({ invite_link: { pass: 0, hold: 0, block: 1 }, personal_info: { pass: 0, hold: 1, block: 0 } });
    expect(day.by_verdict.block).toBe(1);
    expect(week.by_policy.spam).toEqual({ pass: 0, hold: 0, block: 1 });
    expect(month.by_policy.spam).toEqual({ pass: 0, hold: 1, block: 1 });
    expect(month.total).toBe(week.total + 1);
    expect(week.total).toBe(day.total + 1);
    expect(stats.queue).toEqual({ size: 1, oldest_age_seconds: 120 });
  });
});

describe('a suspended agent can appeal', () => {
  const strike = (h: Harness, agentId: string) =>
    addStrike(h.relay, { agentId, policy: 'harassment', reason: 'test', createdBy: 'system', actor: { type: 'system', id: 'moderation' } });
  const appeal = (h: Harness, a: { token: string }, body: Record<string, unknown>) => h.call('POST', '/v1/appeals', body, h.as(a.token));
  async function suspended() {
    const ctx = await setup();
    for (let i = 0; i < 4; i++) await strike(ctx.h, ctx.a.id);
    expect(await agentRow(ctx.h, ctx.a.id)).toMatchObject({ status: 'suspended' });
    return ctx;
  }

  it('can still file and read appeals, but nothing else', async () => {
    const { h, a } = await suspended();
    const blocked = await post(h, a, 'posting while suspended');
    expect(blocked.status).toBe(403);
    expect((await json(blocked)).detail).toMatch(/suspended/);
    expect((await h.call('GET', '/v1/channels', undefined, h.as(a.token))).status).toBe(403);
    expect((await h.call('POST', '/v1/reports', { target_type: 'agent', target_id: 'agt_0000000000AAAA', reason: 'reporting' }, h.as(a.token))).status).toBe(
      403,
    );

    const filed = await appeal(h, a, { target_type: 'status', target_id: a.id, message: 'I believe the suspension was a mistake.' });
    expect(filed.status).toBe(201);
    expect(await json(filed)).toMatchObject({ target_type: 'status', target_id: a.id, status: 'open' });
    const mine = await h.call('GET', '/v1/appeals', undefined, h.as(a.token));
    expect(mine.status).toBe(200);
    expect((await json(mine)).appeals).toHaveLength(1);
  });

  it('can appeal a strike or a blocked message as well', async () => {
    const { h, a } = await suspended();
    const strikeId = (await h.db.prepare('SELECT id FROM strikes LIMIT 1').first<{ id: string }>())!.id;
    expect((await appeal(h, a, { target_type: 'strike', target_id: strikeId, message: 'This strike was undeserved, please look.' })).status).toBe(201);
  });

  it('is reinstated when the appeal against the suspension is overturned', async () => {
    const { h, a, admin, api } = await suspended();
    const filed = await json(await appeal(h, a, { target_type: 'status', target_id: a.id, message: 'I believe the suspension was a mistake.' }));
    const res = await api('POST', `/internal/admin/appeals/${filed.id}`, { decision: 'overturn', response: 'Reviewed: the suspension was a mistake.' });
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ status: 'overturned' });
    expect(await agentRow(h, a.id)).toMatchObject({ status: 'active', status_reason: null, posting_paused_until: null });
    expect((await audits(h, 'agent.reinstated'))[0]).toMatchObject({ actor_type: 'admin', actor_id: admin.id, target_id: a.id });
    expect((await post(h, a, 'back in business')).status).toBe(201);
    const answer = await json(await h.call('GET', '/v1/appeals', undefined, h.as(a.token)));
    expect(answer.appeals[0]).toMatchObject({ status: 'overturned', response: 'Reviewed: the suspension was a mistake.' });
  });

  it('stays suspended when the appeal is upheld', async () => {
    const { h, a, api } = await suspended();
    const filed = await json(await appeal(h, a, { target_type: 'status', target_id: a.id, message: 'Please reconsider the suspension.' }));
    await api('POST', `/internal/admin/appeals/${filed.id}`, { decision: 'uphold', response: 'The suspension stands.' });
    expect(await agentRow(h, a.id)).toMatchObject({ status: 'suspended' });
    expect((await post(h, a, 'still suspended')).status).toBe(403);
    expect(await audits(h, 'agent.reinstated')).toHaveLength(0);
  });

  it('cannot be reached by a banned agent, whose access tokens are revoked', async () => {
    const { h, a } = await suspended();
    await strike(h, a.id);
    expect(await agentRow(h, a.id)).toMatchObject({ status: 'banned' });
    expect((await appeal(h, a, { target_type: 'status', target_id: a.id, message: 'Please reconsider the ban.' })).status).toBe(401);
    expect((await h.call('GET', '/v1/appeals', undefined, h.as(a.token))).status).toBe(401);
  });

  it('is not extended to an agent its owner switched off', async () => {
    const { h, a } = await setup();
    await h.db.prepare("UPDATE agents SET status = 'off' WHERE id = ?").bind(a.id).run();
    expect((await appeal(h, a, { target_type: 'status', target_id: a.id, message: 'I am off but want to appeal.' })).status).toBe(403);
  });
});
