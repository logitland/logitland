import { RelayEvent } from '@logitland/contracts';
import { describe, expect, it } from 'vitest';
import {
  all,
  at,
  conversation,
  deliveryCount,
  edit,
  eventTypes,
  fromWebhook,
  human,
  HUMAN,
  msg,
  one,
  poll,
  push,
  relayMessage,
  remove,
  subscribe,
  WEBHOOK,
  world,
} from './intake-fixtures';
import { authorRef } from './services/conversation';
import { ingest, recordAgentPost, recordGap } from './services/intake';
import { contentHash } from './services/moderation/rows';
import { BENCH, LOUNGE } from './testing';

describe('creating messages', () => {
  it('stores people, bots and other webhooks as pseudonymous authors', async () => {
    const { h } = await world();
    const bot = {
      kind: 'message_create',
      channel_id: LOUNGE,
      message_id: msg(2),
      author: { id: '700000000000000009', username: 'Helper', bot: true },
      content: 'beep',
      timestamp: at(0, 2),
    };
    const other = fromWebhook(3, 'Some Feed', 'news', {
      author: { id: '600000000000000077', username: 'Some Feed', bot: true, webhook_id: '600000000000000077' },
    });
    const r = await push(h, human(1), bot, other);
    expect(r).toMatchObject({ recorded: 3, ignored: 0, invalid: 0 });

    const person = (await conversation(h, 1))!;
    expect(person).toMatchObject({
      author_kind: 'human',
      discord_user_id: HUMAN,
      display_name: 'Luna',
      content: 'message 1',
      created_at: at(0, 1),
      agent_id: null,
    });
    expect(person.author_ref).toBe(await authorRef(h.relay, HUMAN));
    expect(person.author_ref).toMatch(/^p_[0-9a-f]{20}$/);

    expect(await conversation(h, 2)).toMatchObject({ author_kind: 'bot', discord_user_id: null, display_name: 'Helper' });
    expect((await conversation(h, 2))!.author_ref).toMatch(/^b_[0-9a-f]{20}$/);
    expect(await conversation(h, 3)).toMatchObject({
      author_kind: 'webhook',
      discord_user_id: null,
      author_ref: 'w_600000000000000077',
      display_name: 'Some Feed',
    });
  });

  it('falls back to the username when there is no global name', async () => {
    const { h } = await world();
    await push(h, human(1, { author: { id: HUMAN, username: 'luna_um' } }));
    expect((await conversation(h, 1))!.display_name).toBe('luna_um');
  });

  it('records events without a cursor that become valid relay events once one is added', async () => {
    const { h } = await world();
    await push(h, human(1), edit(1, 'changed', 5));
    const created = JSON.parse((await one<{ payload: string }>(h, "SELECT payload FROM events WHERE type = 'message.created'"))!.payload);
    expect(created.data).toMatchObject({
      message_id: msg(1),
      thread_id: null,
      content: 'message 1',
      created_at: at(0, 1),
      author: { kind: 'human', agent_id: null, display_name: 'Luna' },
    });
    await push(h, remove(1));
    const rows = await all<{ seq: number; payload: string }>(h, 'SELECT seq, payload FROM events ORDER BY seq');
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      const payload = JSON.parse(r.payload);
      expect(payload).not.toHaveProperty('cursor');
      expect(() => RelayEvent.parse({ ...payload, cursor: String(r.seq) })).not.toThrow();
    }
  });

  it('keeps only channels open to agents and only default and reply messages', async () => {
    const { h } = await world();
    const r = await push(h, human(1, { channel_id: BENCH }), human(2), human(3, { channel_id: '119999999999999999' }));
    expect(r).toMatchObject({ recorded: 1, ignored: 2 });
    expect(await all(h, 'SELECT 1 FROM conversation')).toHaveLength(1);
  });

  it('maps thread messages to the parent channel with thread_id and remembers threads of open channels', async () => {
    const { h } = await world();
    const thread = '120000000000000001';
    await push(
      h,
      { kind: 'thread_upsert', thread_id: thread, parent_id: LOUNGE, name: 'planning' },
      { kind: 'thread_upsert', thread_id: '120000000000000002', parent_id: BENCH, name: 'elsewhere' },
      human(1, { thread_id: thread }),
    );
    expect(await conversation(h, 1)).toMatchObject({ channel_id: LOUNGE, thread_id: thread });
    expect(await all(h, 'SELECT CAST(id AS TEXT) AS id, parent_id, name FROM threads')).toEqual([{ id: thread, parent_id: LOUNGE, name: 'planning' }]);
    expect(JSON.parse((await one<{ payload: string }>(h, 'SELECT payload FROM events'))!.payload).data.thread_id).toBe(thread);
    // The thread keeps its own cursor so a gap can be filled from it.
    expect(
      (await all<{ channel_id: string; last: string }>(h, 'SELECT channel_id, CAST(last_message_id AS TEXT) AS last FROM channel_cursors')).map((c) => [
        c.channel_id,
        c.last,
      ]),
    ).toEqual([[thread, msg(1)]]);
  });

  it('updates a thread’s name and parent when Discord says so', async () => {
    const { h } = await world();
    const thread = '120000000000000001';
    await push(h, { kind: 'thread_upsert', thread_id: thread, parent_id: LOUNGE, name: 'old' });
    await push(h, { kind: 'thread_upsert', thread_id: thread, parent_id: LOUNGE, name: 'new' });
    expect(await all(h, 'SELECT name FROM threads')).toEqual([{ name: 'new' }]);
  });

  it('keeps the newest message ID per channel as its cursor, comparing 18 and 19 digit snowflakes as numbers', async () => {
    const { h } = await world();
    const eighteen = '999999999999999999';
    const nineteen = '1000000000000000001';
    await push(h, human(1, { message_id: nineteen }), human(2, { message_id: eighteen }));
    expect((await one<{ last: string }>(h, 'SELECT CAST(last_message_id AS TEXT) AS last FROM channel_cursors WHERE channel_id = ?', LOUNGE))!.last).toBe(
      nineteen,
    );
    await push(h, human(3, { message_id: '1000000000000000000' }));
    expect((await one<{ last: string }>(h, 'SELECT CAST(last_message_id AS TEXT) AS last FROM channel_cursors WHERE channel_id = ?', LOUNGE))!.last).toBe(
      nineteen,
    );
    expect((await all<{ id: string }>(h, 'SELECT CAST(message_id AS TEXT) AS id FROM conversation ORDER BY message_id')).map((r) => r.id)).toEqual([
      eighteen,
      '1000000000000000000',
      nineteen,
    ]);
  });
});

