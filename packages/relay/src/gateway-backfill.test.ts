import { describe, expect, it } from 'vitest';
import { backfill, seedHistory } from './gateway';
import { AGENT_POST, NEWS, all, at, conversation, human, moreChannels, msg, one, push, subscribe, world } from './intake-fixtures';
import { BENCH, FORUM, LOUNGE } from './testing';

const THREAD = '120000000000000001';
// A bot: intake keeps what bots write as it is, so these tests are about fetching, not about whose words are kept.
const AUTHOR = { id: '200000000000000001', username: 'luna', bot: true };
const rest = (n: number, over: Record<string, unknown> = {}) => ({
  id: msg(n),
  channel_id: LOUNGE,
  author: AUTHOR,
  content: `m ${n}`,
  timestamp: at(1, n),
  edited_timestamp: null,
  type: 0,
  ...over,
});

function discordPages(h: Awaited<ReturnType<typeof world>>['h'], pages: Record<string, (after: string | null) => Response | unknown[]>) {
  const asked: string[] = [];
  h.setDiscord(async (req) => {
    const url = new URL(req.url);
    const m = /\/channels\/(\d+)\/messages$/.exec(url.pathname);
    asked.push(`${m?.[1]} after=${url.searchParams.get('after')}`);
    const page = pages[m![1]!]?.(url.searchParams.get('after'));
    return page instanceof Response ? page : Response.json(page ?? []);
  });
  return asked;
}

describe('backfill', () => {
  it('fetches after the given message, oldest first even though Discord lists newest first, and skips system messages', async () => {
    const { h } = await world();
    const asked = discordPages(h, { [LOUNGE]: () => [rest(3), rest(2, { type: 7 }), rest(1, { content: 'edited', edited_timestamp: at(2) })] });
    const r = await backfill(h.relay, { [LOUNGE]: msg(0) }, 5);
    expect(asked).toEqual([`${LOUNGE} after=${msg(0)}`]);
    expect(r).toEqual({ remaining: {}, pages: 1, messages: 3 });
    expect(
      (await all<{ message_id: string }>(h, "SELECT CAST(message_id AS TEXT) AS message_id FROM events WHERE type = 'message.created' ORDER BY seq")).map(
        (e) => e.message_id,
      ),
    ).toEqual([msg(1), msg(3)]);
    expect(await conversation(h, 1)).toMatchObject({ content: 'edited', edited_at: at(2) });
    expect(await conversation(h, 2)).toBeNull();
  });

  it('follows threads by their own ID and files their messages under the parent channel', async () => {
    const { h } = await world();
    await push(h, { kind: 'thread_upsert', thread_id: THREAD, parent_id: LOUNGE, name: 't' });
    discordPages(h, { [THREAD]: () => [rest(1, { channel_id: THREAD })] });
    await backfill(h.relay, { [THREAD]: msg(0) }, 5);
    expect(await conversation(h, 1)).toMatchObject({ channel_id: LOUNGE, thread_id: THREAD });
  });

  it('drops places that are not open channels or their threads, and places it can no longer read', async () => {
    const { h } = await world();
    await push(h, { kind: 'thread_upsert', thread_id: THREAD, parent_id: LOUNGE, name: 't' });
    const asked = discordPages(h, { [THREAD]: () => Response.json({ message: 'Missing Access', code: 50001 }, { status: 403 }) });
    const r = await backfill(h.relay, { [BENCH]: msg(0), '130000000000000009': msg(0), [THREAD]: msg(0) }, 5);
    expect(asked).toEqual([`${THREAD} after=${msg(0)}`]);
    expect(r.remaining).toEqual({});
    expect(h.log.lines.some((l) => l.event === 'backfill.unavailable' && l.fields.status === 403)).toBe(true);
  });

  it('stops at the page cap and returns where it got to', async () => {
    const { h } = await world();
    const full = (from: number) => Array.from({ length: 100 }, (_, i) => rest(from + 99 - i));
    const asked = discordPages(h, { [LOUNGE]: (after) => full(Number(BigInt(after!) - 300000000000000000n) + 1) });
    const r = await backfill(h.relay, { [LOUNGE]: msg(0) }, 2);
    expect(asked).toEqual([`${LOUNGE} after=${msg(0)}`, `${LOUNGE} after=${msg(100)}`]);
    expect(r).toMatchObject({ remaining: { [LOUNGE]: msg(200) }, pages: 2, messages: 200 });
  });

  it('is repeatable: messages already recorded are not recorded again', async () => {
    const { h } = await world();
    await push(h, human(1));
    discordPages(h, { [LOUNGE]: () => [rest(1, { content: 'message 1', timestamp: at(0, 1) }), rest(2)] });
    await backfill(h.relay, { [LOUNGE]: msg(0) }, 5);
    await backfill(h.relay, { [LOUNGE]: msg(0) }, 5);
    expect(await all(h, 'SELECT 1 FROM events')).toHaveLength(2);
  });
});

