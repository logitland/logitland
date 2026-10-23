import { describe, expect, it } from 'vitest';
import { all, at, conversation, edit, human, msg, one, push, relayMessage, remove, subscribe, waiting, world } from './intake-fixtures';
import { recordAgentPost } from './services/intake';
import { scrubMessage } from './services/scrub';
import { LOUNGE } from './testing';

const payloads = async (h: Awaited<ReturnType<typeof world>>['h'], type: string) =>
  (await all<{ payload: string }>(h, 'SELECT payload FROM events WHERE type = ? ORDER BY seq', type)).map((r) => JSON.parse(r.payload));

describe('scrubbing one message', () => {
  it('removes the text from the conversation and event payloads, records who removed it, and announces the removal', async () => {
    const { h, agent } = await world();
    const sub = await subscribe(h, agent.id);
    await push(h, human(1, { content: 'secret plans' }), edit(1, 'secret plans, revised', 5), human(2, { content: 'harmless' }));

    await scrubMessage(h.relay, msg(1), 'moderator');

    expect(await conversation(h, 1)).toMatchObject({ content: null, removed_by: 'moderator', author_kind: 'human' });
    expect((await conversation(h, 1))!.deleted_at).toBe(h.now().toISOString());
    expect((await conversation(h, 2))!.content).toBe('harmless');

    const created = await payloads(h, 'message.created');
    expect(created[0].data.content).toBe('');
    expect(created[1].data.content).toBe('harmless');
    expect((await payloads(h, 'message.updated'))[0].data).toMatchObject({ content: '', edited_at: at(5) });
    expect(JSON.stringify(await all(h, 'SELECT payload FROM events'))).not.toContain('secret');
    expect((await payloads(h, 'message.deleted'))[0].data).toEqual({ message_id: msg(1), removed_by: 'moderator' });
    expect(await waiting(h, sub)).toEqual(['message.created', 'message.updated', 'message.created', 'message.deleted']);
  });

  it('does not add a content key to edits that had none', async () => {
    const { h } = await world();
    await push(h, human(1), edit(1, undefined, 5));
    await scrubMessage(h.relay, msg(1), 'moderator');
    expect((await payloads(h, 'message.updated'))[0].data).toEqual({ message_id: msg(1), edited_at: at(5) });
  });

  it('can be repeated: one removal event, same tombstone', async () => {
    const { h } = await world();
    await push(h, human(1));
    await scrubMessage(h.relay, msg(1), 'moderator');
    await scrubMessage(h.relay, msg(1), 'moderator');
    expect(await payloads(h, 'message.deleted')).toHaveLength(1);
  });

  it('keeps a moderator’s mark when Discord’s own delete event follows, and does not record the removal twice', async () => {
    const { h } = await world();
    await push(h, human(1));
    await scrubMessage(h.relay, msg(1), 'moderator');
    const r = await push(h, remove(1));
    expect(r).toMatchObject({ recorded: 0, ignored: 1 });
    expect(await conversation(h, 1)).toMatchObject({ removed_by: 'moderator', content: null });
    expect(await payloads(h, 'message.deleted')).toHaveLength(1);
  });

  it('keeps a moderator’s mark when scrubbing a message Discord already reported deleted', async () => {
    const { h } = await world();
    await push(h, human(1), remove(1));
    expect((await conversation(h, 1))!.removed_by).toBe('discord');
    await scrubMessage(h.relay, msg(1), 'moderator');
    expect((await conversation(h, 1))!.removed_by).toBe('moderator');
  });

  it('leaves a tombstone for a message the relay has not seen yet, so a late create cannot bring it back', async () => {
    const { h, agent } = await world();
    const sub = await subscribe(h, agent.id);
    await scrubMessage(h.relay, msg(1), 'moderator', { channelId: LOUNGE });
    await push(h, human(1, { content: 'resurrected?' }));
    expect(await conversation(h, 1)).toMatchObject({ content: null, removed_by: 'moderator' });
    expect(JSON.stringify(await all(h, 'SELECT payload FROM events'))).not.toContain('resurrected');
    expect(await waiting(h, sub)).toEqual([]);
  });

  it('does nothing, and says so in the log, for a message it cannot place', async () => {
    const { h } = await world();
    await scrubMessage(h.relay, msg(1), 'moderator');
    expect(await all(h, 'SELECT 1 FROM events')).toHaveLength(0);
    expect(h.log.lines.some((l) => l.event === 'scrub.unknown_message')).toBe(true);
  });
});

describe('the relay’s own copy of a post an agent made', () => {
  async function posted() {
    const { h, agent } = await world();
    const mine = await relayMessage(h, agent.id, { content: 'my private-ish words', status: 'sent', discordMessageId: msg(1), hash: 'mine' });
    const other = await relayMessage(h, agent.id, { content: 'someone else’s post', status: 'sent', discordMessageId: msg(2), hash: 'other' });
    await h.db
      .prepare('UPDATE relay_messages SET thread_name = ?, reply_prefix = ? WHERE id IN (?, ?)')
      .bind('a title', '-# > replying to [Tess: "hi"](https://discord.com/channels/1/2/3)', mine, other)
      .run();
    await recordAgentPost(h.relay, {
      discordMessageId: msg(1),
      channelId: LOUNGE,
      threadId: null,
      agentId: agent.id,
      displayName: 'Moth-9',
      content: 'my private-ish words',
      relayMessageId: mine,
      createdAt: at(0, 1),
    });
    return { h, mine, other };
  }
  const copy = (h: Awaited<ReturnType<typeof world>>['h'], id: string) =>
    one<{ content: string | null; thread_name: string | null; reply_prefix: string | null; content_hash: string; status: string }>(
      h,
      'SELECT content, thread_name, reply_prefix, content_hash, status FROM relay_messages WHERE id = ?',
      id,
    );

  it('stays when a moderator takes it down, kept a year for the appeal', async () => {
    const { h, mine } = await posted();
    await scrubMessage(h.relay, msg(1), 'moderator');
    expect(await copy(h, mine)).toMatchObject({
      content: 'my private-ish words',
      thread_name: 'a title',
      reply_prefix: expect.stringContaining('replying to'),
    });
  });

  it('goes with the message when Discord deletes it, singly or in bulk: text, thread title and reply line', async () => {
    const { h, mine, other } = await posted();
    await push(h, remove(1));
    expect(await copy(h, mine)).toMatchObject({ content: null, thread_name: null, reply_prefix: null, content_hash: 'mine' });
    expect(await copy(h, other))!.toMatchObject({ content: 'someone else’s post' });
    await push(h, { kind: 'message_delete_bulk', channel_id: LOUNGE, message_ids: [msg(2), msg(3)] });
    expect(await copy(h, other)).toMatchObject({ content: null, thread_name: null, reply_prefix: null });
  });
});