describe('idempotency', () => {
  it('records nothing new, and sends nothing new, when the same events arrive again', async () => {
    const { h, agent } = await world();
    await subscribe(h, agent.id);
    const batch = [human(1), human(2), edit(1, 'changed', 5), remove(2)];
    const first = await push(h, ...batch);
    expect(first).toMatchObject({ recorded: 4, deliveries: 4 });
    const before = { events: await all(h, 'SELECT seq FROM events'), deliveries: await deliveryCount(h) };
    const again = await push(h, ...batch);
    expect(again).toMatchObject({ recorded: 0, deliveries: 0, ignored: 4 });
    expect(await all(h, 'SELECT seq FROM events')).toEqual(before.events);
    expect(await deliveryCount(h)).toBe(before.deliveries);
    expect(await conversation(h, 1)).toMatchObject({ content: 'changed' });
  });

  it('gives events deterministic source keys', async () => {
    const { h } = await world();
    await push(
      h,
      human(1),
      edit(1, 'x', 5),
      remove(1),
      { kind: 'message_delete_bulk', channel_id: LOUNGE, message_ids: [msg(9), msg(8)] },
      { kind: 'message_delete_bulk', channel_id: LOUNGE, message_ids: [msg(8), msg(9)] },
    );
    const keys = (await all<{ source_key: string }>(h, 'SELECT source_key FROM events ORDER BY seq')).map((r) =>
      r.source_key.replace(/[0-9a-f]{64}/, '<hash>'),
    );
    // A bulk delete leaves a tombstone for each message the relay didn't hold.
    expect(keys).toEqual([`create:${msg(1)}`, `update:${msg(1)}:${at(5)}`, `delete:${msg(1)}`, 'bulk:<hash>', `delete:${msg(9)}`, `delete:${msg(8)}`]);
  });

  it('fans out only events that are new, to subscriptions that asked for the type', async () => {
    const { h, agent } = await world();
    await subscribe(h, agent.id, LOUNGE, ['message.created']);
    await push(h, human(1), edit(1, 'x', 5));
    expect(await deliveryCount(h)).toBe(1);
    expect((await all<{ event_type: string }>(h, 'SELECT event_type FROM deliveries')).map((d) => d.event_type)).toEqual(['message.created']);
  });

  it('does not let one bad event reject the batch', async () => {
    const { h } = await world();
    const r = await push(h, human(1), { kind: 'message_create', channel_id: 'nope' }, 'garbage', null, human(2));
    expect(r).toMatchObject({ recorded: 2, invalid: 3 });
    expect(h.log.lines.some((l) => l.event === 'intake.invalid_events' && l.fields.count === 3)).toBe(true);
  });
});

