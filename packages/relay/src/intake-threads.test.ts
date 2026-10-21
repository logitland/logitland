import { ThreadPage } from '@logitland/contracts';
import { describe, expect, it } from 'vitest';
import {
  HUMAN,
  MEDIA,
  NEWS,
  WEBHOOK,
  all,
  conversation,
  at,
  human,
  moreChannels,
  msg,
  push,
  remove,
  subscribe,
  thread,
  threadRow,
  waiting,
  world,
} from './intake-fixtures';
import { recordAgentPost } from './services/intake';
import { scrubMessage } from './services/scrub';
import { readPage } from './services/conversation';
import { listThreads } from './services/threads';
import { FORUM, LOUNGE } from './testing';

const list = async (h: Awaited<ReturnType<typeof world>>['h'], channel = LOUNGE, opts: Parameters<typeof listThreads>[2] = {}) =>
  ThreadPage.parse(await listThreads(h.relay, channel, opts));

describe('threads in a text channel', () => {
  it('start from a message: the starter ID is the thread ID, and messages in the thread are counted', async () => {
    const { h } = await world();
    await push(h, human(10, { content: 'let’s talk' }), thread(msg(10), LOUNGE, { name: 'let’s talk', created_at: at(0, 11) }));
    expect(await threadRow(h, msg(10))).toMatchObject({
      parent_id: LOUNGE,
      name: 'let’s talk',
      created_at: at(0, 11),
      archived: 0,
      locked: 0,
      message_count: 0,
      last_message_at: null,
      deleted_at: null,
    });

    await push(h, human(11, { thread_id: msg(10) }), human(12, { thread_id: msg(10) }));
    expect(await threadRow(h, msg(10))).toMatchObject({ message_count: 2, last_message_at: at(0, 12) });

    const page = await list(h);
    expect(page).toEqual({
      threads: [
        {
          id: msg(10),
          channel_id: LOUNGE,
          name: 'let’s talk',
          created_at: at(0, 11),
          last_message_at: at(0, 12),
          message_count: 2,
          archived: false,
          locked: false,
          starter_message_id: msg(10),
          creator_agent_id: null,
          applied_tags: [],
          name_hidden: false,
        },
      ],
      next_before: null,
    });
  });

  it('made without a message have no starter', async () => {
    const { h } = await world();
    await push(h, thread('130000000000000001', LOUNGE, { name: 'on its own' }));
    expect((await list(h)).threads[0]).toMatchObject({ id: '130000000000000001', starter_message_id: null });
  });

  it('count messages that arrived before the thread was announced, and keep counting', async () => {
    const { h } = await world();
    await push(h, human(10), human(11, { thread_id: msg(10) }), human(12, { thread_id: msg(10) }));
    expect(await threadRow(h, msg(10))).toBeNull();
    await push(h, thread(msg(10)));
    expect(await threadRow(h, msg(10))).toMatchObject({ message_count: 2, last_message_at: at(0, 12) });
    await push(h, human(13, { thread_id: msg(10) }));
    expect(await threadRow(h, msg(10))).toMatchObject({ message_count: 3, last_message_at: at(0, 13) });
  });

  it('count each message once, however often it arrives, and drop deleted ones', async () => {
    const { h } = await world();
    await push(h, thread(msg(10)), human(11, { thread_id: msg(10) }), human(12, { thread_id: msg(10) }), human(13, { thread_id: msg(10) }));
    await push(h, human(11, { thread_id: msg(10) }), human(12, { thread_id: msg(10) }));
    expect((await threadRow(h, msg(10)))!.message_count).toBe(3);

    await push(h, remove(12, { thread_id: msg(10) }));
    expect((await threadRow(h, msg(10)))!.message_count).toBe(2);
    // The same delete again, a moderator’s takedown of an already deleted message, and a late create of a deleted one change nothing.
    await push(h, remove(12, { thread_id: msg(10) }));
    await scrubMessage(h.relay, msg(12), 'moderator');
    await push(h, human(12, { thread_id: msg(10) }));
    expect((await threadRow(h, msg(10)))!.message_count).toBe(2);

    await scrubMessage(h.relay, msg(13), 'moderator');
    expect(await threadRow(h, msg(10))).toMatchObject({ message_count: 1, last_message_at: at(0, 13) });
    await push(h, { kind: 'message_delete_bulk', channel_id: LOUNGE, thread_id: msg(10), message_ids: [msg(11)] });
    expect((await threadRow(h, msg(10)))!.message_count).toBe(0);
  });

  it('keep the newest message’s time even when an older one arrives late', async () => {
    const { h } = await world();
    await push(h, thread(msg(10)), human(15, { thread_id: msg(10) }), human(12, { thread_id: msg(10) }));
    expect((await threadRow(h, msg(10)))!.last_message_at).toBe(at(0, 15));
  });
});

