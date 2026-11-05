import { describe, expect, it } from 'vitest';
import { BOT, contents, poll, say, setup, subscribe, useWebhook, type Setup } from './deliveries.testkit';
import { fakeDiscord } from './posting-fixtures';
import { attemptDelivery, drainDue, pushDue } from './services/deliveries';
import { ingest } from './services/intake';
import { retentionJob } from './services/retention';
import { unsubscribe } from './services/subscriptions';
import { GUILD, LOUNGE, seedChannel } from './testing';

// Subscriptions and their digests (#11, #23, #30 Q4): one cursor per subscription, the same digests whichever transport reads them.

const post = async (s: Setup, content: string, key: string) => {
  const res = await s.call('POST', '/v1/messages', { channel_id: LOUNGE, content }, { ...s.auth, 'idempotency-key': key });
  return (await res.json()) as { id: string; discord_message_id: string };
};

describe('a channel subscription', () => {
  it('gets the channel’s events from when it subscribed, once', async () => {
    const s = await setup();
    await say(s, 'before');
    await subscribe(s);
    await say(s, 'one');
    await say(s, 'two');
    const { digests } = await poll(s);
    expect(digests.map(contents)).toEqual([['one', 'two']]);
    expect(digests[0]).toMatchObject({ type: 'digest', more: false });
    expect((await poll(s)).digests).toEqual([]);
  });

  it('leaves the agent’s own posts out unless it asks for them', async () => {
    const s = await setup();
    fakeDiscord(s);
    const quiet = await subscribe(s);
    await post(s, 'my own words', 'own-post-00001');
    expect((await poll(s)).digests).toEqual([]);
    await s.call('PATCH', `/v1/subscriptions/${quiet.id}`, { include_own: true }, s.auth);
    await post(s, 'more of my words', 'own-post-00002');
    expect((await poll(s)).digests.map(contents)).toEqual([['more of my words']]);
  });

  it('gives at most 100 events at a time, and lets the rest be read again without moving on', async () => {
    const s = await setup();
    const sub = await subscribe(s);
    const events = Array.from({ length: 105 }, (_, i) => ({
      kind: 'message_create',
      channel_id: LOUNGE,
      message_id: String(320000000000000000n + BigInt(i)),
      author: { id: BOT, username: 'newsbot', bot: true },
      content: `m${i}`,
      timestamp: s.now().toISOString(),
    }));
    await ingest(s.relay, { source: 'test', events });
    const [first] = (await poll(s)).digests;
    expect(first).toMatchObject({ more: true });
    expect(first!.events).toHaveLength(100);
    const rest = await (await s.call('GET', `/v1/subscriptions/${sub.id}/events?after=${first!.cursor}`, undefined, s.auth)).json();
    expect(rest.events).toHaveLength(5);
    // Reading again doesn't move the subscription: the next digest still holds the last five.
    expect((await poll(s)).digests[0]!.events).toHaveLength(5);
  });

  it('ends with channel.deleted when its channel is deleted', async () => {
    const s = await setup();
    await subscribe(s);
    await ingest(s.relay, { source: 'gateway', events: [{ kind: 'channel_delete', channel_id: LOUNGE }] });
    expect((await poll(s)).digests.map(contents)).toEqual([['channel.deleted']]);
    await poll(s);
    const { subscriptions } = await (await s.call('GET', '/v1/subscriptions', undefined, s.auth)).json();
    expect(subscriptions).toEqual([]);
  });

  it('carries new threads and reactions, never saying who reacted', async () => {
    const s = await setup();
    await subscribe(s);
    const id = await say(s, 'react to this');
    await ingest(s.relay, {
      source: 'gateway',
      events: [
        { kind: 'thread_upsert', thread_id: id, parent_id: LOUNGE, name: 'a thread', owner_id: BOT },
        { kind: 'reaction', added: true, channel_id: LOUNGE, message_id: id, user_id: '200000000000000077', bot: false, emoji: { id: null, name: '🎉' } },
      ],
    });
    const events = (await poll(s)).digests.flatMap((d) => d.events);
    expect(events.map((e) => e.type)).toEqual(['message.created', 'thread.created', 'reaction.added']);
    expect(events[2]).toMatchObject({ data: { message_id: id, emoji: { name: '🎉' }, by: 'human' } });
    expect(JSON.stringify(events[2])).not.toContain('200000000000000077');
  });
});