describe('edits', () => {
  it('apply only when newer than the stored edit', async () => {
    const { h } = await world();
    await push(h, human(1), edit(1, 'second', 6), edit(1, 'first', 5));
    expect(await conversation(h, 1)).toMatchObject({ content: 'second', edited_at: at(6) });
    expect(await eventTypes(h)).toEqual(['message.created', 'message.updated']);
    await push(h, edit(1, 'third', 7));
    expect(await conversation(h, 1)).toMatchObject({ content: 'third', edited_at: at(7) });
  });

  it('leave the text alone when Discord sends no content', async () => {
    const { h } = await world();
    await push(h, human(1), edit(1, undefined, 5));
    expect(await conversation(h, 1)).toMatchObject({ content: 'message 1', edited_at: at(5) });
    expect(JSON.parse((await one<{ payload: string }>(h, "SELECT payload FROM events WHERE type = 'message.updated'"))!.payload).data).toEqual({
      message_id: msg(1),
      edited_at: at(5),
    });
  });

  it('are recorded but not sent on for messages the relay never saw', async () => {
    const { h, agent } = await world();
    await subscribe(h, agent.id);
    const r = await push(h, edit(7, 'who knows', 5));
    expect(r).toMatchObject({ recorded: 1, deliveries: 0 });
    expect(await eventTypes(h)).toEqual(['message.updated']);
    expect(await conversation(h, 7)).toBeNull();
  });

  it('are ignored for deleted messages', async () => {
    const { h } = await world();
    await push(h, human(1), remove(1));
    expect(await push(h, edit(1, 'ghost', 5))).toMatchObject({ recorded: 0, ignored: 1 });
    expect((await conversation(h, 1))!.content).toBeNull();
  });

  it('take a message created with an edit already on it as that edit', async () => {
    const { h } = await world();
    await push(h, human(1, { edited_timestamp: at(5) }));
    await push(h, edit(1, 'older than the backfill', 4), edit(1, 'same as the backfill', 5));
    expect(await conversation(h, 1)).toMatchObject({ content: 'message 1', edited_at: at(5) });
  });
});

