import { describe, expect, it } from 'vitest';
import { EARLY, agree } from './consent.testkit';
import {
  CONV,
  HUMAN,
  STRANGER,
  THREAD_COLUMNS,
  all,
  at,
  conversation,
  deliveryCount,
  edit,
  eventTypes,
  fromWebhook,
  human,
  msg,
  one,
  poll,
  push,
  relayMessage,
  remove,
  stranger,
  subscribe,
  thread,
  threadRow,
  world,
} from './intake-fixtures';
import { readPage } from './services/conversation';
import { ingest } from './services/intake';
import { contentHash } from './services/moderation/rows';
import { scrubMessage } from './services/scrub';
import { LOUNGE } from './testing';

// A person's words are kept only if they had agreed to the mirror by the time they wrote them. Anything else is stored as a
// marker: no text, poll, reply, name or Discord ID, and no event.

const WITHHELD = {
  author_kind: 'human',
  author_ref: 'p_withheld',
  discord_user_id: null,
  display_name: 'A person in Discord',
  content: null,
  poll: null,
  reply_to: null,
  edited_at: null,
  withheld: 1,
};

const everything = async (h: Awaited<ReturnType<typeof world>>['h']) =>
  JSON.stringify([
    await all(h, `SELECT ${CONV} FROM conversation`),
    await all(h, 'SELECT payload FROM events'),
    await all(h, `SELECT ${THREAD_COLUMNS} FROM threads`),
  ]);

describe('a message from someone who had not agreed', () => {
  it('is kept as a marker only: no text, poll, reply, name, ID or pseudonym, and no event', async () => {
    const { h, agent } = await world();
    await subscribe(h, agent.id);
    const r = await push(h, stranger(1, { content: 'private words about Sam’s plans', poll: poll(), reply_to: msg(99), edited_timestamp: at(1) }));
    expect(r).toMatchObject({ recorded: 0, deliveries: 0, ignored: 1 });
    expect(await conversation(h, 1)).toMatchObject({
      ...WITHHELD,
      channel_id: LOUNGE,
      thread_id: null,
      created_at: at(0, 1),
      deleted_at: null,
      removed_by: null,
    });
    expect(await eventTypes(h)).toEqual([]);
    expect(await deliveryCount(h)).toBe(0);
    const dump = await everything(h);
    for (const secret of ['private words', 'Sam', 'sam', STRANGER, 'Lunch?', 'Soup']) expect(dump).not.toContain(secret);
  });

  it('still moves the channel’s cursor, so a backfill doesn’t fetch it again', async () => {
    const { h } = await world();
    await push(h, stranger(1));
    expect(await one(h, 'SELECT CAST(last_message_id AS TEXT) AS id FROM channel_cursors WHERE channel_id = ?', LOUNGE)).toEqual({ id: msg(1) });
  });

  it('stays withheld when the person agrees afterwards, and the text is not recoverable', async () => {
    const { h } = await world();
    await push(h, stranger(1, { content: 'before I agreed' }));
    await agree(h, STRANGER, { at: at(0, 30) });
    await push(h, stranger(2, { content: 'after I agreed', timestamp: at(1) }));
    expect(await conversation(h, 1)).toMatchObject(WITHHELD);
    expect(await conversation(h, 2)).toMatchObject({ content: 'after I agreed', discord_user_id: STRANGER, withheld: 0 });
    // Replaying the first create (a Gateway resume, a backfill) can't fill it in now that they have agreed.
    await push(h, stranger(1, { content: 'before I agreed' }));
    expect(await conversation(h, 1)).toMatchObject(WITHHELD);
    for (const view of ['agent', 'public'] as const) {
      const page = (await readPage(h.relay, LOUNGE, { view })).messages;
      expect(page.find((m) => m.message_id === msg(1))).toMatchObject({
        content: null,
        author: { author_id: 'p_withheld', display_name: 'A person in Discord' },
      });
      expect(page.find((m) => m.message_id === msg(2))).toMatchObject({ content: 'after I agreed', author: { display_name: 'Sam' } });
    }
  });

  it('uses the moment they wrote it, down to the millisecond: agreeing at that moment counts, a moment later does not', async () => {
    const { h } = await world();
    const exact = '2026-10-19T03:05:00.000Z';
    await agree(h, STRANGER, { at: exact });
    await push(
      h,
      stranger(1, { timestamp: exact, content: 'at the moment' }),
      stranger(2, { timestamp: '2026-10-19T02:59:59.999Z', content: 'a millisecond before' }),
    );
    expect(await conversation(h, 1)).toMatchObject({ content: 'at the moment', withheld: 0 });
    expect(await conversation(h, 2)).toMatchObject({ ...WITHHELD, created_at: '2026-10-19T02:59:59.999Z' });
  });

  it('is what a person who left, or whose agreement was withdrawn, writes next', async () => {
    const { h } = await world();
    await h.db.prepare('UPDATE consents SET revoked_at = ? WHERE discord_user_id = ?').bind('2026-10-19T02:00:00.000Z', HUMAN).run();
    await push(h, human(1, { content: 'after leaving' }));
    expect(await conversation(h, 1)).toMatchObject(WITHHELD);
  });

  it('is the same for a backfill: history from before they agreed stays withheld, history after is kept without announcing it', async () => {
    const { h, agent } = await world();
    await subscribe(h, agent.id);
    await agree(h, STRANGER, { at: at(0, 5) });
    await ingest(h.relay, {
      source: 'backfill',
      history: true,
      events: [stranger(1, { content: 'old' }), stranger(6, { content: 'newer' }), human(7, { content: 'by someone who agreed long ago' })],
    });
    expect(await conversation(h, 1)).toMatchObject(WITHHELD);
    expect(await conversation(h, 6)).toMatchObject({ content: 'newer', withheld: 0 });
    expect(await conversation(h, 7)).toMatchObject({ content: 'by someone who agreed long ago' });
    expect(await eventTypes(h)).toEqual([]);
  });

  it('asks about every person in a round once, in a single query', async () => {
    const { h } = await world();
    let reads = 0;
    const prepare = h.db.prepare.bind(h.db);
    h.db.prepare = (sql: string) => {
      if (/^SELECT discord_user_id, granted_at FROM consents/.test(sql)) reads++;
      return prepare(sql);
    };
    await push(h, human(1), stranger(2), human(3), stranger(4), fromWebhook(5, 'Some Feed', 'news'));
    expect(reads).toBe(1);
  });

  it('does not affect agents, bots or webhooks, which need no agreement', async () => {
    const { h, agent } = await world();
    const hash = await contentHash('Good morning');
    await relayMessage(h, agent.id, { content: 'Good morning', status: 'sent', discordMessageId: msg(5), hash });
    await push(
      h,
      fromWebhook(5, 'Moth-9', 'Good morning'),
      fromWebhook(6, 'Some Feed', 'headline', { author: { id: '600000000000000077', username: 'Some Feed', bot: true, webhook_id: '600000000000000077' } }),
      stranger(7, { content: 'a bot speaking', author: { id: '200000000000000099', username: 'helper', bot: true } }),
    );
    expect(await conversation(h, 5)).toMatchObject({ author_kind: 'agent', content: 'Good morning', withheld: 0 });
    expect(await conversation(h, 6)).toMatchObject({ author_kind: 'webhook', content: 'headline', withheld: 0 });
    expect(await conversation(h, 7)).toMatchObject({ author_kind: 'bot', content: 'a bot speaking', withheld: 0 });
    expect(await eventTypes(h)).toEqual(['message.created', 'message.created', 'message.created']);
  });
});

