import { describe, expect, it } from 'vitest';
import { backfill, normalizeDispatch, seedHistory } from './gateway';
import { MEDIA, NEWS, all, at, moreChannels, msg, push, world } from './intake-fixtures';
import { recordAgentPost } from './services/intake';
import { FORUM, GUILD, LOUNGE } from './testing';

// Reads rely on where a thread’s starter message is filed:
//  - forum and media posts: the starter is in the thread (thread_id is its own ID)
//  - a thread started from a message in a text or announcement channel: the starter stays in the channel (thread_id null)
// Whichever way a message reaches the relay.

type World = Awaited<ReturnType<typeof world>>;
// A bot: intake keeps what bots write as it is, so every starter is stored.
const AUTHOR = { id: '200000000000000001', username: 'luna', bot: true };
const rest = (n: number, channel: string, over: Record<string, unknown> = {}) => ({
  id: msg(n),
  channel_id: channel,
  author: AUTHOR,
  content: `m ${n}`,
  timestamp: at(1, n),
  edited_timestamp: null,
  type: 0,
  ...over,
});

/** Every thread that has a stored starter: where is it filed? */
async function starters(h: World['h']) {
  return all<{ id: string; kind: string; channel_id: string; thread_id: string | null }>(
    h,
    `SELECT CAST(t.id AS TEXT) AS id, ch.type AS kind, c.channel_id, c.thread_id FROM threads t
       JOIN channels ch ON ch.id = t.parent_id JOIN conversation c ON c.message_id = t.id ORDER BY t.id`,
  );
}

function expectFiledRight(rows: Awaited<ReturnType<typeof starters>>, parents: Record<string, string>) {
  expect(rows.length).toBeGreaterThan(0);
  for (const r of rows) {
    expect(r.channel_id).toBe(parents[r.id]);
    expect(r.thread_id).toBe(r.kind === 'forum' || r.kind === 'media' ? r.id : null);
  }
}

const PLACES = [
  { name: 'forum', channel: FORUM, kind: 'forum', threadType: 11, n: 30 },
  { name: 'media', channel: MEDIA, kind: 'media', threadType: 11, n: 40 },
  { name: 'text', channel: LOUNGE, kind: 'text', threadType: 11, n: 50 },
  { name: 'announcement', channel: NEWS, kind: 'announcement', threadType: 10, n: 60 },
] as const;

const threadObject = (id: string, parent: string, type: number) => ({
  id,
  guild_id: GUILD,
  parent_id: parent,
  name: 'a thread',
  type,
  thread_metadata: { archived: false, locked: false },
});
const isForum = (kind: string) => kind === 'forum' || kind === 'media';

