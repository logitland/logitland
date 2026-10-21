import { describe, expect, it, vi } from 'vitest';
import { recordAgentPost } from './services/intake';
import {
  ANNOUNCE,
  FORUM_ID,
  MEDIA,
  NEW_THREAD,
  THREAD_START,
  WEBHOOK_POST,
  calls,
  json,
  key,
  mod,
  post,
  row,
  say,
  seedThread,
  setTags,
  world,
} from './posting-fixtures';
import { LOUNGE } from './testing';

vi.mock('./services/intake', async (original) => ({ ...(await original<typeof import('./services/intake')>()), recordAgentPost: vi.fn(async () => {}) }));

const THREAD_NAME = 'Weekly sync';
const TAGS = [
  { id: '700000000000000001', name: 'Bug', moderated: false },
  { id: '700000000000000002', name: 'Idea', moderated: false },
  { id: '700000000000000003', name: 'Staff only', moderated: true },
];

describe('starting a thread in a text or announcement channel', () => {
  it.each([
    ['text', LOUNGE],
    ['announcement', ANNOUNCE],
  ])('posts the message and then opens a thread on it in a %s channel', async (_type, channel) => {
    const { h, a } = await world();
    const res = await post(h, a, say('Let us talk about the roadmap here', { thread_name: THREAD_NAME, auto_archive_minutes: 1440 }, channel));
    expect(res.status).toBe(201);
    const msg = await json(res);
    expect(msg).toMatchObject({ status: 'sent', status_reason: null, channel_id: channel });
    // The thread's ID is the starter message's ID, and the agent gets it back to post follow-ups with.
    expect(msg.thread_id).toBe(msg.discord_message_id);

    const [posted] = await calls(h, 'POST', WEBHOOK_POST);
    expect(posted!.body).not.toHaveProperty('thread_name');
    expect(posted!.url.searchParams.has('thread_id')).toBe(false);
    const [started] = await calls(h, 'POST', THREAD_START);
    expect(started!.url.pathname).toBe(`/api/v10/channels/${channel}/messages/${msg.discord_message_id}/threads`);
    expect(started!.body).toEqual({ name: THREAD_NAME, auto_archive_duration: 1440 });
    expect(started!.headers.get('authorization')).toBe('Bot test-bot-token');
    // The starter message stays in the channel, so intake files it there.
    expect(recordAgentPost).toHaveBeenLastCalledWith(h.relay, expect.objectContaining({ channelId: channel, threadId: null }));
  });

  it('leaves the archive time to Discord when none is given', async () => {
    const { h, a } = await world();
    await post(h, a, say('A thread with the default archive time', { thread_name: THREAD_NAME }));
    expect((await calls(h, 'POST', THREAD_START))[0]!.body).toEqual({ name: THREAD_NAME });
  });

  it.each([60, 1440, 4320, 10080])('accepts %i minutes to archive', async (minutes) => {
    const { h, a } = await world();
    expect((await post(h, a, say(`Archive after ${minutes} minutes`, { thread_name: THREAD_NAME, auto_archive_minutes: minutes }))).status).toBe(201);
    expect((await calls(h, 'POST', THREAD_START))[0]!.body.auto_archive_duration).toBe(minutes);
  });

  it('refuses other archive times, and the setting outside a new text-channel thread', async () => {
    const { h, a } = await world();
    expect((await post(h, a, say('Thirty minutes?', { thread_name: THREAD_NAME, auto_archive_minutes: 30 }))).status).toBe(400);
    const noThread = await post(h, a, say('Archive time with no thread', { auto_archive_minutes: 60 }));
    expect(noThread.status).toBe(400);
    expect((await json(noThread)).detail).toMatch(/auto_archive_minutes only applies/);
    const forum = await post(h, a, say('Archive time in a forum', { thread_name: THREAD_NAME, auto_archive_minutes: 60 }, FORUM_ID));
    expect(forum.status).toBe(400);
    expect((await post(h, a, say('Archive time in an existing thread', { thread_id: NEW_THREAD, auto_archive_minutes: 60 }))).status).toBe(400);
    expect(h.discordCalls).toHaveLength(0);
  });

  it('keeps the message and says what to fix when the bot may not create threads (403)', async () => {
    const { h, a } = await world({ discord: { thread: () => Response.json({ message: 'Missing Permissions', code: 50013 }, { status: 403 }) } });
    const res = await post(h, a, say('A thread the bot cannot open', { thread_name: THREAD_NAME }));
    expect(res.status).toBe(201);
    const msg = await json(res);
    expect(msg).toMatchObject({
      status: 'sent',
      thread_id: null,
      status_reason: 'Posted, but the thread couldn’t be started: the bot needs Create Public Threads here.',
    });
    expect(msg.discord_message_id).toMatch(/^\d+$/);
    expect(msg.status_reason).not.toContain('Missing Permissions');
    const fresh = await json(await h.call('GET', `/v1/messages/${msg.id}`, undefined, h.as(a.token)));
    expect(fresh).toMatchObject({ status: 'sent', thread_id: null });
    expect(fresh.status_reason).toContain('Create Public Threads');
  });

  it.each([
    [
      'a rate limit',
      () => new Response(JSON.stringify({ retry_after: 2 }), { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '2' } }),
    ],
    ['an error from Discord', () => new Response('boom', { status: 500 })],
    ['a thread that already exists', () => Response.json({ message: 'A thread has already been created for this message', code: 160004 }, { status: 400 })],
  ])('keeps the message when thread creation fails with %s', async (_name, thread) => {
    const { h, a } = await world({ discord: { thread } });
    const msg = await json(await post(h, a, say('Another thread that fails', { thread_name: THREAD_NAME })));
    expect(msg).toMatchObject({
      status: 'sent',
      thread_id: null,
      status_reason: 'Posted, but the thread couldn’t be started. You can start one from the message in Discord.',
    });
  });

  it('keeps the message when the thread call never reaches Discord', async () => {
    const { h, a } = await world({
      discord: {
        thread: () => {
          throw new TypeError('connection reset');
        },
      },
    });
    const msg = await json(await post(h, a, say('A thread over a bad connection', { thread_name: THREAD_NAME })));
    expect(msg).toMatchObject({ status: 'sent', thread_id: null });
    expect(msg.status_reason).toMatch(/couldn’t be started/);
  });

  it('does not touch Discord for threads when the post itself fails', async () => {
    const { h, a } = await world();
    h.setDiscord(() => Response.json({ message: 'nope' }, { status: 400 }));
    const msg = await json(await post(h, a, say('Refused outright', { thread_name: THREAD_NAME })));
    expect(msg.status).toBe('failed');
    expect(await calls(h, 'POST', THREAD_START)).toHaveLength(0);
  });
});

