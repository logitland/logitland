import { describe, expect, it } from 'vitest';
import { agree } from './consent.testkit';
import { CONV, all, at, conversation, edit, human, HUMAN, msg, one, push, relayMessage, remove, subscribe, waiting, world } from './intake-fixtures';
import { recordAgentPost } from './services/intake';
import { scrubMessage, scrubPerson } from './services/scrub';
import { BENCH, GUILD, LOUNGE, setAccess } from './testing';

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

  it('is left alone by a person withdrawing, who wrote none of it', async () => {
    const { h, mine } = await posted();
    await scrubPerson(h.relay, HUMAN);
    expect(await copy(h, mine)).toMatchObject({ content: 'my private-ish words', thread_name: 'a title' });
  });
});

describe('scrubbing a person', () => {
  async function people() {
    const { h, agent } = await world();
    await setAccess(h.db, BENCH, 'read_only');
    const subs = [await subscribe(h, agent.id, LOUNGE), await subscribe(h, agent.id, BENCH)];
    const other = { id: '200000000000000002', username: 'tess' };
    await agree(h, other.id);
    await push(
      h,
      { kind: 'thread_upsert', thread_id: '120000000000000001', parent_id: LOUNGE, name: 't' },
      human(1, { content: 'luna one' }),
      human(2, { content: 'tess one', author: other }),
      human(3, { content: 'luna in a thread', thread_id: '120000000000000001' }),
      human(4, { channel_id: BENCH, content: 'luna on the bench' }),
      human(5, { content: 'luna deleted already' }),
      edit(1, 'luna one, edited', 5),
    );
    await push(h, remove(5));
    return { h, agent, subs };
  }

  it('removes everything they wrote, everywhere, and nothing anyone else wrote', async () => {
    const { h } = await people();
    const r = await scrubPerson(h.relay, HUMAN);
    expect(r).toEqual({ messages: 3, more: false });

    for (const n of [1, 3, 4]) expect(await conversation(h, n)).toMatchObject({ content: null, removed_by: 'author' });
    expect(await conversation(h, 2)).toMatchObject({ content: 'tess one', removed_by: null, deleted_at: null });

    const all_ = JSON.stringify(await all(h, 'SELECT payload FROM events'));
    expect(all_).not.toContain('luna one');
    expect(all_).not.toContain('luna in a thread');
    expect(all_).not.toContain('luna on the bench');
    expect(all_).toContain('tess one');
  });

  it('records one message.bulk_deleted per channel with the IDs removed', async () => {
    const { h, subs } = await people();
    await scrubPerson(h.relay, HUMAN);
    const bulk = await all<{ channel_id: string; payload: string }>(
      h,
      "SELECT channel_id, payload FROM events WHERE type = 'message.bulk_deleted' ORDER BY seq",
    );
    expect(bulk.map((b) => b.channel_id).sort()).toEqual([BENCH, LOUNGE].sort());
    const byChannel = Object.fromEntries(bulk.map((b) => [b.channel_id, JSON.parse(b.payload).data]));
    expect(byChannel[LOUNGE]).toEqual({ message_ids: [msg(1), msg(3)] });
    expect(byChannel[BENCH]).toEqual({ message_ids: [msg(4)] });
    for (const sub of subs) expect((await waiting(h, sub)).at(-1)).toBe('message.bulk_deleted');
  });

  it('can be repeated and finds nothing more', async () => {
    const { h } = await people();
    await scrubPerson(h.relay, HUMAN);
    const events = (await all(h, 'SELECT 1 FROM events')).length;
    expect(await scrubPerson(h.relay, HUMAN)).toEqual({ messages: 0, more: false });
    expect((await all(h, 'SELECT 1 FROM events')).length).toBe(events);
  });

  it('handles a person with hundreds of messages', async () => {
    const { h } = await world();
    await push(h, ...Array.from({ length: 100 }, (_, i) => human(i + 1)));
    await push(h, ...Array.from({ length: 100 }, (_, i) => human(i + 101)));
    await push(h, ...Array.from({ length: 70 }, (_, i) => human(i + 201)));
    expect((await scrubPerson(h.relay, HUMAN)).messages).toBe(270);
    expect(await all(h, "SELECT 1 FROM conversation WHERE author_kind = 'human' AND content IS NOT NULL")).toHaveLength(0);
    expect(JSON.stringify(await all(h, 'SELECT payload FROM events'))).not.toContain('\\"content\\":\\"message');
  });

  it('still removes the text of a channel the relay no longer lists, without an event', async () => {
    const { h } = await people();
    await h.db.prepare('DELETE FROM channels WHERE id = ?').bind(BENCH).run();
    await scrubPerson(h.relay, HUMAN);
    expect((await conversation(h, 4))!.content).toBeNull();
    expect(await all(h, "SELECT 1 FROM events WHERE type = 'message.bulk_deleted'")).toHaveLength(1);
  });
});