describe('where a thread’s starter message is filed', () => {
  it('through the Gateway, whether the thread or the message arrives first', async () => {
    const { h } = await world();
    await moreChannels(h);
    const threads = new Map<string, string>();
    const ctx = { guildId: GUILD, threads };
    const events: unknown[] = [];
    for (const p of PLACES) {
      const id = msg(p.n);
      const thread = normalizeDispatch('THREAD_CREATE', threadObject(id, p.channel, p.threadType), ctx);
      // Forum and media starters are sent inside the thread; the others stay in the channel.
      const starter = normalizeDispatch(
        'MESSAGE_CREATE',
        { id, channel_id: isForum(p.kind) ? id : p.channel, guild_id: GUILD, author: AUTHOR, content: 'starter', timestamp: at(1, p.n), type: 0 },
        ctx,
      );
      // The notice Discord puts inside a text channel’s thread is not a message.
      const notice = isForum(p.kind)
        ? []
        : normalizeDispatch(
            'MESSAGE_CREATE',
            { id: msg(p.n + 1), channel_id: id, guild_id: GUILD, author: AUTHOR, content: '', timestamp: at(1, p.n + 1), type: 21 },
            ctx,
          );
      events.push(...thread, ...starter, ...notice);
    }
    await push(h, ...events);
    expectFiledRight(await starters(h), Object.fromEntries(PLACES.map((p) => [msg(p.n), p.channel])));
    expect((await starters(h)).length).toBe(4);
    // The thread-first order is the one above; now the message first, in a clean relay.
    const w2 = await world();
    await moreChannels(w2.h);
    const ctx2 = { guildId: GUILD, threads: new Map<string, string>() };
    const early = normalizeDispatch(
      'MESSAGE_CREATE',
      { id: msg(30), channel_id: msg(30), guild_id: GUILD, author: AUTHOR, content: 'early', timestamp: at(1, 30), type: 0 },
      ctx2,
    );
    // Without the thread known the message names the thread as its channel, which no open channel owns: the relay drops it (the service looks the thread up first).
    await push(w2.h, ...early);
    expect(await all(w2.h, 'SELECT 1 FROM conversation WHERE message_id = ?', msg(30))).toHaveLength(0);
  });

  it('through REST backfill', async () => {
    const { h } = await world();
    await moreChannels(h);
    await push(h, ...PLACES.map((p) => ({ kind: 'thread_upsert' as const, thread_id: msg(p.n), parent_id: p.channel, name: 'a thread' })));
    const asked: string[] = [];
    h.setDiscord(async (req) => {
      const channel = /\/channels\/(\d+)\/messages$/.exec(new URL(req.url).pathname)![1]!;
      asked.push(channel);
      const place = PLACES.find((p) => (isForum(p.kind) ? msg(p.n) === channel : p.channel === channel));
      if (!place) return Response.json([]);
      // A forum thread’s own history holds its starter; a text channel’s history holds the message the thread was started from.
      return Response.json([rest(place.n, channel, { content: 'starter' })]);
    });
    const from = Object.fromEntries(PLACES.map((p) => [isForum(p.kind) ? msg(p.n) : p.channel, msg(0)]));
    await backfill(h.relay, from, 20);
    expect(asked.sort()).toEqual([LOUNGE, NEWS, msg(30), msg(40)].sort());
    expectFiledRight(await starters(h), Object.fromEntries(PLACES.map((p) => [msg(p.n), p.channel])));
    expect((await starters(h)).length).toBe(4);
  });

  it('through the first look at a new channel', async () => {
    const { h } = await world();
    await moreChannels(h);
    await h.db.prepare("UPDATE channels SET agent_access = 'read_only' WHERE id = ?").bind(LOUNGE).run();
    await push(h, ...PLACES.map((p) => ({ kind: 'thread_upsert' as const, thread_id: msg(p.n), parent_id: p.channel, name: 'a thread' })));
    h.setDiscord(async (req) => {
      const channel = /\/channels\/(\d+)\/messages$/.exec(new URL(req.url).pathname)![1]!;
      const place = PLACES.find((p) => (isForum(p.kind) ? msg(p.n) === channel : p.channel === channel));
      return Response.json(place ? [rest(place.n, channel, { content: 'starter' })] : []);
    });
    await seedHistory(h.relay, 20);
    expectFiledRight(await starters(h), Object.fromEntries(PLACES.map((p) => [msg(p.n), p.channel])));
    expect((await starters(h)).length).toBe(4);
  });

  it('through an agent’s own post, as the posting pipeline records it', async () => {
    const { h, agent } = await world();
    await moreChannels(h);
    await push(h, ...PLACES.map((p) => ({ kind: 'thread_upsert' as const, thread_id: msg(p.n), parent_id: p.channel, name: 'a thread' })));
    for (const p of PLACES) {
      // A new forum post answers with the thread as its channel; a post in a text channel that will get a thread is just a post.
      await recordAgentPost(h.relay, {
        discordMessageId: msg(p.n),
        channelId: p.channel,
        threadId: isForum(p.kind) ? msg(p.n) : null,
        agentId: agent.id,
        displayName: 'Moth-9',
        content: 'starter',
        relayMessageId: 'msg_01JB7Q2M8R',
        createdAt: at(1, p.n),
      });
    }
    expectFiledRight(await starters(h), Object.fromEntries(PLACES.map((p) => [msg(p.n), p.channel])));
    expect((await starters(h)).length).toBe(4);
  });
});