describe('the replies subscription', () => {
  it('brings replies to the agent’s messages, and what became of them', async () => {
    const s = await setup();
    fakeDiscord(s);
    await subscribe(s, { kind: 'replies' });
    const mine = await post(s, 'a question', 'question-00001');
    await say(s, 'an answer', { replyTo: mine.discord_message_id });
    await say(s, 'unrelated chatter');
    const [replies] = (await poll(s)).digests;
    expect(replies!.events.map((e) => e.type)).toEqual(['message.created']);
    expect(contents(replies!)[0]).toBe('an answer');
  });
});

describe('webhook delivery', () => {
  it('posts each digest, signed, and no more often than the subscription’s frequency', async () => {
    const s = await setup();
    await useWebhook(s);
    await subscribe(s, { frequency: '60s' });
    await say(s, 'first');
    expect(s.received.map(contents)).toEqual([['first']]);
    await say(s, 'second');
    await say(s, 'third');
    expect(s.received).toHaveLength(1);
    s.advance(60_000);
    await drainDue(s.relay);
    expect(s.received.map(contents)).toEqual([['first'], ['second', 'third']]);
    expect(s.signatures.every((sig) => sig.startsWith('v1,'))).toBe(true);
    expect(s.signatures).toHaveLength(2);
  });

  it('stops once the agent loses messages:read', async () => {
    const s = await setup();
    await useWebhook(s);
    await subscribe(s);
    await s.db.prepare(`UPDATE agents SET scopes = '["subscriptions:manage"]' WHERE id = ?`).bind(s.agent.id).run();
    await say(s, 'not for you');
    await drainDue(s.relay);
    expect(s.received).toEqual([]);
  });

  it('drops to one digest after midnight UTC once the owner’s daily cap is reached, and says so', async () => {
    const s = await setup();
    await s.db.prepare('UPDATE agents SET daily_event_cap = 2 WHERE id = ?').bind(s.agent.id).run();
    await subscribe(s);
    for (const text of ['a', 'b', 'c']) await say(s, text);
    expect((await poll(s)).digests.map(contents)).toEqual([['a', 'b', 'c']]);
    await say(s, 'd');
    const capped = await poll(s);
    expect(capped.digests).toEqual([]);
    expect(capped.hints?.map((h) => h.code)).toEqual(['capped']);
    s.advance(86_400_000);
    expect((await poll(s)).digests.map(contents)).toEqual([['d']]);
  });
});

describe('hints', () => {
  it('suggest digests to an agent following many channels live, once an hour', async () => {
    const s = await setup({ subscriptions: 10 });
    for (let i = 0; i < 5; i++) {
      const id = String(110000000000000010n + BigInt(i));
      await seedChannel(s.relay, { id, name: `busy-${i}`, access: 'post' });
      await subscribe(s, { channel_id: id, frequency: 'live' });
    }
    const list = async () => (await (await s.call('GET', '/v1/subscriptions', undefined, s.auth)).json()) as { hints?: { code: string }[] };
    expect((await list()).hints?.map((h) => h.code)).toEqual(['many_live_subscriptions']);
    expect((await list()).hints).toBeUndefined();
    s.advance(3_600_000);
    expect((await list()).hints?.map((h) => h.code)).toEqual(['many_live_subscriptions']);
  });
});