describe('a person withdrawing stops being identifiable', () => {
  const FORMER = { discord_user_id: null, display_name: 'Former participant', author_ref: 'p_removed' };

  async function world2() {
    const w = await world();
    const { h } = w;
    await agree(h, '200000000000000002');
    await push(
      h,
      human(1, { content: 'luna one' }),
      human(2, { content: 'tess one', author: { id: '200000000000000002', username: 'tess', global_name: 'Tess' } }),
      human(3, { content: 'luna deleted in Discord' }),
      human(4, { content: 'luna taken down' }),
      edit(1, 'luna one, edited', 5),
    );
    await push(h, remove(3));
    return w;
  }

  it('anonymises their tombstones in the conversation, keeping when and why', async () => {
    const { h } = await world2();
    const before = await conversation(h, 1);
    expect(before).toMatchObject({ display_name: 'Luna', discord_user_id: HUMAN });
    expect((await scrubPerson(h.relay, HUMAN)).messages).toBe(2);

    for (const n of [1, 4])
      expect(await conversation(h, n)).toMatchObject({
        ...FORMER,
        content: null,
        removed_by: 'author',
        author_kind: 'human',
        channel_id: LOUNGE,
        created_at: at(0, n),
      });
    // A message Discord had already reported deleted keeps that, but stops naming the person.
    expect(await conversation(h, 3)).toMatchObject({ ...FORMER, content: null, removed_by: 'discord' });
    expect(await conversation(h, 2)).toMatchObject({ display_name: 'Tess', discord_user_id: '200000000000000002', content: 'tess one' });
    expect(await all(h, 'SELECT 1 FROM conversation WHERE discord_user_id = ?', HUMAN)).toHaveLength(0);
    expect(JSON.stringify(await all(h, `SELECT ${CONV} FROM conversation`))).not.toContain(before!.author_ref);
  });

  it('anonymises event payloads the same way, name and pseudonym both', async () => {
    const { h } = await world2();
    const authorRef = (await conversation(h, 1))!.author_ref;
    await scrubPerson(h.relay, HUMAN);
    const created = (
      await all<{ message_id: string; payload: string }>(
        h,
        "SELECT CAST(message_id AS TEXT) AS message_id, payload FROM events WHERE type = 'message.created' ORDER BY seq",
      )
    ).map((r) => ({ id: r.message_id, ...JSON.parse(r.payload).data }));
    for (const m of created.filter((c) => c.id !== msg(2)))
      expect(m.author).toEqual({ kind: 'human', agent_id: null, author_id: 'p_removed', display_name: 'Former participant' });
    expect(created.find((c) => c.id === msg(2))!.author.display_name).toBe('Tess');
    const everything = JSON.stringify(await all(h, 'SELECT payload FROM events'));
    expect(everything).not.toContain(authorRef);
    expect(everything).not.toContain('Luna');
  });

  it('shows agents the former participant, not the person', async () => {
    const { h, agent } = await world2();
    await scrubPerson(h.relay, HUMAN);
    const page = await (await h.call('GET', `/v1/channels/${LOUNGE}/messages`, undefined, h.as(agent.token))).json();
    const mine = (page as { messages: { message_id: string; author: object; deleted: boolean; content: string | null }[] }).messages.find(
      (m) => m.message_id === msg(1),
    )!;
    expect(mine).toMatchObject({ deleted: true, content: null, author: { kind: 'human', author_id: 'p_removed', display_name: 'Former participant' } });
  });

  it('finds nothing more the second time', async () => {
    const { h } = await world2();
    await scrubPerson(h.relay, HUMAN);
    const events = (await all(h, 'SELECT 1 FROM events')).length;
    expect(await scrubPerson(h.relay, HUMAN)).toEqual({ messages: 0, more: false });
    expect((await all(h, 'SELECT 1 FROM events')).length).toBe(events);
  });

  it('is only for people who leave: a moderator’s takedown keeps who wrote the message', async () => {
    const { h } = await world2();
    await scrubMessage(h.relay, msg(4), 'moderator');
    expect(await conversation(h, 4)).toMatchObject({ content: null, removed_by: 'moderator', display_name: 'Luna', discord_user_id: HUMAN });
    expect(
      JSON.parse((await one<{ payload: string }>(h, "SELECT payload FROM events WHERE type = 'message.created' AND message_id = ?", msg(4)))!.payload).data
        .author.display_name,
    ).toBe('Luna');
  });

  it('handles a person with a hundred messages', async () => {
    const { h } = await world();
    await push(h, ...Array.from({ length: 100 }, (_, i) => human(i + 1)));
    const first = await scrubPerson(h.relay, HUMAN);
    expect(first).toEqual({ messages: 100, more: false });
    expect(await all(h, 'SELECT 1 FROM conversation WHERE discord_user_id IS NOT NULL')).toHaveLength(0);
    expect(await all(h, "SELECT 1 FROM conversation WHERE author_kind = 'human' AND display_name != 'Former participant'")).toHaveLength(0);
  });
});

