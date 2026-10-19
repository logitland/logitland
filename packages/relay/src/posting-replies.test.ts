import { describe, expect, it, vi } from 'vitest';
import { sha256 } from './crypto';
import { recordAgentPost } from './services/intake';
import { normalise } from './services/moderation/rows';
import { FORUM_ID, NEW_THREAD, WEBHOOK_POST, calls, converse, filler, json, key, mod, post, row, say, seedThread, world } from './posting-fixtures';
import { GUILD, LOUNGE } from './testing';
import { agree } from './consent.testkit';

vi.mock('./services/intake', async (original) => ({ ...(await original<typeof import('./services/intake')>()), recordAgentPost: vi.fn(async () => {}) }));

const line = (name: string, channel: string, message: string) => `-# ↪ Replying to **${name}** · https://discord.com/channels/${GUILD}/${channel}/${message}`;
const sentContent = async (h: Parameters<typeof calls>[0]) => (await calls(h, 'POST', WEBHOOK_POST)).at(-1)!.body.content as string;

describe('replying to a message', () => {
  it('puts a pointer line above the text, in Discord’s small subtext', async () => {
    const { h, a } = await world();
    const target = await converse(h, { author: 'agent', name: 'Orrery' });
    const res = await post(h, a, say('Good point, here is more.', { reply_to: target }));
    expect(res.status).toBe(201);
    const msg = await json(res);
    expect(msg.reply_to).toBe(target);
    expect(await sentContent(h)).toBe(`${line('Orrery', LOUNGE, target)}\nGood point, here is more.`);
    expect(await sentContent(h)).toMatch(/^-# /);
  });

  it('stores the reply and the line, and tells intake what Discord shows, with the target', async () => {
    const { h, a } = await world();
    const target = await converse(h, { author: 'agent', name: 'Orrery' });
    const msg = await json(await post(h, a, say('Replying now.', { reply_to: target })));
    const stored = await row(h, msg.id);
    expect(stored).toMatchObject({ reply_to: target, reply_prefix: line('Orrery', LOUNGE, target), content: 'Replying now.' });
    expect(recordAgentPost).toHaveBeenLastCalledWith(
      h.relay,
      // Intake stores what Discord shows (reply line included), so it matches the Gateway's copy whichever arrives first.
      expect.objectContaining({ replyTo: target, content: `${line('Orrery', LOUNGE, target)}\nReplying now.`, discordMessageId: msg.discord_message_id }),
    );
    const fetched = await json(await h.call('GET', `/v1/messages/${msg.id}`, undefined, h.as(a.key)));
    expect(fetched.reply_to).toBe(target);
  });

  it('hashes what Discord shows, so intake can match the Gateway’s copy', async () => {
    const { h, a } = await world();
    const target = await converse(h, { author: 'agent', name: 'Orrery' });
    const msg = await json(await post(h, a, say('Hash me.', { reply_to: target })));
    expect((await row(h, msg.id))!.content_hash).toBe(await sha256(normalise(`${line('Orrery', LOUNGE, target)}\nHash me.`)));
  });

  it('links to the thread when replying inside one', async () => {
    const { h, a } = await world();
    await seedThread(h, NEW_THREAD, LOUNGE);
    const target = await converse(h, { author: 'agent', name: 'Orrery', thread: NEW_THREAD });
    expect((await post(h, a, say('In the thread.', { reply_to: target, thread_id: NEW_THREAD }))).status).toBe(201);
    expect(await sentContent(h)).toBe(`${line('Orrery', NEW_THREAD, target)}\nIn the thread.`);
    expect((await calls(h, 'POST', WEBHOOK_POST))[0]!.url.searchParams.get('thread_id')).toBe(NEW_THREAD);
  });

  it('works in a forum post', async () => {
    const { h, a } = await world();
    const target = await converse(h, { author: 'agent', name: 'Orrery', thread: NEW_THREAD, channel: FORUM_ID });
    expect((await post(h, a, say('A reply in the post.', { reply_to: target, thread_id: NEW_THREAD }, FORUM_ID))).status).toBe(201);
    expect(await sentContent(h)).toBe(`${line('Orrery', NEW_THREAD, target)}\nA reply in the post.`);
  });

  it('replies to a bot or webhook message by its name', async () => {
    const { h, a } = await world();
    const target = await converse(h, { author: 'bot', name: 'Helper Bot' });
    await post(h, a, say('Thanks, bot.', { reply_to: target }));
    expect(await sentContent(h)).toContain('Replying to **Helper Bot**');
  });

  it('can be a poll’s companion, with a reply line and no text', async () => {
    const { h, a } = await world();
    const target = await converse(h, { author: 'agent', name: 'Orrery' });
    const res = await post(h, a, { channel_id: LOUNGE, reply_to: target, poll: { question: 'Which one?', answers: ['A', 'B'] } });
    expect(res.status).toBe(201);
    expect((await calls(h, 'POST', WEBHOOK_POST))[0]!.body.content).toBe(line('Orrery', LOUNGE, target));
  });
});

describe('who is named in the reply line', () => {
  it('shows a person who agreed to the mirror, by name', async () => {
    const { h, a } = await world();
    await agree(h, '700000000000000001', { guild: GUILD, at: h.now().toISOString() });
    const target = await converse(h, { author: 'human', name: 'Ann', userId: '700000000000000001' });
    await post(h, a, say('Hello Ann.', { reply_to: target }));
    expect(await sentContent(h)).toContain('Replying to **Ann**');
  });

  it('says only “a person” for someone who has not agreed, or who left, since the line lands on the public mirror', async () => {
    const { h, a } = await world();
    const stranger = await converse(h, { author: 'human', name: 'Secret Sam', userId: '700000000000000002' });
    await post(h, a, say('Hello stranger.', { reply_to: stranger }));
    expect(await sentContent(h)).toContain('Replying to **a person**');
    expect(await sentContent(h)).not.toContain('Secret Sam');

    await agree(h, '700000000000000003', { guild: GUILD, at: h.now().toISOString(), revokedAt: h.now().toISOString() });
    const left = await converse(h, { author: 'human', name: 'Leaver Lee', userId: '700000000000000003' });
    await post(h, a, say('Hello again.', { reply_to: left }));
    expect(await sentContent(h)).toContain('Replying to **a person**');
  });

  it('says only “a person” when the person agreed after writing the message being answered, or the relay withheld it', async () => {
    const { h, a } = await world();
    await agree(h, '700000000000000004', { guild: GUILD, at: new Date(h.now().getTime() + 60_000).toISOString() });
    const early = await converse(h, { author: 'human', name: 'Early Ed', userId: '700000000000000004' });
    await post(h, a, say('Hello Ed.', { reply_to: early }));
    expect(await sentContent(h)).toContain('Replying to **a person**');
    expect(await sentContent(h)).not.toContain('Early Ed');

    await agree(h, '700000000000000005', { guild: GUILD, at: h.now().toISOString() });
    const withheld = await converse(h, { author: 'human', name: 'A person in Discord', userId: null, content: '' });
    await h.db.prepare('UPDATE conversation SET withheld = 1 WHERE message_id = ?').bind(withheld).run();
    await post(h, a, say('Hello you.', { reply_to: withheld }));
    expect(await sentContent(h)).toContain('Replying to **a person**');
  });

  it('strips markdown and mentions from a name so it cannot break out of the line', async () => {
    const { h, a } = await world();
    const target = await converse(h, { author: 'agent', name: '**evil** [click](https://x.example) @everyone `code` _under_' });
    await post(h, a, say('Replying to a creative name.', { reply_to: target }));
    const content = await sentContent(h);
    const name = /Replying to \*\*(.*)\*\* ·/.exec(content)![1]!;
    expect(name).not.toMatch(/[*_`[\]()@<>]/);
    expect(name.length).toBeLessThanOrEqual(32);
    expect(content.split('\n')).toHaveLength(2);
  });

  it('falls back to “a person” when nothing is left of a name', async () => {
    const { h, a } = await world();
    const target = await converse(h, { author: 'agent', name: '***' });
    await post(h, a, say('Replying to nobody in particular.', { reply_to: target }));
    expect(await sentContent(h)).toContain('Replying to **a person**');
  });

  it("keeps plain names: letters, digits, spaces and - _ . '", async () => {
    const { h, a } = await world();
    for (const name of ['Orrery', 'Moth-9', 'cool_bot', 'Dr. Who', 'O’Brien', 'Zoë Ångström', '日本語の名前']) {
      const target = await converse(h, { author: 'agent', name });
      await post(h, a, say(`Hello ${name}.`, { reply_to: target }));
      const expected = name.replace(/[^\p{L}\p{N} _.'-]/gu, '');
      expect(await sentContent(h)).toContain(`Replying to **${expected || 'a person'}**`);
    }
  });

  it('puts nothing in the line that the fixed rules would refuse in the agent’s own text: invites, links, addresses, hidden characters', async () => {
    const { h, a } = await world();
    for (const name of [
      'free nitro discord.gg/xyz',
      'join discord . gg / abc',
      'claim.example.com',
      'visit bit.ly/free',
      'mail me me@example.com',
      'call +1 415 555 0100',
      'Zero​Width',
      'luna.dev',
    ]) {
      const target = await converse(h, { author: 'bot', name });
      await post(h, a, say('Replying to a hostile name.', { reply_to: target }));
      const content = await sentContent(h);
      expect(content, name).toContain('Replying to **a person**');
      expect(content, name).not.toMatch(/discord\.gg|nitro|bit\.ly|example\.com|555|luna\.dev/i);
    }
  });
});

describe('what reply_to may point at', () => {
  it('must be a message the relay knows in this channel', async () => {
    const { h, a } = await world();
    const res = await post(h, a, say('Replying to nothing.', { reply_to: '899999999999999999' }));
    expect(res.status).toBe(400);
    expect((await json(res)).detail).toMatch(/reply_to must be a message that still exists in that channel/);
    expect(h.discordCalls).toHaveLength(0);
    expect((await h.db.prepare('SELECT COUNT(*) AS n FROM relay_messages').first<{ n: number }>())!.n).toBe(0);
  });

  it('must not be deleted', async () => {
    const { h, a } = await world();
    const target = await converse(h, { author: 'agent', name: 'Orrery', deleted: true });
    expect((await post(h, a, say('Replying to a ghost.', { reply_to: target }))).status).toBe(400);
  });

  it('must be in the same channel', async () => {
    const { h, a } = await world();
    const elsewhere = await converse(h, { author: 'agent', name: 'Orrery', channel: FORUM_ID });
    expect((await post(h, a, say('Wrong channel.', { reply_to: elsewhere }))).status).toBe(400);
  });

  it('must be in the same thread when thread_id is given, and not in a thread otherwise', async () => {
    const { h, a } = await world();
    await seedThread(h, NEW_THREAD, LOUNGE);
    const inChannel = await converse(h, { author: 'agent', name: 'Orrery' });
    const inThread = await converse(h, { author: 'agent', name: 'Orrery', thread: NEW_THREAD });
    const other = await seedThread(h, '120000000000000050', LOUNGE).then(() => converse(h, { author: 'agent', name: 'Orrery', thread: '120000000000000050' }));
    const wrongPlace = await post(h, a, say('Channel message, thread post.', { reply_to: inChannel, thread_id: NEW_THREAD }));
    expect(wrongPlace.status).toBe(400);
    expect((await json(wrongPlace)).detail).toMatch(/in that thread/);
    const wrongThread = await post(h, a, say('Other thread message.', { reply_to: other, thread_id: NEW_THREAD }));
    expect(wrongThread.status).toBe(400);
    const fromChannel = await post(h, a, say('Thread message, channel post.', { reply_to: inThread }));
    expect(fromChannel.status).toBe(400);
    expect((await json(fromChannel)).detail).toMatch(/not inside a thread/);
    expect((await post(h, a, say('Right place.', { reply_to: inThread, thread_id: NEW_THREAD }))).status).toBe(201);
  });

  it('cannot go with a brand-new forum post', async () => {
    const { h, a } = await world();
    const target = await converse(h, { author: 'agent', name: 'Orrery', thread: NEW_THREAD, channel: FORUM_ID });
    const res = await post(h, a, say('New post replying.', { reply_to: target, thread_name: 'Title' }, FORUM_ID));
    expect(res.status).toBe(400);
    expect((await json(res)).detail).toMatch(/new forum or media post can’t be a reply/);
  });

  it('can go with a new thread in a text channel, replying to a message in the channel', async () => {
    const { h, a } = await world();
    const target = await converse(h, { author: 'agent', name: 'Orrery' });
    expect((await post(h, a, say('Starting a thread in reply.', { reply_to: target, thread_name: 'Follow-up' }))).status).toBe(201);
  });

  it('must be a Discord message ID', async () => {
    const { h, a } = await world();
    expect((await post(h, a, say('Bad ID.', { reply_to: 'msg_ABCDEFGHJK' }))).status).toBe(400);
  });
});

describe('the reply line and the length limit', () => {
  const prefixLength = (target: string) => line('Orrery', LOUNGE, target).length;

  it('counts toward Discord’s 2,000 characters, and fits exactly at the limit', async () => {
    const { h, a } = await world();
    const target = await converse(h, { author: 'agent', name: 'Orrery' });
    const room = 2000 - prefixLength(target) - 1;
    const res = await post(h, a, say(filler(room), { reply_to: target }));
    expect(res.status).toBe(201);
    expect((await sentContent(h)).length).toBe(2000);
  });

  it('says how many characters to cut when it does not fit', async () => {
    const { h, a } = await world();
    const target = await converse(h, { author: 'agent', name: 'Orrery' });
    const room = 2000 - prefixLength(target) - 1;
    const one = await post(h, a, say(filler(room + 1), { reply_to: target }));
    expect(one.status).toBe(400);
    expect((await json(one)).detail).toMatch(new RegExp(`at most ${room}\\. Cut 1 characters\\.`));
    const many = await post(h, a, say(filler(2000), { reply_to: target }));
    expect((await json(many)).detail).toMatch(new RegExp(`Cut ${2000 - room} characters`));
    expect(h.discordCalls).toHaveLength(0);
  });

  it('does not touch plain messages, which may use all 2,000 characters', async () => {
    const { h, a } = await world();
    expect((await post(h, a, say(filler(2000)))).status).toBe(201);
  });
});

describe('replies and idempotency', () => {
  it('treat a different reply_to under the same key as a different message', async () => {
    const { h, a } = await world();
    const one = await converse(h, { author: 'agent', name: 'Orrery' });
    const two = await converse(h, { author: 'agent', name: 'Orrery' });
    const k = key();
    expect((await post(h, a, say('Same text.', { reply_to: one }), k)).status).toBe(201);
    expect((await post(h, a, say('Same text.', { reply_to: one }), k)).status).toBe(201);
    const conflict = await post(h, a, say('Same text.', { reply_to: two }), k);
    expect(conflict.status).toBe(409);
    expect(await calls(h, 'POST', WEBHOOK_POST)).toHaveLength(1);
  });

  it('are moderated by what the agent wrote, not by the line the relay adds', async () => {
    const moderator = mod();
    const { h, a } = await world({ moderator });
    const target = await converse(h, { author: 'agent', name: 'Orrery' });
    await post(h, a, say('Plain reply text.', { reply_to: target }));
    expect(moderator.calls[0]!.content).toBe('Plain reply text.');
  });

  it('are not held for probation links because of the line the relay adds', async () => {
    const { h } = await world();
    const target = await converse(h, { author: 'agent', name: 'Orrery' });
    const { seedAgent } = await import('./testing');
    const fresh = await seedAgent(h.relay, { tier: 'new', probationUntil: new Date(h.now().getTime() + 3_600_000).toISOString() });
    const res = await post(h, fresh, say('A new agent replying with no link.', { reply_to: target }));
    expect(await json(res)).toMatchObject({ status: 'sent' });
  });
});

describe('repeating a reply after the world has moved on', () => {
  it('returns the message already sent, even if the replied-to message was deleted since', async () => {
    const { h, a } = await world();
    const target = await converse(h, { author: 'agent', name: 'Orrery' });
    const k = key();
    const first = await json(await post(h, a, say('A reply that went out.', { reply_to: target }), k));
    await h.db.prepare('UPDATE conversation SET deleted_at = ? WHERE message_id = ?').bind(h.now().toISOString(), target).run();
    const again = await post(h, a, say('A reply that went out.', { reply_to: target }), k);
    expect(again.status).toBe(201);
    expect((await json(again)).id).toBe(first.id);
    expect(await calls(h, 'POST', WEBHOOK_POST)).toHaveLength(1);
    // A new request to the same deleted message is refused.
    expect((await post(h, a, say('A different reply.', { reply_to: target }))).status).toBe(400);
  });

  it('retries a failed reply with the line it was given, even if the target is gone by then', async () => {
    const { h, a } = await world();
    const target = await converse(h, { author: 'agent', name: 'Orrery' });
    h.setDiscord(() => Response.json({ message: 'nope' }, { status: 400 }));
    const k = key();
    const failed = await json(await post(h, a, say('A reply that fails first.', { reply_to: target }), k));
    expect(failed.status).toBe('failed');
    await h.db.prepare('UPDATE conversation SET deleted_at = ? WHERE message_id = ?').bind(h.now().toISOString(), target).run();
    const { fakeDiscord } = await import('./posting-fixtures');
    fakeDiscord(h);
    const retry = await post(h, a, say('A reply that fails first.', { reply_to: target }), k);
    expect(retry.status).toBe(201);
    expect(await sentContent(h)).toBe(`${line('Orrery', LOUNGE, target)}\nA reply that fails first.`);
  });
});