describe('starting a post in a forum or media channel', () => {
  it.each([
    ['forum', FORUM_ID],
    ['media', MEDIA],
  ])('sends the title with the post to a %s channel and keeps the thread Discord made', async (_type, channel) => {
    const { h, a } = await world();
    const res = await post(h, a, say('The first message of the post', { thread_name: THREAD_NAME }, channel));
    expect(res.status).toBe(201);
    const msg = await json(res);
    expect(msg).toMatchObject({ status: 'sent', thread_id: NEW_THREAD, channel_id: channel });
    const [posted] = await calls(h, 'POST', WEBHOOK_POST);
    expect(posted!.body).toMatchObject({ thread_name: THREAD_NAME, content: 'The first message of the post' });
    expect(posted!.body).not.toHaveProperty('applied_tags');
    // The webhook starts the post, so the bot is not asked to.
    expect(await calls(h, 'POST', THREAD_START)).toHaveLength(0);
    expect(recordAgentPost).toHaveBeenLastCalledWith(h.relay, expect.objectContaining({ channelId: channel, threadId: NEW_THREAD }));
  });

  it('requires a thread_id or thread_name in forum and media channels', async () => {
    const { h, a } = await world();
    for (const channel of [FORUM_ID, MEDIA]) {
      const res = await post(h, a, say('No thread given', {}, channel));
      expect(res.status).toBe(400);
      expect((await json(res)).detail).toMatch(/thread_id to reply in one, or thread_name to start one/);
    }
  });

  it('replies inside a forum post with thread_id', async () => {
    const { h, a } = await world();
    expect((await post(h, a, say('A reply', { thread_id: NEW_THREAD }, FORUM_ID))).status).toBe(201);
    const [posted] = await calls(h, 'POST', WEBHOOK_POST);
    expect(posted!.url.searchParams.get('thread_id')).toBe(NEW_THREAD);
    expect(posted!.body).not.toHaveProperty('thread_name');
  });
});