describe('threads in an announcement channel', () => {
  it('work the same, started from an announcement', async () => {
    const { h } = await world();
    await moreChannels(h);
    await push(h, human(10, { channel_id: NEWS }), thread(msg(10), NEWS, { name: 'discussion' }), human(11, { channel_id: NEWS, thread_id: msg(10) }));
    const page = await list(h, NEWS);
    expect(page.threads).toHaveLength(1);
    expect(page.threads[0]).toMatchObject({ id: msg(10), channel_id: NEWS, name: 'discussion', message_count: 1, starter_message_id: msg(10) });
  });
});

describe('forum and media posts', () => {
  it('are threads whose starter message is the thread: the starter is in the thread and counts as its first message', async () => {
    const { h } = await world();
    await moreChannels(h);
    for (const [channel, id, n] of [
      [FORUM, msg(30), 30],
      [MEDIA, msg(40), 40],
    ] as const) {
      await push(
        h,
        thread(id, channel, { name: `post ${n}` }),
        human(n, { channel_id: channel, thread_id: id, content: 'first post' }),
        human(n + 1, { channel_id: channel, thread_id: id }),
      );
      const page = await list(h, channel);
      expect(page.threads).toEqual([
        {
          id,
          channel_id: channel,
          name: `post ${n}`,
          created_at: at(0, 5),
          last_message_at: at(0, n + 1),
          message_count: 2,
          archived: false,
          locked: false,
          starter_message_id: id,
          creator_agent_id: null,
          applied_tags: [],
          name_hidden: false,
        },
      ]);
    }
  });

  it('name their starter even before it has been seen', async () => {
    const { h } = await world();
    await moreChannels(h);
    await push(h, thread(msg(30), FORUM));
    expect((await list(h, FORUM)).threads[0]).toMatchObject({ starter_message_id: msg(30), message_count: 0, last_message_at: null });
  });

  it('belong to the agent that posted the starter, whichever arrives first', async () => {
    const { h, agent } = await world();
    await moreChannels(h);
    const post = (n: number, channel: string) => ({
      discordMessageId: msg(n),
      channelId: channel,
      threadId: msg(n),
      agentId: agent.id,
      displayName: 'Moth-9',
      content: 'a post by an agent',
      relayMessageId: 'msg_01JB7Q2M8R',
      createdAt: at(0, n),
    });
    // The post is recorded first (the pipeline), then the Gateway announces the thread.
    await recordAgentPost(h.relay, post(30, FORUM));
    await push(h, thread(msg(30), FORUM));
    expect((await threadRow(h, msg(30)))!.creator_agent_id).toBe(agent.id);
    // The thread is announced first, then the post is recorded.
    await push(h, thread(msg(31), FORUM));
    await recordAgentPost(h.relay, post(31, FORUM));
    expect((await threadRow(h, msg(31)))!.creator_agent_id).toBe(agent.id);
    expect((await list(h, FORUM)).threads.map((t) => [t.id, t.creator_agent_id])).toEqual([
      [msg(31), agent.id],
      [msg(30), agent.id],
    ]);
    // A person’s post has no creator agent.
    await push(h, thread(msg(32), FORUM), human(32, { channel_id: FORUM, thread_id: msg(32) }));
    expect((await threadRow(h, msg(32)))!.creator_agent_id).toBeNull();
  });

  it('also: a thread started from an agent’s message in a text channel is that agent’s', async () => {
    const { h, agent } = await world();
    await recordAgentPost(h.relay, {
      discordMessageId: msg(20),
      channelId: LOUNGE,
      threadId: null,
      agentId: agent.id,
      displayName: 'Moth-9',
      content: 'start here',
      relayMessageId: 'msg_01JB7Q2M8R',
      createdAt: at(0, 20),
    });
    await push(h, thread(msg(20)));
    expect((await list(h)).threads[0]).toMatchObject({ id: msg(20), creator_agent_id: agent.id, starter_message_id: msg(20) });
  });

  it('go to the agent when the Gateway had stored the starter as a plain webhook first', async () => {
    const { h, agent } = await world();
    await moreChannels(h);
    await push(h, thread(msg(30), FORUM), {
      kind: 'message_create',
      channel_id: FORUM,
      thread_id: msg(30),
      message_id: msg(30),
      author: { id: '600000000000000042', username: 'Moth-9', bot: true, webhook_id: '600000000000000042' },
      content: 'hi',
      timestamp: at(0, 30),
    });
    expect((await threadRow(h, msg(30)))!.creator_agent_id).toBeNull();
    await recordAgentPost(h.relay, {
      discordMessageId: msg(30),
      channelId: FORUM,
      threadId: msg(30),
      agentId: agent.id,
      displayName: 'Moth-9',
      content: 'hi',
      relayMessageId: 'msg_01JB7Q2M8R',
      createdAt: at(0, 30),
    });
    expect((await threadRow(h, msg(30)))!.creator_agent_id).toBe(agent.id);
  });
});

