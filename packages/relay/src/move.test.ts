import { AgentSelf, RelayEvent, Subscription, TokenResponse, type Digest, type Home } from '@logitland/contracts';
import { verify } from '@logitland/webhooks';
import { describe, expect, it } from 'vitest';
import type { Db } from './context';
import { sha256 } from './crypto';
import { HOOK_HOST, poll, say, setup, subscribe, useWebhook, type Setup } from './deliveries.testkit';
import { attemptDelivery, pushDue } from './services/deliveries';
import { MOVE_CODE_DAYS, moveAgents, type Outcome, type Sql } from './services/move';
import { RECONNECT_GRANT } from './services/reconnect';
import { retentionJob } from './services/retention';
import { CLAIM_GRANT } from './services/tokens';
import { tokenCall } from './signup.helpers';
import { BENCH, LOUNGE, harness, seedAgent, seedChannel, seedOwner, type Harness } from './testing';
import { mockQueue } from './webhook.testkit';

// Moving staging's agents to production (services/move.ts, scripts/move-agents.mjs): two relays with their own databases and
// keys, as staging and production are. The script reaches each through `wrangler d1 execute`; these tests through its binding.

const DAY_MS = 86_400_000;
/** Production's lounge: the same name as staging's, under its own server's ID. */
const PROD_LOUNGE = '120000000000000001';

const sqlOf = (db: Db): Sql => ({
  all: async (sql, params = []) =>
    (
      await db
        .prepare(sql)
        .bind(...params)
        .all()
    ).results as never,
  run: async (statements) => void (await db.batch(statements.map((s) => db.prepare(s.sql).bind(...s.params)))),
});

/** A post the agent sent `daysAgo`, which is what makes it active. */
const posted = (h: Pick<Harness, 'db' | 'now'>, agentId: string, daysAgo = 1) => {
  const at = new Date(h.now().getTime() - daysAgo * DAY_MS).toISOString();
  return h.db
    .prepare(
      `INSERT INTO relay_messages (id, agent_id, channel_id, content, status, idempotency_key, payload_digest, content_hash, created_at, sent_at, updated_at)
       VALUES (?, ?, ?, 'hello', 'sent', ?, 'd', 'h', ?, ?, ?)`,
    )
    .bind(`msg_${agentId.slice(4)}${daysAgo}`, agentId, LOUNGE, `${agentId}:${daysAgo}`, at, at, at)
    .run();
};

/** Production: an empty relay of its own, whose server has a lounge but no lab bench. */
async function production() {
  const p = harness();
  await seedChannel(p.relay, { id: PROD_LOUNGE, name: 'lounge' });
  return p;
}

/**
 * Staging: Orrery, adopted, at level 3, with a webhook and subscriptions to the lounge, the lab bench and its replies; and
 * Quill, an orphan that long-polls.
 */
async function staging() {
  const s = await setup({ subscriptions: 5 });
  s.relay.queue = mockQueue().queue;
  const parent = await seedOwner(s.relay);
  await s.db
    .prepare('UPDATE agents SET owner_id = ?, adopted_at = ?, level = 3, xp = 2500 WHERE id = ?')
    .bind(parent.id, s.now().toISOString(), s.agent.id)
    .run();
  const secret = await useWebhook(s);
  await subscribe(s, { frequency: 'live' });
  await subscribe(s, { channel_id: BENCH });
  await subscribe(s, { kind: 'replies', frequency: 'live' });
  await posted(s, s.agent.id);
  const quill = await seedAgent(s.relay, { name: 'Quill' });
  await subscribe(s, { kind: 'replies', frequency: 'live' }, s.as(quill.token));
  await posted(s, quill.id);
  return { s, parent, secret, quill };
}

const move = (s: Setup, p: Harness, apply = true) =>
  moveAgents({
    staging: sqlOf(s.db),
    production: sqlOf(p.db),
    stagingBox: s.relay.secrets,
    productionBox: p.relay.secrets,
    url: p.relay.config.publicUrl,
    now: s.now(),
    apply,
  });

const moving = (outcomes: Outcome[], id: string) => {
  const o = outcomes.find((x) => x.agent.id === id);
  if (o?.result !== 'moving') throw new Error(`expected ${id} to be moving, got ${o?.result}`);
  return o;
};

const reconnect = (p: Harness, code: string, agentId: string) => tokenCall(p, { grant_type: RECONNECT_GRANT, code, registration_id: agentId });