describe('forum tags', () => {
  it('applies up to five of the channel’s tags to a new post', async () => {
    const { h, a } = await world();
    await setTags(h, FORUM_ID, TAGS);
    const res = await post(h, a, say('Tagged post', { thread_name: THREAD_NAME, tag_ids: [TAGS[0]!.id, TAGS[1]!.id] }, FORUM_ID));
    expect(res.status).toBe(201);
    expect((await calls(h, 'POST', WEBHOOK_POST))[0]!.body.applied_tags).toEqual([TAGS[0]!.id, TAGS[1]!.id]);
    expect(JSON.parse((await row(h, (await json(res)).id))!.tag_ids)).toEqual([TAGS[0]!.id, TAGS[1]!.id]);
  });

  it('counts a repeated tag once', async () => {
    const { h, a } = await world();
    await setTags(h, FORUM_ID, TAGS);
    await post(h, a, say('Tagged twice', { thread_name: THREAD_NAME, tag_ids: [TAGS[0]!.id, TAGS[0]!.id] }, FORUM_ID));
    expect((await calls(h, 'POST', WEBHOOK_POST))[0]!.body.applied_tags).toEqual([TAGS[0]!.id]);
  });

  it('works in media channels too', async () => {
    const { h, a } = await world();
    await setTags(h, MEDIA, TAGS);
    expect((await post(h, a, say('Tagged media post', { thread_name: THREAD_NAME, tag_ids: [TAGS[1]!.id] }, MEDIA))).status).toBe(201);
  });

  it('refuses a tag the channel does not have, and lists the ones it does', async () => {
    const { h, a } = await world();
    await setTags(h, FORUM_ID, TAGS);
    const res = await post(h, a, say('Unknown tag', { thread_name: THREAD_NAME, tag_ids: ['700000000000000099'] }, FORUM_ID));
    expect(res.status).toBe(400);
    const detail = (await json(res)).detail as string;
    expect(detail).toContain('700000000000000099');
    expect(detail).toContain('Bug (700000000000000001)');
    expect(h.discordCalls).toHaveLength(0);
  });

  it('refuses a tag only moderators may apply', async () => {
    const { h, a } = await world();
    await setTags(h, FORUM_ID, TAGS);
    const res = await post(h, a, say('Moderated tag', { thread_name: THREAD_NAME, tag_ids: [TAGS[0]!.id, TAGS[2]!.id] }, FORUM_ID));
    expect(res.status).toBe(403);
    expect((await json(res)).detail).toMatch(/“Staff only” can only be applied by moderators/);
    expect(h.discordCalls).toHaveLength(0);
  });

  it('says so when the channel has no tags', async () => {
    const { h, a } = await world();
    const res = await post(h, a, say('Tag in an untagged forum', { thread_name: THREAD_NAME, tag_ids: [TAGS[0]!.id] }, FORUM_ID));
    expect(res.status).toBe(400);
    expect((await json(res)).detail).toMatch(/It has no tags/);
  });

  it('allows at most five tags and at least one', async () => {
    const { h, a } = await world();
    const many = Array.from({ length: 6 }, (_, i) => `70000000000000010${i}`);
    expect((await post(h, a, say('Six tags', { thread_name: THREAD_NAME, tag_ids: many }, FORUM_ID))).status).toBe(400);
    expect((await post(h, a, say('No tags', { thread_name: THREAD_NAME, tag_ids: [] }, FORUM_ID))).status).toBe(400);
  });

  it('applies only to a new forum or media post', async () => {
    const { h, a } = await world();
    await setTags(h, FORUM_ID, TAGS);
    const reply = await post(h, a, say('Tags on a reply', { thread_id: NEW_THREAD, tag_ids: [TAGS[0]!.id] }, FORUM_ID));
    expect(reply.status).toBe(400);
    expect((await json(reply)).detail).toMatch(/tag_ids only applies when you start a post/);
    const text = await post(h, a, say('Tags in a text channel', { thread_name: THREAD_NAME, tag_ids: [TAGS[0]!.id] }));
    expect(text.status).toBe(400);
    expect(h.discordCalls).toHaveLength(0);
  });

  it('reports a forum that wants a tag in words the agent can act on', async () => {
    const { h, a } = await world();
    h.setDiscord(() => Response.json({ message: 'Tags required', code: 40067 }, { status: 400 }));
    const msg = await json(await post(h, a, say('Forgot the tag', { thread_name: THREAD_NAME }, FORUM_ID)));
    expect(msg.status).toBe('failed');
    expect(msg.status_reason).toMatch(/send tag_ids/);
    expect(msg.status_reason).not.toContain('Tags required');
  });
});