describe('replies to the agent', () => {
  const digestsFor = async (s: Setup, id: string) =>
    (await poll(s)).digests.find(
      (d) => (d as { subscription?: string; subscription_id?: string }).subscription === id || (d as { subscription_id?: string }).subscription_id === id,
    );

  it('arrive on the replies subscription only when the agent has one', async () => {
    const s = await setup();
    fakeDiscord(s);
    const channel = await subscribe(s);
    const replies = await subscribe(s, { kind: 'replies' });
    const mine = await post(s, 'a question', 'reply-route-001');
    await say(s, 'an answer', { replyTo: mine.discord_message_id });
    // The reply alone never makes the channel subscription due; the replies one is due.
    expect((await s.db.prepare('SELECT next_due_ms FROM subscriptions WHERE id = ?').bind(channel.id).first())?.next_due_ms ?? null).toBeNull();
    expect((await s.db.prepare('SELECT next_due_ms FROM subscriptions WHERE id = ?').bind(replies.id).first())?.next_due_ms).not.toBeNull();
    await say(s, 'ordinary chatter');
    const digests = (await poll(s)).digests;
    const onReplies = digests.find((d) => d.subscription_id === replies.id);
    const onChannel = digests.find((d) => d.subscription_id === channel.id);
    expect(contents(onReplies!)).toContain('an answer');
    expect(contents(onChannel!)).toEqual(['ordinary chatter']);
  });

  it('a reply recorded before the replies subscription exists still reaches the channel subscription', async () => {
    const s = await setup();
    fakeDiscord(s);
    const channel = await subscribe(s);
    const mine = await post(s, 'a question', 'reply-route-003');
    await say(s, 'an answer', { replyTo: mine.discord_message_id });
    const replies = await subscribe(s, { kind: 'replies' });
    const digests = (await poll(s)).digests;
    const onChannel = digests.find((d) => d.subscription_id === channel.id);
    const onReplies = digests.find((d) => d.subscription_id === replies.id);
    expect(contents(onChannel!)).toEqual(['an answer']);
    expect(onReplies).toBeUndefined();
  });

  it('the agent’s own reply to itself still reaches an include_own channel subscription', async () => {
    const s = await setup();
    fakeDiscord(s);
    const channel = await subscribe(s, { include_own: true });
    await subscribe(s, { kind: 'replies' });
    const mine = await post(s, 'a question', 'reply-route-004');
    const res = await s.call(
      'POST',
      '/v1/messages',
      { channel_id: LOUNGE, content: 'me again', reply_to: mine.discord_message_id },
      { ...s.auth, 'idempotency-key': 'reply-route-005' },
    );
    expect(res.status).toBe(201);
    expect((await s.db.prepare('SELECT next_due_ms FROM subscriptions WHERE id = ?').bind(channel.id).first())?.next_due_ms).not.toBeNull();
    const digests = (await poll(s)).digests;
    const onChannel = digests.find((d) => d.subscription_id === channel.id);
    expect(contents(onChannel!)).toContain('me again');
  });

  it('arrive on the channel subscription when there is no replies subscription', async () => {
    const s = await setup();
    fakeDiscord(s);
    const channel = await subscribe(s);
    const replies = await subscribe(s, { kind: 'replies' });
    await s.call('DELETE', `/v1/subscriptions/${replies.id}`, undefined, s.auth);
    const mine = await post(s, 'a question', 'reply-route-002');
    await say(s, 'an answer', { replyTo: mine.discord_message_id });
    const onChannel = await digestsFor(s, channel.id);
    expect(contents(onChannel!)).toContain('an answer');
  });

  it('pushes an unread reply through the channel after the replies subscription is deleted', async () => {
    const s = await setup();
    fakeDiscord(s);
    const channel = await subscribe(s);
    const replies = await subscribe(s, { kind: 'replies' });
    const mine = await post(s, 'a question', 'reply-fallback-001');
    await say(s, 'an answer', { replyTo: mine.discord_message_id });
    expect((await s.db.prepare('SELECT next_due_ms FROM subscriptions WHERE id = ?').bind(channel.id).first())?.next_due_ms).toBeNull();

    expect((await s.call('DELETE', `/v1/subscriptions/${replies.id}`, undefined, s.auth)).status).toBe(204);
    const replay = await (await s.call('GET', `/v1/subscriptions/${channel.id}/events`, undefined, s.auth)).json();
    expect(replay.events).toMatchObject([{ type: 'message.created', data: { content: 'an answer' } }]);
    await useWebhook(s);
    await drainDue(s.relay);
    expect(s.received.map(contents)).toEqual([['an answer']]);
    expect(s.received[0]!.subscription_id).toBe(channel.id);
    await drainDue(s.relay);
    expect(s.received).toHaveLength(1);
  });

  it('keeps the channel frequency when an unread reply falls back', async () => {
    const s = await setup();
    fakeDiscord(s);
    const channel = await subscribe(s, { frequency: '60s' });
    const replies = await subscribe(s, { kind: 'replies' });
    await say(s, 'first');
    expect((await poll(s)).digests.map(contents)).toEqual([['first']]);

    const mine = await post(s, 'a question', 'reply-fallback-002');
    await say(s, 'an answer', { replyTo: mine.discord_message_id });
    expect((await s.call('DELETE', `/v1/subscriptions/${replies.id}`, undefined, s.auth)).status).toBe(204);
    expect((await s.db.prepare('SELECT next_due_ms FROM subscriptions WHERE id = ?').bind(channel.id).first())?.next_due_ms).toBe(s.now().getTime() + 60_000);
    await useWebhook(s);
    await drainDue(s.relay);
    expect(s.received).toHaveLength(0);
    s.advance(60_000);
    await drainDue(s.relay);
    expect(s.received.map(contents)).toEqual([['an answer']]);
  });

  it('does not rearm a channel for a reply already delivered on replies', async () => {
    const s = await setup();
    fakeDiscord(s);
    const channel = await subscribe(s);
    const replies = await subscribe(s, { kind: 'replies' });
    await useWebhook(s);
    const mine = await post(s, 'a question', 'reply-fallback-003');
    await say(s, 'an answer', { replyTo: mine.discord_message_id });
    expect(s.received.map(contents)).toEqual([['an answer']]);
    expect(s.received[0]!.subscription_id).toBe(replies.id);

    expect((await s.call('DELETE', `/v1/subscriptions/${replies.id}`, undefined, s.auth)).status).toBe(204);
    expect((await s.db.prepare('SELECT next_due_ms FROM subscriptions WHERE id = ?').bind(channel.id).first())?.next_due_ms).toBeNull();
  });
});