describe('deletes', () => {
  it('leave a tombstone and tell subscribers', async () => {
    const { h, agent } = await world();
    await subscribe(h, agent.id);
    await push(h, human(1));
    const r = await push(h, remove(1));
    expect(r).toMatchObject({ recorded: 1, deliveries: 1 });
    expect(await conversation(h, 1)).toMatchObject({ content: null, removed_by: 'discord' });
    expect((await conversation(h, 1))!.deleted_at).not.toBeNull();
    expect(JSON.parse((await one<{ payload: string }>(h, "SELECT payload FROM events WHERE type = 'message.deleted'"))!.payload).data).toEqual({
      message_id: msg(1),
      removed_by: 'discord',
    });
  });

  it('that arrive before their create stop the late create from bringing the text back', async () => {
    const { h, agent } = await world();
    await subscribe(h, agent.id);
    const early = await push(h, remove(1));
    expect(early).toMatchObject({ recorded: 1, deliveries: 0 });
    const late = await push(h, human(1));
    expect(late).toMatchObject({ recorded: 0, deliveries: 0 });
    expect(await conversation(h, 1)).toMatchObject({ content: null, removed_by: 'discord', author_kind: 'human' });
    expect(await eventTypes(h)).toEqual(['message.deleted']);
    expect(await deliveryCount(h)).toBe(0);
  });

  it('keep the order of a create and a delete in one batch', async () => {
    const { h } = await world();
    await push(h, human(1), remove(1), human(2));
    expect(await eventTypes(h)).toEqual(['message.created', 'message.deleted', 'message.created']);
    expect((await conversation(h, 1))!.content).toBeNull();
    expect((await conversation(h, 2))!.content).toBe('message 2');
  });

  it('that come first in the same batch also stop the create that follows', async () => {
    const { h } = await world();
    await push(h, remove(1), human(1, { content: 'resurrected?' }));
    expect(await conversation(h, 1)).toMatchObject({ content: null, removed_by: 'discord' });
    expect(await eventTypes(h)).toEqual(['message.deleted']);
  });

  it('are handled in bulk, once, whatever the order of the IDs', async () => {
    const { h, agent } = await world();
    await subscribe(h, agent.id);
    await push(h, human(1), human(2), human(3));
    const bulk = { kind: 'message_delete_bulk' as const, channel_id: LOUNGE, message_ids: [msg(2), msg(1), msg(99)] };
    // The removal event, and a tombstone for the one message the relay doesn't hold (not announced).
    expect(await push(h, bulk)).toMatchObject({ recorded: 2, deliveries: 1 });
    expect(await push(h, { ...bulk, message_ids: [msg(99), msg(1), msg(2)] })).toMatchObject({ recorded: 0 });
    expect((await conversation(h, 1))!.content).toBeNull();
    expect((await conversation(h, 2))!.content).toBeNull();
    expect((await conversation(h, 3))!.content).toBe('message 3');
    expect(JSON.parse((await one<{ payload: string }>(h, "SELECT payload FROM events WHERE type = 'message.bulk_deleted'"))!.payload).data.message_ids).toEqual(
      [msg(1), msg(2), msg(99)],
    );
  });
});

describe('a bulk delete before the messages are written', () => {
  it('keeps a message that arrives late (a backfill page, a seed) from bringing its text back or being announced', async () => {
    const { h, agent } = await world();
    await subscribe(h, agent.id);
    await push(h, { kind: 'message_delete_bulk', channel_id: LOUNGE, message_ids: [msg(7), msg(8)] });
    const before = await deliveryCount(h);
    await push(h, human(7, { content: 'doxx: address' }), human(8, { content: 'more' }), human(9));
    for (const n of [7, 8]) expect(await conversation(h, n)).toMatchObject({ content: null, removed_by: 'discord' });
    expect((await conversation(h, 7))!.deleted_at).not.toBeNull();
    expect(await conversation(h, 9)).toMatchObject({ content: 'message 9' });
    expect(await deliveryCount(h)).toBe(before + 1);
    expect(
      (await all<{ message_id: string }>(h, "SELECT CAST(message_id AS TEXT) AS message_id FROM events WHERE type = 'message.created'")).map(
        (e) => e.message_id,
      ),
    ).toEqual([msg(9)]);
  });
});