describe('forum tags on posts', () => {
  const TAG_A = '140000000000000001';
  const TAG_B = '140000000000000002';

  it('are stored from the post’s tags, replaced when they change, kept when an update says nothing, and cleared by an empty list', async () => {
    const { h } = await world();
    await moreChannels(h);
    const tags = async () => (await list(h, FORUM)).threads[0]!.applied_tags;
    await push(h, thread(msg(30), FORUM, { applied_tags: [TAG_A, TAG_B] }));
    expect(await tags()).toEqual([TAG_A, TAG_B]);
    expect(JSON.parse((await threadRow(h, msg(30)))!.applied_tags)).toEqual([TAG_A, TAG_B]);
    await push(h, thread(msg(30), FORUM, { applied_tags: [TAG_B] }));
    expect(await tags()).toEqual([TAG_B]);
    await push(h, thread(msg(30), FORUM, { applied_tags: null, name: 'renamed' }));
    expect(await tags()).toEqual([TAG_B]);
    await push(h, thread(msg(30), FORUM, { applied_tags: [] }));
    expect(await tags()).toEqual([]);
  });

  it('are empty for posts and threads that have none', async () => {
    const { h } = await world();
    await push(h, thread(msg(10)));
    expect((await list(h)).threads[0]!.applied_tags).toEqual([]);
  });

  it('show whatever the name does', async () => {
    const { h } = await world();
    await moreChannels(h);
    await push(h, thread(msg(30), FORUM, { applied_tags: [TAG_A], owner_id: HUMAN }));
    // A person named this post, so its name is hidden; the tags are not their words.
    expect((await list(h, FORUM)).threads[0]).toMatchObject({ applied_tags: [TAG_A], name_hidden: true });
  });
});

describe('who named a thread', () => {
  /** The relay's Discord application (the harness's DISCORD_APPLICATION_ID), which owns threads the bot starts. */
  const BOT_APPLICATION = '400000000000000001';

  it('keeps no title a person gave, even one who agreed, nor from a later update', async () => {
    const { h } = await world();
    await push(h, human(10), thread(msg(10), LOUNGE, { name: 'my topic', owner_id: HUMAN }));
    expect((await threadRow(h, msg(10)))!.name).toBeNull();
    await push(h, thread(msg(10), LOUNGE, { name: 'renamed', owner_id: HUMAN, archived: true }));
    expect(await threadRow(h, msg(10))).toMatchObject({ name: null, archived: 1 });
    expect((await list(h, LOUNGE, { includeArchived: true })).threads[0]).toMatchObject({ name: 'Untitled thread', name_hidden: true });
  });

  it('keeps titles of threads the bot or one of the channel’s webhooks made', async () => {
    const { h } = await world();
    await push(
      h,
      thread(msg(10), LOUNGE, { name: 'by the webhook', owner_id: WEBHOOK }),
      thread(msg(11), LOUNGE, { name: 'by the bot', owner_id: BOT_APPLICATION }),
    );
    expect((await threadRow(h, msg(10)))!.name).toBe('by the webhook');
    expect((await threadRow(h, msg(11)))!.name).toBe('by the bot');
  });
});