describe('reply handoffs', () => {
  const receivedFor = (s: Setup, id: string) => s.received.filter((d) => d.subscription_id === id);

  it('replies a deleted replies subscription already delivered stay delivered', async () => {
    const s = await setup();
    fakeDiscord(s);
    await useWebhook(s);
    const channel = await subscribe(s, { frequency: '24h' });
    const replies = await subscribe(s, { kind: 'replies' });
    // One ordinary delivery, so the channel's next due is scheduled rather than open.
    await say(s, 'first');
    expect(receivedFor(s, channel.id).map((d) => contents(d))).toEqual([['first']]);
    const mine = await post(s, 'a question', 'handoff-001');
    // More than one digest's worth of replies, all delivered on the replies subscription.
    for (let i = 0; i < 105; i++) await say(s, `answer ${i}`, { replyTo: mine.discord_message_id });
    await drainDue(s.relay);
    expect(receivedFor(s, replies.id).flatMap((d) => contents(d))).toHaveLength(105);
    await s.call('PATCH', `/v1/subscriptions/${replies.id}`, { frequency: '60s' }, s.auth);
    await say(s, 'unread answer', { replyTo: mine.discord_message_id });
    await say(s, 'unrelated chatter');
    expect((await s.call('DELETE', `/v1/subscriptions/${replies.id}`, undefined, s.auth)).status).toBe(204);
    s.advance(86_400_000);
    await drainDue(s.relay);
    const channelDigests = receivedFor(s, channel.id);
    expect(channelDigests.every((d) => !d.more)).toBe(true);
    expect(channelDigests.flatMap((d) => contents(d))).toEqual(['first', 'unread answer', 'unrelated chatter']);
  });

  it('a reply delivered while unsubscribe is in flight is not rearmed on the channel', async () => {
    const s = await setup();
    fakeDiscord(s);
    await useWebhook(s);
    const channel = await subscribe(s, { frequency: '24h' });
    const replies = await subscribe(s, { kind: 'replies' });
    const mine = await post(s, 'a question', 'handoff-002');
    await say(s, 'earlier answer', { replyTo: mine.discord_message_id });
    await drainDue(s.relay);
    await s.call('PATCH', `/v1/subscriptions/${replies.id}`, { frequency: '60s' }, s.auth);
    await say(s, 'one answer', { replyTo: mine.discord_message_id });
    // The reply sits unread on the replies subscription until its frequency comes up.
    s.advance(60_000);
    // Deliver the pending reply between the subscription read and the delete batch.
    const orig = s.relay.db.batch.bind(s.relay.db);
    let once = true;
    s.relay.db.batch = (async (stmts: { sql?: string }[]) => {
      if (once && stmts.some((st) => st.sql?.includes('DELETE FROM subscriptions'))) {
        once = false;
        await pushDue(s.relay, s.agent.id);
      }
      return orig(stmts as never[]);
    }) as typeof s.relay.db.batch;
    await unsubscribe(s.relay, s.agent.id, replies.id);
    s.relay.db.batch = orig;
    expect(receivedFor(s, replies.id).flatMap((d) => contents(d))).toEqual(['earlier answer', 'one answer']);
    s.advance(90_000);
    await drainDue(s.relay);
    expect(receivedFor(s, channel.id)).toEqual([]);
  });

  it('two replies cycles never hand consumed replies to the channel', async () => {
    const s = await setup();
    fakeDiscord(s);
    await useWebhook(s);
    const channel = await subscribe(s, { frequency: '24h' });
    const mine = await post(s, 'a question', 'handoff-003');
    for (let cycle = 0; cycle < 2; cycle++) {
      const replies = await subscribe(s, { kind: 'replies' });
      await say(s, `cycle ${cycle} answer`, { replyTo: mine.discord_message_id });
      await drainDue(s.relay);
      expect(receivedFor(s, replies.id).flatMap((d) => contents(d))).toEqual([`cycle ${cycle} answer`]);
      await s.call('DELETE', `/v1/subscriptions/${replies.id}`, undefined, s.auth);
    }
    await say(s, 'the newest answer', { replyTo: mine.discord_message_id });
    await drainDue(s.relay);
    const onChannel = receivedFor(s, channel.id).at(-1);
    expect(contents(onChannel!)).toEqual(['the newest answer']);
  });

  it('a reply a pending delivery never sent reaches the channel after the delete', async () => {
    const s = await setup({ harness: { env: { DELIVERIES: { send: async () => {} } } } });
    fakeDiscord(s);
    await useWebhook(s);
    const channel = await subscribe(s, { frequency: '24h' });
    const replies = await subscribe(s, { kind: 'replies' });
    const mine = await post(s, 'a question', 'pending-001');
    await say(s, 'queued answer', { replyTo: mine.discord_message_id });
    await pushDue(s.relay, s.agent.id);
    const delivery = await s.db.prepare('SELECT id, status FROM deliveries WHERE subscription_id = ?').bind(replies.id).first<{ id: string; status: string }>();
    expect(delivery?.status).toBe('pending');
    expect((await s.call('DELETE', `/v1/subscriptions/${replies.id}`, undefined, s.auth)).status).toBe(204);
    expect((await attemptDelivery(s.relay, delivery!.id)).outcome).toBe('dropped');
    await say(s, 'ordinary chatter');
    const channelDigests = (await poll(s)).digests.filter((d) => d.subscription_id === channel.id);
    expect(channelDigests.flatMap((d) => contents(d))).toEqual(['queued answer', 'ordinary chatter']);
  });

  it('a handoff covers only what was delivered, not a later pending reply', async () => {
    const s = await setup({ harness: { env: { DELIVERIES: { send: async () => {} } } } });
    fakeDiscord(s);
    await useWebhook(s);
    const channel = await subscribe(s, { frequency: '24h' });
    const replies = await subscribe(s, { kind: 'replies' });
    const mine = await post(s, 'a question', 'pending-002');
    await say(s, 'delivered answer', { replyTo: mine.discord_message_id });
    // Deliver it for real, then queue a second reply that never sends.
    await pushDue(s.relay, s.agent.id);
    const first = await s.db.prepare('SELECT id FROM deliveries WHERE subscription_id = ?').bind(replies.id).first<{ id: string }>();
    await attemptDelivery(s.relay, first!.id);
    expect(receivedFor(s, replies.id).flatMap((d) => contents(d))).toEqual(['delivered answer']);
    await say(s, 'pending answer', { replyTo: mine.discord_message_id });
    await pushDue(s.relay, s.agent.id);
    expect((await s.db.prepare("SELECT COUNT(*) n FROM deliveries WHERE subscription_id = ? AND status = 'pending'").bind(replies.id).first<{ n: number }>())!.n).toBe(1);
    expect((await s.call('DELETE', `/v1/subscriptions/${replies.id}`, undefined, s.auth)).status).toBe(204);
    await say(s, 'ordinary chatter');
    const channelDigests = (await poll(s)).digests.filter((d) => d.subscription_id === channel.id);
    expect(channelDigests.flatMap((d) => contents(d))).toEqual(['pending answer', 'ordinary chatter']);
  });

  it('a reply in a retrying delivery also falls back to the channel', async () => {
    const s = await setup({ harness: { env: { DELIVERIES: { send: async () => {} } } } });
    fakeDiscord(s);
    await useWebhook(s);
    const channel = await subscribe(s, { frequency: '24h' });
    const replies = await subscribe(s, { kind: 'replies' });
    const mine = await post(s, 'a question', 'pending-003');
    await say(s, 'retrying answer', { replyTo: mine.discord_message_id });
    await pushDue(s.relay, s.agent.id);
    const delivery = await s.db.prepare('SELECT id FROM deliveries WHERE subscription_id = ?').bind(replies.id).first<{ id: string }>();
    // One failed attempt leaves it retrying rather than pending.
    await s.db.prepare("UPDATE deliveries SET status = 'retrying' WHERE id = ?").bind(delivery!.id).run();
    expect((await s.call('DELETE', `/v1/subscriptions/${replies.id}`, undefined, s.auth)).status).toBe(204);
    await say(s, 'ordinary chatter');
    const channelDigests = (await poll(s)).digests.filter((d) => d.subscription_id === channel.id);
    expect(channelDigests.flatMap((d) => contents(d))).toEqual(['retrying answer', 'ordinary chatter']);
  });

  it('retention keeps a handoff while a channel cursor still needs it', async () => {
    const s = await setup();
    fakeDiscord(s);
    await useWebhook(s);
    await subscribe(s, { frequency: '24h' });
    const replies = await subscribe(s, { kind: 'replies' });
    const mine = await post(s, 'a question', 'handoff-004');
    await say(s, 'one answer', { replyTo: mine.discord_message_id });
    await drainDue(s.relay);
    await s.call('DELETE', `/v1/subscriptions/${replies.id}`, undefined, s.auth);
    const handoffs = () => s.db.prepare('SELECT COUNT(*) AS n FROM reply_handoffs WHERE agent_id = ?').bind(s.agent.id).first<{ n: number }>();
    expect((await handoffs())!.n).toBe(1);
    await retentionJob(s.relay);
    // The channel cursor is still behind the handoff's end: it is kept.
    expect((await handoffs())!.n).toBe(1);
    await say(s, 'after the delete', { replyTo: mine.discord_message_id });
    await drainDue(s.relay);
    await retentionJob(s.relay);
    expect((await handoffs())!.n).toBe(0);
  });
});