describe('edits and deletes of a message that was withheld', () => {
  it('ignore an edit: no event, no text, no edit time', async () => {
    const { h, agent } = await world();
    await subscribe(h, agent.id);
    await push(h, stranger(1));
    const r = await push(h, edit(1, 'now with private words', 5));
    expect(r).toMatchObject({ recorded: 0, deliveries: 0, ignored: 1 });
    expect(await conversation(h, 1)).toMatchObject(WITHHELD);
    expect(await eventTypes(h)).toEqual([]);
    expect(await everything(h)).not.toContain('private words');
  });

  it('ignore an edit in the same batch as the create', async () => {
    const { h } = await world();
    await push(h, stranger(1), edit(1, 'private words', 5));
    expect(await conversation(h, 1)).toMatchObject(WITHHELD);
    expect(await everything(h)).not.toContain('private words');
  });

  it('keep a tombstone when deleted, and tell no subscriber', async () => {
    const { h, agent } = await world();
    await subscribe(h, agent.id);
    await push(h, stranger(1));
    const r = await push(h, remove(1));
    expect(r).toMatchObject({ recorded: 1, deliveries: 0 });
    expect(await conversation(h, 1)).toMatchObject({ ...WITHHELD, removed_by: 'discord' });
    expect((await conversation(h, 1))!.deleted_at).not.toBeNull();
    expect(await eventTypes(h)).toEqual(['message.deleted']);
    expect(await deliveryCount(h)).toBe(0);
  });

  it('tell subscribers when a bulk delete includes a message they were told about, and not otherwise', async () => {
    const { h, agent } = await world();
    await subscribe(h, agent.id);
    await push(h, stranger(1), stranger(2), human(3));
    expect(await deliveryCount(h)).toBe(1);
    const bulk = (ids: number[]) => ({ kind: 'message_delete_bulk' as const, channel_id: LOUNGE, message_ids: ids.map(msg) });
    expect(await push(h, bulk([1, 2]))).toMatchObject({ recorded: 1, deliveries: 0 });
    expect(await push(h, bulk([1, 2, 3]))).toMatchObject({ recorded: 1, deliveries: 1 });
  });

  it('are not announced by a takedown either', async () => {
    const { h, agent } = await world();
    await subscribe(h, agent.id);
    await push(h, stranger(1));
    await scrubMessage(h.relay, msg(1), 'moderator');
    expect(await deliveryCount(h)).toBe(0);
    expect(await conversation(h, 1)).toMatchObject({ ...WITHHELD, removed_by: 'moderator' });
  });

  it('leave a late create alone: a delete that came first still wins', async () => {
    const { h } = await world();
    await push(h, remove(1));
    await push(h, stranger(1, { content: 'resurrected?' }));
    expect(await conversation(h, 1)).toMatchObject({ ...WITHHELD, removed_by: 'discord' });
  });
});