describe('telling agents’ posts from other webhooks', () => {
  it('finds the agent through the Discord message ID the pipeline already stored', async () => {
    const { h, agent } = await world();
    const hash = await contentHash('Good morning');
    const id = await relayMessage(h, agent.id, { content: 'Good morning', status: 'sent', discordMessageId: msg(5), hash });
    await push(h, fromWebhook(5, 'Moth-9', 'Good morning'));
    expect(await conversation(h, 5)).toMatchObject({
      author_kind: 'agent',
      agent_id: agent.id,
      author_ref: agent.id,
      display_name: 'Moth-9',
      relay_message_id: id,
      discord_user_id: null,
    });
    const event = JSON.parse((await one<{ payload: string }>(h, 'SELECT payload FROM events'))!.payload);
    expect(event.data.author).toEqual({ kind: 'agent', agent_id: agent.id, author_id: agent.id, display_name: 'Moth-9' });
  });

  it('matches by channel, text and webhook name when the Gateway beats the HTTP response, and settles the send', async () => {
    const { h, agent } = await world();
    const id = await relayMessage(h, agent.id, { content: 'Good  MORNING', hash: await contentHash('Good  MORNING') });
    h.advance(2_000);
    await push(h, fromWebhook(5, 'moth-9', 'good morning'));
    expect(await conversation(h, 5)).toMatchObject({ author_kind: 'agent', agent_id: agent.id, relay_message_id: id });
    expect(await one(h, 'SELECT status, discord_message_id FROM relay_messages WHERE id = ?', id)).toEqual({ status: 'sent', discord_message_id: msg(5) });
  });

  it('settles a send the relay was unsure about, the way the sender does: confirmed at Discord’s time, with the doubt cleared', async () => {
    const { h, agent } = await world();
    const id = await relayMessage(h, agent.id, { content: 'Hello?', status: 'uncertain', hash: await contentHash('Hello?') });
    await h.db.prepare('UPDATE relay_messages SET status_reason = ? WHERE id = ?').bind('Discord did not answer; checking the channel.', id).run();
    await push(h, fromWebhook(5, 'Moth-9', 'Hello?'));
    expect(await one(h, 'SELECT status, discord_message_id, sent_at, status_reason FROM relay_messages WHERE id = ?', id)).toEqual({
      status: 'sent',
      discord_message_id: msg(5),
      sent_at: at(0, 5),
      status_reason: null,
    });
    expect(h.log.lines.some((l) => l.event === 'intake.send_settled')).toBe(true);
  });

  it('does not guess when the text, channel, name or age do not fit', async () => {
    const { h, agent } = await world();
    const hash = await contentHash('Hello');
    const waiting = await relayMessage(h, agent.id, { content: 'Hello', hash });
    await push(h, fromWebhook(1, 'Moth-9', 'Hello there'), fromWebhook(2, 'Somebody Else', 'Hello'), fromWebhook(3, 'Moth-9', 'Hello', { channel_id: BENCH }));
    const stale = await relayMessage(h, agent.id, {
      content: 'Old news',
      hash: await contentHash('Old news'),
      createdAt: new Date(h.now().getTime() - 11 * 60_000).toISOString(),
    });
    await push(h, fromWebhook(4, 'Moth-9', 'Old news'));
    for (const n of [1, 2, 4]) expect(await conversation(h, n)).toMatchObject({ author_kind: 'webhook', author_ref: `w_${WEBHOOK}` });
    expect(await one(h, 'SELECT status, discord_message_id FROM relay_messages WHERE id = ?', waiting)).toEqual({
      status: 'sending',
      discord_message_id: null,
    });
    expect((await one<{ status: string }>(h, 'SELECT status FROM relay_messages WHERE id = ?', stale))!.status).toBe('sending');
  });

  it('matches a send attempted just now even though the message was written long ago (released from review)', async () => {
    const { h, agent } = await world();
    const old = new Date(h.now().getTime() - 15 * 60_000).toISOString();
    const id = await relayMessage(h, agent.id, { content: 'Held for a while', hash: await contentHash('Held for a while'), createdAt: old });
    await h.db.prepare('UPDATE relay_messages SET updated_at = ? WHERE id = ?').bind(h.now().toISOString(), id).run();
    await push(h, fromWebhook(5, 'Moth-9', 'Held for a while'));
    expect(await conversation(h, 5)).toMatchObject({ author_kind: 'agent', agent_id: agent.id, relay_message_id: id });
    expect(await one(h, 'SELECT status, discord_message_id FROM relay_messages WHERE id = ?', id)).toEqual({ status: 'sent', discord_message_id: msg(5) });
  });

  it('prefers the send in flight to an older uncertain one, and tells polls apart by their question', async () => {
    const { h, agent } = await world();
    const hash = await contentHash('');
    const a = await relayMessage(h, agent.id, { content: '', status: 'uncertain', hash });
    h.advance(1_000);
    const b = await relayMessage(h, agent.id, { content: '', status: 'sending', hash });
    await h.db
      .prepare('UPDATE relay_messages SET poll = ? WHERE id = ?')
      .bind(JSON.stringify({ question: 'Soup?' }), a)
      .run();
    await h.db
      .prepare('UPDATE relay_messages SET poll = ? WHERE id = ?')
      .bind(JSON.stringify({ question: 'Noodles?' }), b)
      .run();
    await push(h, fromWebhook(5, 'Moth-9', '', { poll: poll({ question: 'Noodles?' }) }));
    expect(await one(h, 'SELECT status, discord_message_id FROM relay_messages WHERE id = ?', b)).toEqual({ status: 'sent', discord_message_id: msg(5) });
    expect(await one(h, 'SELECT status, discord_message_id FROM relay_messages WHERE id = ?', a)).toEqual({ status: 'uncertain', discord_message_id: null });
    // Without a poll question to go on, the one still in flight goes first.
    const c = await relayMessage(h, agent.id, { content: 'plain', status: 'uncertain', hash: await contentHash('plain') });
    h.advance(1_000);
    const d = await relayMessage(h, agent.id, { content: 'plain', status: 'sending', hash: await contentHash('plain') });
    await push(h, fromWebhook(6, 'Moth-9', 'plain'));
    expect((await one<{ status: string }>(h, 'SELECT status FROM relay_messages WHERE id = ?', d))!.status).toBe('sent');
    expect((await one<{ status: string }>(h, 'SELECT status FROM relay_messages WHERE id = ?', c))!.status).toBe('uncertain');
  });

  it('only claims a send once: identical texts settle one message each, oldest first', async () => {
    const { h, agent } = await world();
    const hash = await contentHash('same');
    const first = await relayMessage(h, agent.id, { content: 'same', hash });
    h.advance(1_000);
    const second = await relayMessage(h, agent.id, { content: 'same', hash });
    await push(h, fromWebhook(5, 'Moth-9', 'same'), fromWebhook(6, 'Moth-9', 'same'), fromWebhook(7, 'Moth-9', 'same'));
    expect(await one(h, 'SELECT discord_message_id FROM relay_messages WHERE id = ?', first)).toEqual({ discord_message_id: msg(5) });
    expect(await one(h, 'SELECT discord_message_id FROM relay_messages WHERE id = ?', second)).toEqual({ discord_message_id: msg(6) });
    expect(await conversation(h, 7)).toMatchObject({ author_kind: 'webhook' });
  });

  it('treats webhooks that are not the channel’s own as webhooks, even under an agent’s name', async () => {
    const { h, agent } = await world();
    await relayMessage(h, agent.id, { content: 'hi', hash: await contentHash('hi') });
    await push(h, fromWebhook(5, 'Moth-9', 'hi', { author: { id: '600000000000000042', username: 'Moth-9', bot: true, webhook_id: '600000000000000042' } }));
    expect(await conversation(h, 5)).toMatchObject({ author_kind: 'webhook', author_ref: 'w_600000000000000042' });
  });
});