describe('who may start threads and where: the access rule', () => {
  it('lets plain post access reply in a thread, start a thread, or post at top level of a text channel', async () => {
    const { h, a } = await world({ access: 'post' });
    expect((await post(h, a, say('Top level message'))).status).toBe(201);
    expect((await post(h, a, say('Starting a thread', { thread_name: THREAD_NAME }))).status).toBe(201);
    expect((await post(h, a, say('Replying in a thread', { thread_id: NEW_THREAD }))).status).toBe(201);
    expect((await post(h, a, say('Starting a forum post', { thread_name: THREAD_NAME }, FORUM_ID))).status).toBe(201);
    expect((await post(h, a, say('Replying in a forum post', { thread_id: NEW_THREAD }, FORUM_ID))).status).toBe(201);
  });

  it('still needs a thread for forum and media posts under plain post access', async () => {
    const { h, a } = await world({ access: 'post' });
    expect((await post(h, a, say('Forum without a thread', {}, FORUM_ID))).status).toBe(400);
    expect((await post(h, a, say('Media without a thread', {}, MEDIA))).status).toBe(400);
  });

  it.each([
    ['text', LOUNGE],
    ['announcement', ANNOUNCE],
    ['forum', FORUM_ID],
    ['media', MEDIA],
  ])('makes post_new_threads mean every post is in a thread, in a %s channel', async (_type, channel) => {
    const { h, a } = await world({ access: 'post_new_threads' });
    const bare = await post(h, a, say('Not in a thread', {}, channel));
    expect(bare.status).toBe(400);
    expect((await json(bare)).detail).toMatch(/Every post in this channel goes in a thread|go in a thread/);
    expect((await post(h, a, say('Starting a thread', { thread_name: THREAD_NAME }, channel))).status).toBe(201);
    expect((await post(h, a, say('Replying in a thread', { thread_id: NEW_THREAD }, channel))).status).toBe(201);
  });

  it('refuses both thread_id and thread_name together', async () => {
    const { h, a } = await world();
    expect((await post(h, a, say('Both', { thread_id: NEW_THREAD, thread_name: THREAD_NAME }))).status).toBe(400);
  });

  it('still keeps read-only channels closed to threads', async () => {
    const { h, a } = await world({ access: 'read_only' });
    expect((await post(h, a, say('Starting a thread', { thread_name: THREAD_NAME }))).status).toBe(403);
    expect(h.discordCalls).toHaveLength(0);
  });

  it('refuses a thread that belongs to another channel, a deleted one, and a locked one', async () => {
    const { h, a } = await world();
    await seedThread(h, '120000000000000101', FORUM_ID);
    await seedThread(h, '120000000000000102', LOUNGE, { deleted: true });
    await seedThread(h, '120000000000000103', LOUNGE, { locked: true });
    await seedThread(h, '120000000000000104', LOUNGE);
    const elsewhere = await post(h, a, say('Wrong place', { thread_id: '120000000000000101' }));
    expect(elsewhere.status).toBe(400);
    expect((await json(elsewhere)).detail).toMatch(/isn’t in this channel/);
    const deleted = await post(h, a, say('Gone', { thread_id: '120000000000000102' }));
    expect(deleted.status).toBe(400);
    expect((await json(deleted)).detail).toMatch(/was deleted/);
    const locked = await post(h, a, say('Locked', { thread_id: '120000000000000103' }));
    expect(locked.status).toBe(403);
    expect((await json(locked)).detail).toMatch(/locked/);
    expect((await post(h, a, say('Fine', { thread_id: '120000000000000104' }))).status).toBe(201);
  });

  it('says the thread is gone when Discord has already lost it', async () => {
    const { h, a } = await world();
    h.setDiscord(() => Response.json({ message: 'Unknown Channel', code: 10003 }, { status: 404 }));
    const msg = await json(await post(h, a, say('Into the void', { thread_id: NEW_THREAD })));
    expect(msg.status).toBe('failed');
    expect(msg.status_reason).toMatch(/thread no longer exists/);
  });
});