describe('edits to messages the relay never saw', () => {
  it('are logged without their text, since nothing says who wrote them', async () => {
    const { h, agent } = await world();
    await subscribe(h, agent.id);
    const r = await push(h, edit(7, 'who knows what this says', 5));
    expect(r).toMatchObject({ recorded: 1, deliveries: 0 });
    const data = JSON.parse((await one<{ payload: string }>(h, "SELECT payload FROM events WHERE type = 'message.updated'"))!.payload).data;
    expect(data).toEqual({ message_id: msg(7), edited_at: at(5) });
  });
});

describe('threads and people who had not agreed', () => {
  it('count only messages that are shown: withheld ones add nothing to the size or the last activity', async () => {
    const { h } = await world();
    await push(h, human(10), thread(msg(10), LOUNGE, { name: 'topic' }));
    await push(
      h,
      human(11, { thread_id: msg(10) }),
      stranger(12, { thread_id: msg(10) }),
      human(13, { thread_id: msg(10), timestamp: at(0, 20) }),
      stranger(14, { thread_id: msg(10), timestamp: at(0, 40) }),
    );
    expect(await threadRow(h, msg(10))).toMatchObject({ message_count: 2, last_message_at: at(0, 20) });
    // Deleting a withheld message doesn't subtract; deleting a shown one does.
    await push(h, remove(12), remove(13));
    expect(await threadRow(h, msg(10))).toMatchObject({ message_count: 1 });
  });

  it('start from the same count whether the thread or its messages arrive first', async () => {
    const { h } = await world();
    await push(h, human(11, { thread_id: msg(10) }), stranger(12, { thread_id: msg(10) }), stranger(13, { thread_id: msg(10), timestamp: at(0, 50) }));
    await push(h, thread(msg(10), LOUNGE, { name: 'topic' }));
    expect(await threadRow(h, msg(10))).toMatchObject({ message_count: 1, last_message_at: at(0, 11) });
  });

  it('keep what they already have when an update arrives, rather than counting again', async () => {
    const { h, agent } = await world();
    await push(h, thread(msg(10), LOUNGE, { name: 'topic' }), human(11, { thread_id: msg(10) }));
    await h.db.prepare('UPDATE threads SET creator_agent_id = ? WHERE id = ?').bind(agent.id, msg(10)).run();
    await push(h, thread(msg(10), LOUNGE, { name: 'renamed', archived: true }), human(12, { thread_id: msg(10) }));
    expect(await threadRow(h, msg(10))).toMatchObject({ name: 'renamed', archived: 1, message_count: 2, creator_agent_id: agent.id });
    // One row, however many updates.
    expect(await all(h, 'SELECT 1 FROM threads')).toHaveLength(1);
  });

  it('keep no title for a thread started from a withheld message, whichever arrives first and after a rename', async () => {
    const { h } = await world();
    // The thread is announced first (as with a forum post), then its starter turns out to be withheld.
    await push(h, thread(msg(20), LOUNGE, { name: 'my private plans' }), stranger(20));
    expect(await threadRow(h, msg(20))).toMatchObject({ name: null });
    // The starter first (a thread started from a message), then the thread.
    await push(h, stranger(21), thread(msg(21), LOUNGE, { name: 'also private' }));
    expect(await threadRow(h, msg(21))).toMatchObject({ name: null });
    await push(h, thread(msg(21), LOUNGE, { name: 'renamed, still private', archived: true }));
    expect(await threadRow(h, msg(21))).toMatchObject({ name: null, archived: 1 });
    // A thread started from a message by someone who agreed keeps its title.
    await push(h, human(22), thread(msg(22), LOUNGE, { name: 'fine to show' }));
    expect(await threadRow(h, msg(22))).toMatchObject({ name: 'fine to show' });
  });
});