describe('recording agent posts directly', () => {
  const post = (agentId: string, over: Record<string, unknown> = {}) => ({
    discordMessageId: msg(5),
    channelId: LOUNGE,
    threadId: null,
    agentId,
    displayName: 'Moth-9',
    content: 'Good morning',
    relayMessageId: 'msg_01JB7Q2M8R',
    createdAt: at(1),
    ...over,
  });

  it('writes the conversation row and the event, and fans out, without the Gateway', async () => {
    const { h, agent } = await world();
    await subscribe(h, agent.id);
    await recordAgentPost(h.relay, post(agent.id));
    expect(await conversation(h, 5)).toMatchObject({
      author_kind: 'agent',
      agent_id: agent.id,
      author_ref: agent.id,
      content: 'Good morning',
      relay_message_id: 'msg_01JB7Q2M8R',
      created_at: at(1),
    });
    expect(await eventTypes(h)).toEqual(['message.created']);
    expect(await deliveryCount(h)).toBe(1);
    expect((await one<{ last: string }>(h, 'SELECT CAST(last_message_id AS TEXT) AS last FROM channel_cursors'))!.last).toBe(msg(5));
  });

  it('records the event once whichever of the Gateway and the pipeline gets there first', async () => {
    const { h, agent } = await world();
    await subscribe(h, agent.id);
    await recordAgentPost(h.relay, post(agent.id));
    await push(h, fromWebhook(5, 'Moth-9', 'Good morning'));
    expect(await eventTypes(h)).toEqual(['message.created']);
    expect(await deliveryCount(h)).toBe(1);

    await push(h, fromWebhook(6, 'Moth-9', 'Second'));
    await recordAgentPost(h.relay, post(agent.id, { discordMessageId: msg(6), content: 'Second' }));
    expect(await eventTypes(h)).toEqual(['message.created', 'message.created']);
  });

  it('upgrades a row the Gateway stored as a plain webhook, and never downgrades', async () => {
    const { h, agent } = await world();
    await push(h, fromWebhook(5, 'Moth-9', 'Good morning'));
    expect(await conversation(h, 5)).toMatchObject({ author_kind: 'webhook' });
    await recordAgentPost(h.relay, post(agent.id));
    expect(await conversation(h, 5)).toMatchObject({ author_kind: 'agent', agent_id: agent.id, author_ref: agent.id, relay_message_id: 'msg_01JB7Q2M8R' });

    await push(h, human(7));
    await recordAgentPost(h.relay, post(agent.id, { discordMessageId: msg(7) }));
    expect(await conversation(h, 7)).toMatchObject({ author_kind: 'human', agent_id: null });
  });

  it('keeps the text out when a takedown got in first', async () => {
    const { h, agent } = await world();
    await push(h, remove(5));
    await recordAgentPost(h.relay, post(agent.id));
    expect(await conversation(h, 5)).toMatchObject({ content: null, removed_by: 'discord' });
    expect(await eventTypes(h)).toEqual(['message.deleted']);
  });

  it('puts a thread post under its parent channel', async () => {
    const { h, agent } = await world();
    await recordAgentPost(h.relay, post(agent.id, { threadId: '120000000000000001' }));
    expect(await conversation(h, 5)).toMatchObject({ channel_id: LOUNGE, thread_id: '120000000000000001' });
  });
});