describe('message.status', () => {
  const statuses = (s: Setup, id: string) =>
    s.db
      .prepare("SELECT json_extract(payload, '$.data.status') AS status FROM events WHERE type = 'message.status' AND json_extract(payload, '$.data.id') = ?")
      .bind(id)
      .all<{ status: string }>()
      .then((r) => r.results.map((e) => e.status));

  it('does not receipt the status the POST answer already gave, then emits the next change', async () => {
    const s = await setup();
    fakeDiscord(s);
    const mine = await post(s, 'mine alone', 'status-only-0001');
    expect(await statuses(s, mine.id)).toEqual([]);
    // A change after the request answered still receipts, addressed to the author alone.
    await s.db.prepare("UPDATE relay_messages SET status = 'removed', updated_at = ? WHERE id = ?").bind(s.relay.now().toISOString(), mine.id).run();
    expect(await statuses(s, mine.id)).toEqual(['removed']);
    const { results } = await s.db.prepare("SELECT agent_id, guild_id FROM events WHERE type = 'message.status'").all<{ agent_id: string; guild_id: string }>();
    expect(results).toEqual([{ agent_id: s.agent.id, guild_id: GUILD }]);
  });

  it('receipts a send that finished in the background, and a dead request stops hiding them', async () => {
    const s = await setup();
    fakeDiscord(s);
    // As the request died mid-way: its window is already past, so the next status change emits.
    const mine = await post(s, 'died waiting', 'status-dead-0001');
    await s.db.prepare("UPDATE relay_messages SET answering_until = '2000-01-01T00:00:00.000Z' WHERE id = ?").bind(mine.id).run();
    await s.db.prepare("UPDATE relay_messages SET status = 'removed', updated_at = ? WHERE id = ?").bind(s.relay.now().toISOString(), mine.id).run();
    expect(await statuses(s, mine.id)).toEqual(['removed']);
  });
});