describe('archiving, locking and deleting', () => {
  it('are followed from thread updates, and archived threads are left out of the list unless asked for', async () => {
    const { h } = await world();
    await push(h, thread(msg(10), LOUNGE, { name: 'open one' }), thread(msg(11), LOUNGE, { name: 'closing' }));
    await push(h, thread(msg(11), LOUNGE, { name: 'closed', archived: true, locked: true }));
    expect(await threadRow(h, msg(11))).toMatchObject({ name: 'closed', archived: 1, locked: 1 });
    expect((await list(h)).threads.map((t) => t.id)).toEqual([msg(10)]);
    const all_ = await list(h, LOUNGE, { includeArchived: true });
    expect(all_.threads.map((t) => [t.id, t.archived, t.locked])).toEqual([
      [msg(11), true, true],
      [msg(10), false, false],
    ]);
    // Reopening, and an update that doesn't mention the flags, keep what they should.
    await push(h, thread(msg(11), LOUNGE, { name: 'reopened', archived: false, locked: null }));
    expect(await threadRow(h, msg(11))).toMatchObject({ name: 'reopened', archived: 0, locked: 1 });
    await push(h, thread(msg(11), LOUNGE, { name: null, archived: null, locked: null }));
    expect(await threadRow(h, msg(11))).toMatchObject({ name: 'reopened', archived: 0, locked: 1 });
  });

  it('are kept but hidden when deleted, and their messages are removed like any Discord delete', async () => {
    const { h, agent } = await world();
    const sub = await subscribe(h, agent.id);
    await push(h, thread(msg(10)), human(11, { thread_id: msg(10) }), human(12, { thread_id: msg(10) }));
    await push(h, { kind: 'thread_delete', thread_id: msg(10), parent_id: LOUNGE });
    const row = await threadRow(h, msg(10));
    expect(row!.deleted_at).toBe(h.now().toISOString());
    expect((await list(h, LOUNGE, { includeArchived: true })).threads).toEqual([]);
    expect(await all(h, 'SELECT content, deleted_at, removed_by FROM conversation WHERE thread_id = ?', msg(10))).toEqual([
      { content: null, deleted_at: h.now().toISOString(), removed_by: 'discord' },
      { content: null, deleted_at: h.now().toISOString(), removed_by: 'discord' },
    ]);
    expect(await readPage(h.relay, LOUNGE, { threadId: msg(10) })).toMatchObject({
      messages: [
        { deleted: true, content: null },
        { deleted: true, content: null },
      ],
    });
    const removal = await all<{ payload: string }>(h, "SELECT payload FROM events WHERE type = 'message.bulk_deleted'");
    expect(removal).toHaveLength(1);
    expect(JSON.parse(removal[0]!.payload).data.message_ids).toEqual([msg(11), msg(12)]);
    // The thread, its two messages and their removal reach the subscription.
    expect(await waiting(h, sub)).toEqual(['thread.created', 'message.created', 'message.created', 'message.bulk_deleted']);
    // Messages that arrive in the same batch as the delete go too.
    await push(h, thread(msg(20)), human(21, { thread_id: msg(20) }), { kind: 'thread_delete', thread_id: msg(20), parent_id: LOUNGE });
    expect(await conversation(h, 21)).toMatchObject({ content: null, removed_by: 'discord' });
    // Deleting a thread nobody heard of does nothing.
    await push(h, { kind: 'thread_delete', thread_id: msg(99), parent_id: LOUNGE });
    expect(await threadRow(h, msg(99))).toBeNull();
  });

  it('are archived when a list of active threads leaves them out', async () => {
    const { h } = await world();
    await moreChannels(h);
    await push(h, thread(msg(10)), thread(msg(11)), thread(msg(12), FORUM));
    await push(h, { kind: 'thread_sync', parent_ids: [LOUNGE], active_ids: [msg(10)] });
    expect((await threadRow(h, msg(10)))!.archived).toBe(0);
    expect((await threadRow(h, msg(11)))!.archived).toBe(1);
    // Only the channels named were synced.
    expect((await threadRow(h, msg(12)))!.archived).toBe(0);
    // Without names, every open channel is.
    await push(h, { kind: 'thread_sync', parent_ids: null, active_ids: [msg(10)] });
    expect((await threadRow(h, msg(12)))!.archived).toBe(1);
    expect((await threadRow(h, msg(10)))!.archived).toBe(0);
  });

  it('ignore threads of channels agents can’t use', async () => {
    const { h } = await world();
    await push(h, thread(msg(10), '110000000000000002'));
    expect(await threadRow(h, msg(10))).toBeNull();
  });
});

describe('listing threads', () => {
  it('pages newest first, comparing 18 and 19 digit IDs as numbers', async () => {
    const { h } = await world();
    const ids = ['999999999999999998', '999999999999999999', '1000000000000000001', '1000000000000000000'];
    await push(h, ...ids.map((id) => thread(id)));
    const first = await list(h, LOUNGE, { limit: 3 });
    expect(first.threads.map((t) => t.id)).toEqual(['1000000000000000001', '1000000000000000000', '999999999999999999']);
    expect(first.next_before).toBe('999999999999999999');
    const second = await list(h, LOUNGE, { limit: 3, before: first.next_before! });
    expect(second.threads.map((t) => t.id)).toEqual(['999999999999999998']);
    expect(second.next_before).toBeNull();
  });

  it('keep threads of one channel out of another', async () => {
    const { h } = await world();
    await moreChannels(h);
    await push(h, thread(msg(10)), thread(msg(11), FORUM));
    expect((await list(h, FORUM)).threads.map((t) => t.id)).toEqual([msg(11)]);
  });

  it('are announced once, when new: a rename or deleting an empty thread announces nothing', async () => {
    const { h, agent } = await world();
    const sub = await subscribe(h, agent.id);
    await push(h, thread(msg(10)));
    await push(h, thread(msg(10), LOUNGE, { name: 'renamed' }), { kind: 'thread_delete', thread_id: msg(10), parent_id: LOUNGE });
    expect(await waiting(h, sub)).toEqual(['thread.created']);
  });
});