describe('gaps', () => {
  it('records a gap event per channel with a resume cursor that is the event’s own, and fans out', async () => {
    const { h, agent } = await world();
    await subscribe(h, agent.id);
    await push(h, human(1));
    const n = await recordGap(h.relay, {
      channelIds: [LOUNGE, BENCH],
      windowStart: '2026-10-19T02:00:00Z',
      windowEnd: '2026-10-19T02:05:00Z',
      reason: 'The relay lost its session',
    });
    expect(n).toBe(2);
    const rows = await all<{ seq: number; channel_id: string; payload: string; source_key: string }>(
      h,
      "SELECT seq, channel_id, payload, source_key FROM events WHERE type = 'subscription.gap' ORDER BY seq",
    );
    expect(rows.map((r) => r.source_key)).toEqual([
      `gap:${LOUNGE}:2026-10-19T02:00:00.000Z:2026-10-19T02:05:00.000Z`,
      `gap:${BENCH}:2026-10-19T02:00:00.000Z:2026-10-19T02:05:00.000Z`,
    ]);
    for (const r of rows) {
      const payload = JSON.parse(r.payload);
      expect(payload.data).toEqual({
        window_start: '2026-10-19T02:00:00.000Z',
        window_end: '2026-10-19T02:05:00.000Z',
        resume_cursor: String(r.seq),
        reason: 'The relay lost its session',
      });
      expect(() => RelayEvent.parse({ ...payload, cursor: String(r.seq) })).not.toThrow();
    }
    // Only the open channel has a subscriber.
    expect(await deliveryCount(h)).toBe(2);
    const sent = await all<{ event_type: string }>(h, "SELECT event_type FROM deliveries WHERE event_type = 'subscription.gap'");
    expect(sent).toHaveLength(1);
  });

  it('is recorded once for the same window', async () => {
    const { h } = await world();
    const gap = { channelIds: [LOUNGE], windowStart: '2026-10-19T02:00:00Z', windowEnd: '2026-10-19T02:05:00Z', reason: 'x' };
    expect(await recordGap(h.relay, gap)).toBe(1);
    expect(await recordGap(h.relay, gap)).toBe(0);
    expect(await recordGap(h.relay, { ...gap, channelIds: [] })).toBe(0);
  });

  it('for a resumed subscription resumes after the last event from before the window, so the events it missed are not skipped', async () => {
    const { h } = await world();
    await push(h, human(1));
    h.advance(60_000);
    const windowStart = h.now().toISOString();
    h.advance(1_000);
    await push(h, human(2), human(3));
    h.advance(60_000);
    const before = (await one<{ seq: number }>(h, "SELECT seq FROM events WHERE message_id = ? AND type = 'message.created'", msg(1)))!.seq;
    expect(
      await recordGap(h.relay, { channelIds: [LOUNGE], windowStart, windowEnd: h.now().toISOString(), reason: 'paused', subscriptionId: 'sub_01JB7Q2M8R' }),
    ).toBe(1);
    const gap = await one<{ seq: number; payload: string }>(h, "SELECT seq, payload FROM events WHERE type = 'subscription.gap'");
    expect(JSON.parse(gap!.payload).data.resume_cursor).toBe(String(before));
    expect(gap!.seq).toBeGreaterThan(before + 2);
  });
});

