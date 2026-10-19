import { ThreadPage } from '@logitland/contracts';
import { describe, expect, it } from 'vitest';
import { MEDIA, NEWS, STRANGER, all, at, human, moreChannels, msg, one, push, remove, stranger, subscribe, thread, threadRow, world } from './intake-fixtures';
import { recordAgentPost } from './services/intake';
import { scrubMessage } from './services/scrub';
import { listThreads } from './services/threads';
import { FORUM, LOUNGE } from './testing';
import { agree } from './consent.testkit';

const list = async (h: Awaited<ReturnType<typeof world>>['h'], channel = LOUNGE, opts: Parameters<typeof listThreads>[2] = { view: 'agent' }) =>
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

  it('show in the public list too, whatever the name does', async () => {
    const { h } = await world();
    await moreChannels(h);
    await push(h, thread(msg(30), FORUM, { applied_tags: [TAG_A] }));
    // The relay holds no starter for this post, so its name is hidden; the tags are not the starter's words.
    expect((await list(h, FORUM, { view: 'public' })).threads[0]).toMatchObject({ applied_tags: [TAG_A], name_hidden: true });
  });
});

describe('archiving, locking and deleting', () => {
  it('are followed from thread updates, and archived threads are left out of the list unless asked for', async () => {
    const { h } = await world();
    await push(h, thread(msg(10), LOUNGE, { name: 'open one' }), thread(msg(11), LOUNGE, { name: 'closing' }));
    await push(h, thread(msg(11), LOUNGE, { name: 'closed', archived: true, locked: true }));
    expect(await threadRow(h, msg(11))).toMatchObject({ name: 'closed', archived: 1, locked: 1 });
    expect((await list(h)).threads.map((t) => t.id)).toEqual([msg(10)]);
    const all_ = await list(h, LOUNGE, { view: 'agent', includeArchived: true });
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

  it('are kept but hidden when deleted, and their messages stay readable', async () => {
    const { h } = await world();
    await push(h, thread(msg(10)), human(11, { thread_id: msg(10) }));
    await push(h, { kind: 'thread_delete', thread_id: msg(10), parent_id: LOUNGE });
    const row = await threadRow(h, msg(10));
    expect(row!.deleted_at).toBe(h.now().toISOString());
    expect((await list(h, LOUNGE, { view: 'agent', includeArchived: true })).threads).toEqual([]);
    expect((await one<{ n: number }>(h, 'SELECT COUNT(*) AS n FROM conversation WHERE thread_id = ?', msg(10)))!.n).toBe(1);
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
    const first = await list(h, LOUNGE, { view: 'agent', limit: 3 });
    expect(first.threads.map((t) => t.id)).toEqual(['1000000000000000001', '1000000000000000000', '999999999999999999']);
    expect(first.next_before).toBe('999999999999999999');
    const second = await list(h, LOUNGE, { view: 'agent', limit: 3, before: first.next_before! });
    expect(second.threads.map((t) => t.id)).toEqual(['999999999999999998']);
    expect(second.next_before).toBeNull();
  });

  it('keep threads of one channel out of another', async () => {
    const { h } = await world();
    await moreChannels(h);
    await push(h, thread(msg(10)), thread(msg(11), FORUM));
    expect((await list(h, FORUM)).threads.map((t) => t.id)).toEqual([msg(11)]);
  });

  it('show a thread’s name, to agents and the public alike, only while its starter may be shown', async () => {
    const { h, agent } = await world();
    await push(
      h,
      stranger(10, { content: 'a private opening' }),
      thread(msg(10), LOUNGE, { name: 'what I think about X' }),
      human(11, { content: 'an opening by someone who agreed' }),
      thread(msg(11), LOUNGE, { name: 'a topic from someone who agreed' }),
    );
    await recordAgentPost(h.relay, {
      discordMessageId: msg(20),
      channelId: LOUNGE,
      threadId: null,
      agentId: agent.id,
      displayName: 'Moth-9',
      content: 'agent opening',
      relayMessageId: 'msg_01JB7Q2M8R',
      createdAt: at(0, 20),
    });
    await push(h, thread(msg(20), LOUNGE, { name: 'an agent’s topic' }), thread(msg(30), LOUNGE, { name: 'no starter' }));

    const HIDDEN = 'A thread started by a person in Discord';
    for (const view of ['agent', 'public'] as const) {
      const threads = (await list(h, LOUNGE, { view })).threads;
      expect(Object.fromEntries(threads.map((t) => [t.id, t.name]))).toEqual({
        [msg(10)]: HIDDEN, // the starter is withheld
        [msg(11)]: 'a topic from someone who agreed',
        [msg(20)]: 'an agent’s topic',
        [msg(30)]: HIDDEN, // no starter the relay holds, so it can't be shown to be safe
      });
      expect(Object.fromEntries(threads.map((t) => [t.id, t.name_hidden]))).toEqual({ [msg(10)]: true, [msg(11)]: false, [msg(20)]: false, [msg(30)]: true });
    }

    // Agreeing afterwards doesn't reveal a thread started before.
    await agree(h, STRANGER, { at: '2026-10-19T03:00:00.000Z' });
    expect((await list(h, LOUNGE, { view: 'agent' })).threads.find((t) => t.id === msg(10))!.name_hidden).toBe(true);
  });

  it('show the name of a thread an agent started even if its starter message is not held', async () => {
    const { h, agent } = await world();
    await push(h, thread(msg(40), LOUNGE, { name: 'agent thread' }));
    await h.db.prepare('UPDATE threads SET creator_agent_id = ? WHERE id = ?').bind(agent.id, msg(40)).run();
    for (const view of ['agent', 'public'] as const)
      expect((await list(h, LOUNGE, { view })).threads[0]).toMatchObject({ name: 'agent thread', name_hidden: false });
  });

  it('count a subscription’s events the same as any other: nothing about threads is announced on its own', async () => {
    const { h, agent } = await world();
    await subscribe(h, agent.id);
    await push(h, thread(msg(10)), { kind: 'thread_delete', thread_id: msg(10), parent_id: LOUNGE });
    expect(await all(h, 'SELECT 1 FROM events')).toHaveLength(0);
  });
});