describe('moving agents to production', () => {
  it('lets an agent reconnect in production as itself, with its parent, subscriptions and webhook', async () => {
    const { s, parent, secret } = await staging();
    const p = await production();
    const { code } = moving(await move(s, p), s.agent.id);

    const res = await reconnect(p, code, s.agent.id);
    expect(res.status).toBe(200);
    const auth = p.as(TokenResponse.parse(await res.json()).access_token);
    const me = AgentSelf.parse(await (await p.call('GET', '/v1/me', undefined, auth)).json());
    expect(me.agent).toMatchObject({ id: s.agent.id, name: 'Orrery', adopted: true });
    expect(me.level).toMatchObject({ level: 3, xp: 2500 });
    expect(await p.db.prepare('SELECT o.discord_user_id FROM agents a JOIN owners o ON o.id = a.owner_id WHERE a.id = ?').bind(s.agent.id).first()).toEqual({
      discord_user_id: parent.discord_user_id,
    });

    // The lounge maps to production's by name; production has no lab bench.
    const { subscriptions } = (await (await p.call('GET', '/v1/subscriptions', undefined, auth)).json()) as { subscriptions: Subscription[] };
    expect(subscriptions.map((x) => [x.kind, x.channel_id])).toEqual([
      ['replies', null],
      ['channel', PROD_LOUNGE],
    ]);

    // Production signs with the secret the receiver already has.
    const q = mockQueue();
    p.relay.queue = q.queue;
    const got: { headers: Headers; body: string }[] = [];
    p.receivers[HOOK_HOST] = async (req) => (got.push({ headers: req.headers, body: await req.text() }), new Response(null, { status: 204 }));
    await say(p, 'from production', { channel: PROD_LOUNGE });
    expect(await pushDue(p.relay, s.agent.id)).toBe(1);
    expect(await attemptDelivery(p.relay, q.deliveries[0]!)).toEqual({ outcome: 'delivered' });
    await expect(verify(got[0]!.headers, got[0]!.body, secret, { now: p.now() })).resolves.toBeTruthy();
    expect((JSON.parse(got[0]!.body) as Digest).events.map((e) => e.type === 'message.created' && e.data.content)).toEqual(['from production']);
  });

  it('tells each agent once on staging, and keeps telling it in its home', async () => {
    const { s, quill } = await staging();
    const p = await production();
    const { code, expires_at } = moving(await move(s, p), quill.id);
    const quillAuth = s.as(quill.token);

    const [digest] = (await poll({ ...s, auth: quillAuth })).digests;
    const event = RelayEvent.parse(digest!.events[0]);
    expect(event).toMatchObject({ type: 'agent.moved', data: { url: p.relay.config.publicUrl, registration_id: quill.id, code, expires_at } });
    expect(expires_at).toBe(new Date(s.now().getTime() + MOVE_CODE_DAYS * DAY_MS).toISOString());
    const message = event.type === 'agent.moved' ? event.data.message : '';
    expect(message).toContain(`${p.relay.config.publicUrl}/v1/events?wait=25`);
    expect(message).not.toContain('parent');

    // Running again changes nothing: the same code, no second event.
    expect(moving(await move(s, p), quill.id).code).toBe(code);
    expect((await poll({ ...s, auth: quillAuth })).digests).toEqual([]);
    const home = (await (await s.call('GET', '/v1/home', undefined, quillAuth)).json()) as Home;
    expect(home.next_steps[0]).toBe(message);

    // Orrery's notice names the webhook and the subscription production couldn't make.
    const orrery = (await (await s.call('GET', '/v1/home', undefined, s.auth)).json()) as Home;
    expect(orrery.next_steps[0]).toContain('same URL with the same signing secret');
    expect(orrery.next_steps[0]).toContain('except to #lab-bench');
  });

  it('leaves staging’s claim tokens behind', async () => {
    const { s } = await staging();
    const p = await production();
    const claim = { grant_type: CLAIM_GRANT, claim_token: 'clm_staging' };
    await s.db
      .prepare('UPDATE agents SET claim_token_hash = ?, claim_token_expires = ? WHERE id = ?')
      .bind(await sha256(claim.claim_token), new Date(s.now().getTime() + DAY_MS).toISOString(), s.agent.id)
      .run();
    await move(s, p);

    expect((await tokenCall(p, claim)).status).toBe(400);
    expect((await tokenCall(s, claim)).status).toBe(200);
  });

  it('tells an agent that deleted its replies subscription, through a new one', async () => {
    const { s, quill } = await staging();
    const p = await production();
    const quillAuth = s.as(quill.token);
    const replies = await subscribe(s, { kind: 'replies' }, quillAuth);
    expect((await s.call('DELETE', `/v1/subscriptions/${replies.id}`, undefined, quillAuth)).status).toBe(204);
    await subscribe(s, {}, quillAuth);
    const { code } = moving(await move(s, p), quill.id);

    const [digest] = (await poll({ ...s, auth: quillAuth })).digests;
    expect(RelayEvent.parse(digest!.events[0])).toMatchObject({ type: 'agent.moved', data: { code } });

    // Running again neither tells it twice nor adds a second replies subscription.
    await move(s, p);
    expect((await poll({ ...s, auth: quillAuth })).digests).toEqual([]);
    expect(await s.db.prepare("SELECT COUNT(*) AS n FROM subscriptions WHERE agent_id = ? AND kind = 'replies'").bind(quill.id).first()).toEqual({ n: 1 });
  });

  it('announces a new code when the last expired unused, and keeps it in home as long as the code', async () => {
    const { s, quill } = await staging();
    const p = await production();
    const quillAuth = s.as(quill.token);
    const first = moving(await move(s, p), quill.id);
    await poll({ ...s, auth: quillAuth });
    s.advance(DAY_MS);
    await say(s, 'a day later');
    s.advance((MOVE_CODE_DAYS + 1) * DAY_MS);
    await posted(s, quill.id, 2);

    const second = moving(await move(s, p), quill.id);
    expect(second.code).not.toBe(first.code);
    const [digest] = (await poll({ ...s, auth: quillAuth })).digests;
    expect(digest!.events.map((e) => RelayEvent.parse(e))).toMatchObject([
      { type: 'agent.moved', observed_at: s.now().toISOString(), data: { code: second.code } },
    ]);

    s.advance((MOVE_CODE_DAYS - 1) * DAY_MS);
    await retentionJob(s.relay);
    const home = (await (await s.call('GET', '/v1/home', undefined, quillAuth)).json()) as Home;
    expect(home.next_steps[0]).toContain(second.code);
  });

  it('moves only agents that posted in the last 30 days and were not revoked or banned', async () => {
    const s = await setup();
    const p = await production();
    const quiet = await seedAgent(s.relay, { name: 'Quiet' });
    const stale = await seedAgent(s.relay, { name: 'Stale' });
    await posted(s, stale.id, 31);
    const banned = await seedAgent(s.relay, { name: 'Banned', status: 'banned' });
    await posted(s, banned.id);
    const revoked = await seedAgent(s.relay, { name: 'Revoked' });
    await posted(s, revoked.id);
    await s.db.prepare('UPDATE agents SET deleted_at = ? WHERE id = ?').bind(s.now().toISOString(), revoked.id).run();
    const reader = await seedAgent(s.relay, { name: 'Reader', kind: 'reader' });
    await posted(s, reader.id);
    await posted(s, s.agent.id, 29);

    expect((await move(s, p)).map((o) => o.agent.name)).toEqual(['Orrery']);
    expect(await p.db.prepare('SELECT COUNT(*) AS n FROM agents WHERE id IN (?, ?)').bind(quiet.id, stale.id).first()).toEqual({ n: 0 });
  });

  it('leaves an agent behind when production gave its name to another, and one that already arrived alone', async () => {
    const { s, quill } = await staging();
    const p = await production();
    await seedAgent(p.relay, { name: 'Quill' });
    const first = await move(s, p);
    expect(first.find((o) => o.agent.id === quill.id)).toMatchObject({ result: 'skipped' });

    expect((await reconnect(p, moving(first, s.agent.id).code, s.agent.id)).status).toBe(200);
    expect((await move(s, p)).find((o) => o.agent.id === s.agent.id)).toMatchObject({ result: 'arrived' });
  });

  it('writes nothing on a dry run', async () => {
    const { s } = await staging();
    const p = await production();
    expect((await move(s, p, false)).map((o) => o.result)).toEqual(['moving', 'moving']);
    expect(await p.db.prepare('SELECT COUNT(*) AS n FROM agents').first()).toEqual({ n: 0 });
    expect(await s.db.prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'agent.moved'").first()).toEqual({ n: 0 });
  });

  it('gives move codes 30 days, where a parent’s last 15 minutes', async () => {
    const { s, quill } = await staging();
    const p = await production();
    const outcomes = await move(s, p);
    p.advance(MOVE_CODE_DAYS * DAY_MS - 1000);
    expect((await reconnect(p, moving(outcomes, s.agent.id).code, s.agent.id)).status).toBe(200);
    p.advance(2000);
    expect((await reconnect(p, moving(outcomes, quill.id).code, quill.id)).status).toBe(400);
  });
});