describe('limits', () => {
  it('works through large batches in rounds of 100 and keeps D1 queries per batch well under 1,000', async () => {
    const { h } = await world();
    let queries = 0;
    const prepare = h.db.prepare.bind(h.db);
    h.db.prepare = (sql: string) => {
      queries++;
      return prepare(sql);
    };
    const events = Array.from({ length: 100 }, (_, i) => human(i + 1));
    const r = await push(h, ...events);
    expect(r.recorded).toBe(100);
    expect(queries).toBeLessThan(500);

    queries = 0;
    const mixed = [
      ...Array.from({ length: 100 }, (_, i) => edit(i + 1, `edit ${i}`, 5)),
      ...Array.from({ length: 100 }, (_, i) => human(i + 101)),
      ...Array.from({ length: 50 }, (_, i) => remove(i + 1)),
    ];
    expect((await push(h, ...mixed)).recorded).toBe(250);
    // Three rounds of at most 100 events each.
    expect(queries).toBeLessThan(1000);
    expect(await all(h, 'SELECT 1 FROM conversation')).toHaveLength(200);
  });

  it('chunks long ID lists under D1’s limit of 100 bound parameters', async () => {
    const { h } = await world();
    const seen: number[] = [];
    const prepare = h.db.prepare.bind(h.db);
    h.db.prepare = (sql: string) => {
      const stmt = prepare(sql);
      const bind = stmt.bind.bind(stmt);
      stmt.bind = (...values: unknown[]) => {
        seen.push(values.length);
        return bind(...values);
      };
      return stmt;
    };
    await push(h, ...Array.from({ length: 100 }, (_, i) => human(i + 1)));
    await push(h, { kind: 'message_delete_bulk', channel_id: LOUNGE, message_ids: Array.from({ length: 100 }, (_, i) => msg(i + 1)) });
    expect(Math.max(...seen)).toBeLessThanOrEqual(100);
  });
});

describe('intake errors', () => {
  it('surface to the caller so a buffered batch can be retried, and leave nothing half-written', async () => {
    const { h } = await world();
    const original = h.db.batch.bind(h.db);
    h.db.batch = async () => {
      throw new Error('D1 is down');
    };
    await expect(ingest(h.relay, { source: 'test', events: [human(1)] })).rejects.toThrow('D1 is down');
    h.db.batch = original;
    expect((await ingest(h.relay, { source: 'test', events: [human(1)] })).recorded).toBe(1);
  });

  it('does not undo a recorded event when its fan-out fails', async () => {
    const { h, agent } = await world();
    await subscribe(h, agent.id);
    await h.db.prepare('DROP TABLE deliveries').run();
    const r = await push(h, human(1));
    expect(r.recorded).toBe(1);
    expect(h.log.lines.some((l) => l.event === 'intake.fan_out_failed')).toBe(true);
  });
});
