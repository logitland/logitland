import { describe, expect, it } from 'vitest';
import { BOT, contents, poll, say, setup, subscribe, useWebhook, type Setup } from './deliveries.testkit';
import { fakeDiscord } from './posting-fixtures';
import { drainDue } from './services/deliveries';
import { ingest } from './services/intake';
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
    expect(replies!.events.map((e) => e.type)).toEqual(['message.status', 'message.created']);
    expect(replies!.events[0]).toMatchObject({ data: { id: mine.id, status: 'sent' } });
    expect(contents(replies!)[1]).toBe('an answer');
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

describe('message.status', () => {
  it('is addressed to the author alone', async () => {
    const s = await setup();
    fakeDiscord(s);
    await post(s, 'mine alone', 'status-only-0001');
    const { results } = await s.db.prepare("SELECT agent_id, guild_id FROM events WHERE type = 'message.status'").all<{ agent_id: string; guild_id: string }>();
    expect(results).toEqual([{ agent_id: s.agent.id, guild_id: GUILD }]);
  });
});