describe('a person withdrawing stops being named in what agents wrote to them', () => {
  const TESS = { id: '200000000000000002', username: 'tess', global_name: 'Tess' };
  const link = (target: number) => `https://discord.com/channels/${GUILD}/${LOUNGE}/${msg(target)}`;
  const line = (who: string, target: number, quote: string) => `-# > replying to [${who}: "${quote}"](${link(target)})`;
  const unnamed = (target: number) => `-# > replying to [a person](${link(target)})`;

  async function replies() {
    const w = await world();
    const { h, agent } = w;
    await agree(h, TESS.id);
    await push(h, human(1, { content: 'luna one' }), human(2, { content: 'tess one', author: TESS }));
    // The posting records: one sent to each person, and one to Luna still on its way.
    const sent = await relayMessage(h, agent.id, { content: 'good point', status: 'sent', discordMessageId: msg(3), hash: 'sent' });
    const flying = await relayMessage(h, agent.id, { content: 'on its way', status: 'queued', hash: 'flying' });
    const other = await relayMessage(h, agent.id, { content: 'to Tess', status: 'sent', discordMessageId: msg(4), hash: 'other' });
    for (const [id, to, who, quote] of [
      [sent, 1, `<@${HUMAN}>`, 'luna one'],
      [flying, 1, `<@${HUMAN}>`, 'luna one'],
      [other, 2, `<@${TESS.id}>`, 'tess one'],
    ] as const)
      await h.db
        .prepare('UPDATE relay_messages SET reply_to = ?, reply_prefix = ? WHERE id = ?')
        .bind(msg(to), line(who, to, quote), id)
        .run();
    return { ...w, sent, flying, other };
  }
  const prefix = (h: Awaited<ReturnType<typeof world>>['h'], id: string) =>
    one<{ reply_prefix: string }>(h, 'SELECT reply_prefix FROM relay_messages WHERE id = ?', id).then((r) => r!.reply_prefix);

  it('takes their mention and quote out of the reply lines in the posting records, for that person only', async () => {
    const { h, sent, flying, other } = await replies();
    await scrubPerson(h.relay, HUMAN);
    expect(await prefix(h, sent)).toBe(unnamed(1));
    expect(await prefix(h, flying)).toBe(unnamed(1));
    expect(await prefix(h, other)).toBe(line(`<@${TESS.id}>`, 2, 'tess one'));
  });

  it('never stored the line where agents read: the conversation and events carry reply_to instead', async () => {
    const { h, agent } = await replies();
    await recordAgentPost(h.relay, {
      discordMessageId: msg(3),
      channelId: LOUNGE,
      threadId: null,
      agentId: agent.id,
      displayName: 'Moth-9',
      content: 'good point',
      relayMessageId: 'msg_01JB7Q2M8R',
      createdAt: at(0, 3),
      replyTo: msg(1),
    });
    // The Gateway's copy of an edit carries the line Discord shows; it comes off again.
    await push(h, edit(3, `${line(`<@${HUMAN}>`, 1, 'luna one')}\ngood point, revised`, 5));
    expect(await conversation(h, 3)).toMatchObject({ content: 'good point, revised', reply_to: msg(1) });
    const updated = (await payloads(h, 'message.updated')).find((p) => p.data.message_id === msg(3));
    expect(updated.data.content).toBe('good point, revised');
    expect(JSON.stringify(await all(h, 'SELECT payload FROM events'))).not.toContain('replying to');
  });

  it('can be repeated, and finds nothing more to change', async () => {
    const { h, sent } = await replies();
    await scrubPerson(h.relay, HUMAN);
    const before = JSON.stringify([await all(h, `SELECT ${CONV} FROM conversation`), await all(h, 'SELECT payload FROM events'), await prefix(h, sent)]);
    await scrubPerson(h.relay, HUMAN);
    expect(JSON.stringify([await all(h, `SELECT ${CONV} FROM conversation`), await all(h, 'SELECT payload FROM events'), await prefix(h, sent)])).toBe(before);
  });
});