describe('thread names are moderated', () => {
  it('through the fixed rules, in every channel type', async () => {
    const { h, a } = await world();
    for (const channel of [LOUNGE, ANNOUNCE, FORUM_ID, MEDIA]) {
      const msg = await json(await post(h, a, say(`Fine text for ${channel}`, { thread_name: 'join discord.gg/abc123' }, channel)));
      expect(msg).toMatchObject({ status: 'blocked', policy_code: 'invite_link', thread_id: null });
    }
    expect(h.discordCalls).toHaveLength(0);
  });

  it('holds a thread name with an email address, and drops the name text if it holds a secret', async () => {
    const { h, a } = await world();
    const held = await json(await post(h, a, say('Fine text here', { thread_name: 'write to me@example.com' })));
    expect(held).toMatchObject({ status: 'held', policy_code: 'personal_info' });
    const leaked = await json(await post(h, a, say('More fine text', { thread_name: `token lat_${'K7QMXV2D'.repeat(6)}` })));
    expect(leaked).toMatchObject({ status: 'blocked', policy_code: 'secret_leak' });
    const stored = await row(h, leaked.id);
    expect(stored).toMatchObject({ thread_name: null, content: null });
  });

  it('through the classifier, in the same question as the text', async () => {
    const moderator = mod((req) => (req.thread_name?.includes('hateful') ? { verdict: 'block', policy_code: 'hate' } : { verdict: 'pass' }));
    const { h, a } = await world({ moderator });
    const msg = await json(await post(h, a, say('Perfectly polite text', { thread_name: 'A hateful title' })));
    expect(msg).toMatchObject({ status: 'blocked', policy_code: 'hate' });
    expect(moderator.calls.map((c) => [c.kind, c.content, c.thread_name])).toEqual([['message', 'Perfectly polite text', 'A hateful title']]);
    expect(h.discordCalls).toHaveLength(0);
  });
});

describe('repeating a thread request after the world has moved on', () => {
  it('returns the message already sent, even if the thread was locked or a tag became moderated since', async () => {
    const { h, a } = await world();
    await seedThread(h, NEW_THREAD, LOUNGE);
    await setTags(h, FORUM_ID, TAGS);
    const k1 = key();
    const inThread = await json(await post(h, a, say('Posted in a thread.', { thread_id: NEW_THREAD }), k1));
    const k2 = key();
    const tagged = await json(await post(h, a, say('Posted with a tag.', { thread_name: THREAD_NAME, tag_ids: [TAGS[0]!.id] }, FORUM_ID), k2));
    await h.db.prepare('UPDATE threads SET locked = 1 WHERE id = ?').bind(NEW_THREAD).run();
    await setTags(h, FORUM_ID, [{ ...TAGS[0]!, moderated: true }]);
    const again = await post(h, a, say('Posted in a thread.', { thread_id: NEW_THREAD }), k1);
    expect(again.status).toBe(201);
    expect((await json(again)).id).toBe(inThread.id);
    const againTagged = await post(h, a, say('Posted with a tag.', { thread_name: THREAD_NAME, tag_ids: [TAGS[0]!.id] }, FORUM_ID), k2);
    expect((await json(againTagged)).id).toBe(tagged.id);
    // New requests meet the world as it is.
    expect((await post(h, a, say('Another post in the locked thread.', { thread_id: NEW_THREAD }))).status).toBe(403);
  });
});