describe('a create racing a removal', () => {
  it('does not bring the text back when the scrub commits between the round’s read of the events and its write', async () => {
    const { h } = await world();
    const prepare = h.db.prepare.bind(h.db);
    let raced = false;
    h.db.prepare = (sql: string) => {
      const stmt = prepare(sql);
      if (!sql.startsWith('SELECT source_key, observed_at')) return stmt;
      const wrap = (s: typeof stmt): typeof stmt => ({
        bind: (...v) => wrap(s.bind(...v)),
        first: () => s.first(),
        run: () => s.run(),
        all: async <T>() => {
          const rows = await s.all<T>();
          if (!raced) {
            raced = true;
            // The round has now read "no delete yet"; a takedown lands before it writes.
            h.db.prepare = prepare;
            await scrubMessage(h.relay, msg(1), 'moderator', { channelId: LOUNGE });
          }
          return rows;
        },
      });
      return wrap(stmt);
    };
    await push(h, human(1, { content: 'private plans', poll: poll() }));
    expect(raced).toBe(true);
    expect(await conversation(h, 1)).toMatchObject({ content: null, poll: null, removed_by: 'moderator' });
    expect((await conversation(h, 1))!.deleted_at).not.toBeNull();
    // Nor is the text logged as an event for readers or subscribers.
    const { results } = await h.db
      .prepare("SELECT payload FROM events WHERE message_id = ? AND type = 'message.created'")
      .bind(msg(1))
      .all<{ payload: string }>();
    expect(results).toEqual([]);
  });
});

describe('the relay’s reply when the Gateway echo wins the race', () => {
  it('keeps the message an agent replied to, in the conversation and in the event', async () => {
    const { h, agent } = await world();
    await push(h, human(1));
    const id = await relayMessage(h, agent.id, { content: 'Good morning', status: 'sent', discordMessageId: msg(5), hash: await contentHash('Good morning') });
    await h.db.prepare('UPDATE relay_messages SET reply_to = ? WHERE id = ?').bind(msg(1), id).run();
    await push(h, fromWebhook(5, 'Moth-9', 'Good morning'));
    expect(await conversation(h, 5)).toMatchObject({ author_kind: 'agent', reply_to: msg(1) });
    const created = JSON.parse(
      (await one<{ payload: string }>(h, "SELECT payload FROM events WHERE message_id = ? AND type = 'message.created'", msg(5)))!.payload,
    );
    expect(created.data.reply_to).toBe(msg(1));
  });

  it('does the same when the echo is matched by its text', async () => {
    const { h, agent } = await world();
    await push(h, human(1));
    const id = await relayMessage(h, agent.id, { content: 'Hello?', status: 'sending', hash: await contentHash('Hello?') });
    await h.db.prepare('UPDATE relay_messages SET reply_to = ? WHERE id = ?').bind(msg(1), id).run();
    await push(h, fromWebhook(5, 'Moth-9', 'Hello?'));
    expect(await conversation(h, 5)).toMatchObject({ author_kind: 'agent', reply_to: msg(1) });
  });
});

describe('the consent the read side checks', () => {
  it('is shown to agents and the public alike, for a person who agreed before the message and still agrees', async () => {
    const { h } = await world();
    await push(h, human(1, { content: 'hello' }));
    for (const view of ['agent', 'public'] as const)
      expect((await readPage(h.relay, LOUNGE, { view })).messages[0]).toMatchObject({
        content: 'hello',
        author: { display_name: 'Luna', author_id: expect.stringMatching(/^p_(?!withheld)/) },
      });
    // The agreement is withdrawn: the text is hidden at once, before anything has been scrubbed.
    await h.db.prepare('UPDATE consents SET revoked_at = ?').bind(at(30)).run();
    for (const view of ['agent', 'public'] as const)
      expect((await readPage(h.relay, LOUNGE, { view })).messages[0]).toMatchObject({
        content: null,
        author: { display_name: 'A person in Discord', author_id: 'p_withheld' },
      });
  });

  it('is decided by when the person agreed, even for a message stored with its text', async () => {
    const { h } = await world();
    await push(h, human(1, { content: 'hello' }));
    // They left and agreed again: the new agreement starts after the message, so it stays hidden.
    await h.db.prepare('UPDATE consents SET granted_at = ?').bind(at(10)).run();
    for (const view of ['agent', 'public'] as const) expect((await readPage(h.relay, LOUNGE, { view })).messages[0]!.content).toBeNull();
    await h.db.prepare('UPDATE consents SET granted_at = ?').bind(EARLY).run();
    expect((await readPage(h.relay, LOUNGE, { view: 'agent' })).messages[0]!.content).toBe('hello');
  });
});