describe('seedHistory', () => {
  const MEDIA_ID = '110000000000000004';

  it('looks once at a relayed channel that has no cursor, keeping its latest page for readers without announcing it', async () => {
    const { h, agent } = await world();
    await subscribe(h, agent.id);
    const asked = discordPages(h, {
      [LOUNGE]: () => [rest(3), rest(2, { type: 19, message_reference: { message_id: msg(1) } }), rest(1)],
    });
    const r = await seedHistory(h.relay, 10);
    expect(asked).toEqual([`${LOUNGE} after=null`]);
    expect(r).toEqual({ places: 1, messages: 3, more: false });
    expect(
      (await all<{ id: string }>(h, 'SELECT CAST(message_id AS TEXT) AS id FROM conversation WHERE message_id != ? ORDER BY message_id', AGENT_POST)).map(
        (c) => c.id,
      ),
    ).toEqual([msg(1), msg(2), msg(3)]);
    expect(await conversation(h, 2)).toMatchObject({ reply_to: msg(1) });
    // History is not news.
    expect(await all(h, 'SELECT 1 FROM events')).toHaveLength(0);
    expect(await all(h, 'SELECT 1 FROM deliveries')).toHaveLength(0);
    expect((await one<{ last: string }>(h, 'SELECT CAST(last_message_id AS TEXT) AS last FROM channel_cursors WHERE channel_id = ?', LOUNGE))!.last).toBe(
      msg(3),
    );

    // Once: with a cursor in place nothing is fetched again.
    expect(await seedHistory(h.relay, 10)).toEqual({ places: 0, messages: 0, more: false });
    expect(asked).toHaveLength(1);
  });

  it('asks for the newest page, without a cursor of its own', async () => {
    const { h } = await world();
    const urls: string[] = [];
    h.setDiscord(async (req) => {
      urls.push(new URL(req.url).search);
      return Response.json([]);
    });
    await seedHistory(h.relay, 10);
    expect(urls).toEqual(['?limit=100']);
  });

  it('marks a channel with nothing in it as looked at, so it is not asked about every minute', async () => {
    const { h } = await world();
    const asked = discordPages(h, {});
    await seedHistory(h.relay, 10);
    await seedHistory(h.relay, 10);
    expect(asked).toHaveLength(1);
    expect((await one<{ last: string }>(h, 'SELECT CAST(last_message_id AS TEXT) AS last FROM channel_cursors WHERE channel_id = ?', LOUNGE))!.last).toBe('0');
  });

  it('does not keep asking about places the bot can’t read', async () => {
    const { h } = await world();
    const asked = discordPages(h, { [LOUNGE]: () => Response.json({ message: 'Missing Access', code: 50001 }, { status: 403 }) });
    await seedHistory(h.relay, 10);
    await seedHistory(h.relay, 10);
    expect(asked).toHaveLength(1);
    expect(h.log.lines.some((l) => l.event === 'seed.unavailable' && l.fields.status === 403)).toBe(true);
  });

  it('stops at a rate limit and says when to come back', async () => {
    const { h } = await world();
    discordPages(h, { [LOUNGE]: () => Response.json({ retry_after: 7, global: false }, { status: 429, headers: { 'retry-after': '7' } }) });
    expect(await seedHistory(h.relay, 10)).toMatchObject({ more: true, retryAfterSeconds: 7, places: 0 });
    expect(await all(h, 'SELECT 1 FROM channel_cursors')).toHaveLength(0);
  });

  it('does a bounded number of places a run and reports that more are waiting', async () => {
    const { h } = await world();
    await moreChannels(h);
    await h.db.prepare("UPDATE channels SET type = 'text', agent_access = 'read_only' WHERE id IN (?, ?)").bind(FORUM, MEDIA_ID).run();
    const asked = discordPages(h, {});
    expect(await seedHistory(h.relay, 2)).toEqual({ places: 2, messages: 0, more: true });
    expect(await seedHistory(h.relay, 2)).toEqual({ places: 2, messages: 0, more: false });
    expect(asked).toHaveLength(4);
  });
});
