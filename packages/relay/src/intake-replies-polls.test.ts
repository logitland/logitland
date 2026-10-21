import { ConversationPage, EventsPage, Poll, RelayEvent } from '@logitland/contracts';
import { describe, expect, it } from 'vitest';
import {
  STRANGER,
  all,
  at,
  conversation,
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
  world,
} from './intake-fixtures';
import { readPage } from './services/conversation';
import { recordAgentPost } from './services/intake';
import { contentHash } from './services/moderation/rows';
import { retentionJob } from './services/retention';
import { scrubMessage, scrubPerson } from './services/scrub';
import { LOUNGE } from './testing';
import { agree } from './consent.testkit';

const DAY = 86_400_000;
const eventData = async (h: Awaited<ReturnType<typeof world>>['h'], type = 'message.created') =>
  (await all<{ payload: string }>(h, 'SELECT payload FROM events WHERE type = ? ORDER BY seq', type)).map((r) => JSON.parse(r.payload).data);
const read = async (h: Awaited<ReturnType<typeof world>>['h'], view: 'agent' | 'public' = 'agent') =>
  ConversationPage.parse(await readPage(h.relay, LOUNGE, { view })).messages;
const agentPost = (agentId: string, n: number, over: Record<string, unknown> = {}) => ({
  discordMessageId: msg(n),
  channelId: LOUNGE,
  threadId: null,
  agentId,
  displayName: 'Moth-9',
  content: 'an answer',
  relayMessageId: 'msg_01JB7Q2M8R',
  createdAt: at(0, n),
  ...over,
});

describe('replies from Discord', () => {
  it('keep the message they answer in the conversation, the event and the page', async () => {
    const { h } = await world();
    await push(h, human(1), human(2, { reply_to: msg(1) }));
    expect(await conversation(h, 1)).toMatchObject({ reply_to: null });
    expect(await conversation(h, 2)).toMatchObject({ reply_to: msg(1) });
    const [first, second] = await eventData(h);
    expect(first).not.toHaveProperty('reply_to');
    expect(second.reply_to).toBe(msg(1));
    const page = await read(h);
    expect(page.map((m) => [m.message_id, m.reply_to])).toEqual([
      [msg(2), msg(1)],
      [msg(1), null],
    ]);
  });

  it('are valid relay events once served', async () => {
    const { h } = await world();
    await push(h, human(1), human(2, { reply_to: msg(1) }));
    const rows = await all<{ seq: number; payload: string }>(h, 'SELECT seq, payload FROM events ORDER BY seq');
    for (const r of rows) expect(() => RelayEvent.parse({ ...JSON.parse(r.payload), cursor: String(r.seq) })).not.toThrow();
  });

  it('are hidden, for agents and the public alike, along with a person who hadn’t agreed to the mirror', async () => {
    const { h, agent } = await world();
    await push(h, stranger(1), stranger(2, { reply_to: msg(1) }));
    await recordAgentPost(h.relay, agentPost(agent.id, 3, { replyTo: msg(2) }));
    for (const view of ['agent', 'public'] as const)
      expect((await read(h, view)).map((m) => [m.message_id, m.reply_to])).toEqual([
        [msg(3), msg(2)],
        [msg(2), null],
        [msg(1), null],
      ]);
    // Agreeing afterwards doesn't bring back what was written before: the relay never kept the reply.
    await agree(h, STRANGER, { at: '2026-10-19T03:00:00.000Z' });
    expect((await read(h, 'public')).find((m) => m.message_id === msg(2))!.reply_to).toBeNull();
    expect(await conversation(h, 2)).toMatchObject({ reply_to: null, withheld: 1 });
  });
});

describe('replies from agents', () => {
  it('are recorded by recordAgentPost, because a webhook can’t reply natively', async () => {
    const { h, agent } = await world();
    await push(h, human(1));
    await recordAgentPost(h.relay, agentPost(agent.id, 2, { replyTo: msg(1) }));
    expect(await conversation(h, 2)).toMatchObject({ author_kind: 'agent', reply_to: msg(1) });
    expect((await eventData(h)).at(-1).reply_to).toBe(msg(1));
    expect((await read(h))[0]!.reply_to).toBe(msg(1));
  });

  it('also accept the snake_case spelling', async () => {
    const { h, agent } = await world();
    await recordAgentPost(h.relay, agentPost(agent.id, 2, { reply_to: msg(1) }));
    expect((await conversation(h, 2))!.reply_to).toBe(msg(1));
  });

  it('reach a row the Gateway stored first, as a plain webhook or already as the agent', async () => {
    const { h, agent } = await world();
    await push(h, fromWebhook(2, 'Moth-9', 'an answer'));
    await recordAgentPost(h.relay, agentPost(agent.id, 2, { replyTo: msg(1) }));
    expect(await conversation(h, 2)).toMatchObject({ author_kind: 'agent', reply_to: msg(1) });

    await relayMessage(h, agent.id, { content: 'second', status: 'sent', discordMessageId: msg(4), hash: await contentHash('second') });
    await push(h, fromWebhook(4, 'Moth-9', 'second'));
    expect(await conversation(h, 4)).toMatchObject({ author_kind: 'agent', reply_to: null });
    await recordAgentPost(h.relay, agentPost(agent.id, 4, { replyTo: msg(3), content: 'second' }));
    expect(await conversation(h, 4)).toMatchObject({ author_kind: 'agent', reply_to: msg(3) });
    // The first answer stays the answer.
    await recordAgentPost(h.relay, agentPost(agent.id, 4, { replyTo: msg(99), content: 'second' }));
    expect((await conversation(h, 4))!.reply_to).toBe(msg(3));
    expect((await eventTypes(h)).filter((t) => t === 'message.created')).toHaveLength(2);
  });

  it('never turn a person’s message into an agent’s', async () => {
    const { h, agent } = await world();
    await push(h, human(2));
    await recordAgentPost(h.relay, agentPost(agent.id, 2, { replyTo: msg(1) }));
    expect(await conversation(h, 2)).toMatchObject({ author_kind: 'human', reply_to: null });
  });
});

describe('polls', () => {
  it('are stored with the message, shown whether or not it has text, and carried in the event', async () => {
    const { h } = await world();
    await push(
      h,
      human(1, { content: '', poll: poll() }),
      human(2, { content: 'vote please', poll: poll({ question: 'Tea?', allow_multiselect: true }) }),
      human(3),
    );
    expect(JSON.parse((await conversation(h, 1))!.poll)).toEqual(poll());
    expect((await conversation(h, 3))!.poll).toBeNull();

    const page = await read(h);
    const byId = Object.fromEntries(page.map((m) => [m.message_id, m]));
    expect(byId[msg(1)]).toMatchObject({ content: '', poll: poll() });
    expect(byId[msg(2)]).toMatchObject({ content: 'vote please', poll: { question: 'Tea?', allow_multiselect: true } });
    expect(byId[msg(3)]!.poll).toBeNull();
    expect(() => Poll.parse(byId[msg(1)]!.poll)).not.toThrow();

    const data = await eventData(h);
    expect(data[0]).toMatchObject({ content: '', poll: poll() });
    expect(data[2]).not.toHaveProperty('poll');
    const rows = await all<{ seq: number; payload: string }>(h, 'SELECT seq, payload FROM events ORDER BY seq');
    for (const r of rows) expect(() => RelayEvent.parse({ ...JSON.parse(r.payload), cursor: String(r.seq) })).not.toThrow();
  });

  it('are served through /v1/events like any message', async () => {
    const { h, agent } = await world();
    await push(h, human(1, { content: '', poll: poll() }));
    const res = await h.call('GET', '/v1/events?after=0', undefined, h.as(agent.key));
    const page = EventsPage.parse(await res.json());
    expect(page.events[0]).toMatchObject({ type: 'message.created', data: { content: '', poll: { question: 'Lunch?' } } });
  });

  it('take in their results, and a finished poll’s results stay', async () => {
    const { h } = await world();
    await push(h, human(1, { content: '', poll: poll() }));
    const events = (await all(h, 'SELECT 1 FROM events')).length;
    const results = (finalized: boolean, a: number, b: number) => ({
      kind: 'message_poll' as const,
      channel_id: LOUNGE,
      message_id: msg(1),
      results: {
        finalized,
        counts: [
          { id: 1, count: a },
          { id: 2, count: b },
        ],
      },
    });
    await push(h, results(false, 1, 0));
    expect(JSON.parse((await conversation(h, 1))!.poll).results).toEqual({
      finalized: false,
      counts: [
        { id: 1, count: 1 },
        { id: 2, count: 0 },
      ],
    });
    await push(h, results(true, 5, 3));
    expect(JSON.parse((await conversation(h, 1))!.poll).results).toEqual({
      finalized: true,
      counts: [
        { id: 1, count: 5 },
        { id: 2, count: 3 },
      ],
    });
    await push(h, results(false, 9, 9), results(true, 0, 0));
    expect(JSON.parse((await conversation(h, 1))!.poll).results.counts[0].count).toBe(5);
    expect((await read(h))[0]!.poll!.results).toEqual({
      finalized: true,
      counts: [
        { id: 1, count: 5 },
        { id: 2, count: 3 },
      ],
    });
    // Results are state, not news: no event is recorded for them.
    expect((await all(h, 'SELECT 1 FROM events')).length).toBe(events);
  });

  it('ignore results for messages that have no poll, or that the relay never saw', async () => {
    const { h } = await world();
    await push(
      h,
      human(1),
      { kind: 'message_poll', channel_id: LOUNGE, message_id: msg(1), results: { finalized: true, counts: [] } },
      { kind: 'message_poll', channel_id: LOUNGE, message_id: msg(9), results: { finalized: true, counts: [] } },
    );
    expect((await conversation(h, 1))!.poll).toBeNull();
    expect(await conversation(h, 9)).toBeNull();
  });

  it('are hidden, for agents and the public alike, along with a person who hadn’t agreed, but not an agent’s', async () => {
    const { h, agent } = await world();
    await push(h, stranger(1, { content: '', poll: poll() }));
    await recordAgentPost(h.relay, agentPost(agent.id, 2, { content: '', poll: poll({ question: 'Agent poll' }) }));
    expect((await conversation(h, 1))!.poll).toBeNull();
    for (const view of ['agent', 'public'] as const) {
      const page = Object.fromEntries((await read(h, view)).map((m) => [m.message_id, m]));
      expect(page[msg(1)]!.poll).toBeNull();
      expect(page[msg(2)]!.poll).toMatchObject({ question: 'Agent poll' });
    }
  });

  it('are recorded by recordAgentPost, in the relay’s shape or as Discord describes them', async () => {
    const { h, agent } = await world();
    await recordAgentPost(h.relay, agentPost(agent.id, 2, { content: '', poll: poll({ question: 'Ours' }) }));
    await recordAgentPost(h.relay, {
      ...agentPost(agent.id, 3, { content: '' }),
      poll: {
        question: { text: 'Theirs' },
        answers: [
          { answer_id: 1, poll_media: { text: 'Yes' } },
          { answer_id: 2, poll_media: { text: 'No' } },
        ],
        expiry: '2026-10-21T00:00:00.000000+00:00',
        allow_multiselect: false,
      },
    });
    expect(JSON.parse((await conversation(h, 2))!.poll)).toMatchObject({
      question: 'Ours',
      answers: [
        { id: 1, text: 'Soup' },
        { id: 2, text: 'Noodles' },
      ],
    });
    expect(JSON.parse((await conversation(h, 3))!.poll)).toEqual({
      question: 'Theirs',
      answers: [
        { id: 1, text: 'Yes', emoji: null },
        { id: 2, text: 'No', emoji: null },
      ],
      expires_at: '2026-10-21T00:00:00.000Z',
      allow_multiselect: false,
    });
    expect((await eventData(h))[1].poll.question).toBe('Theirs');
  });

  it('reach a webhook row the Gateway stored first, and keep the poll the Gateway saw', async () => {
    const { h, agent } = await world();
    await push(h, fromWebhook(2, 'Moth-9', '', { poll: poll({ question: 'From Discord' }) }));
    await recordAgentPost(h.relay, agentPost(agent.id, 2, { content: '', poll: poll({ question: 'From the relay' }) }));
    expect(await conversation(h, 2)).toMatchObject({ author_kind: 'agent' });
    expect(JSON.parse((await conversation(h, 2))!.poll).question).toBe('From Discord');
  });

  it('go with the text when a message is removed, and a late create cannot bring them back', async () => {
    const { h } = await world();
    await push(h, human(1, { content: 'see poll', poll: poll() }), human(2, { content: '', poll: poll({ question: 'Second' }) }));
    await scrubMessage(h.relay, msg(1), 'moderator');
    await push(h, remove(2));
    for (const n of [1, 2]) expect((await conversation(h, n))!.poll).toBeNull();
    expect(JSON.stringify(await all(h, 'SELECT payload FROM events'))).not.toMatch(/Lunch\?|Second|Soup/);
    expect((await read(h)).every((m) => m.poll === null)).toBe(true);

    await push(h, remove(3), human(3, { content: '', poll: poll({ question: 'Too late' }) }));
    expect((await conversation(h, 3))!.poll).toBeNull();
    expect(JSON.stringify(await all(h, 'SELECT payload FROM events'))).not.toContain('Too late');
  });

  it('go when a person leaves the mirror', async () => {
    const { h } = await world();
    await push(h, human(1, { content: '', poll: poll({ question: 'Secret poll' }) }));
    await scrubPerson(h.relay, '200000000000000001');
    expect((await conversation(h, 1))!.poll).toBeNull();
    expect(JSON.stringify(await all(h, 'SELECT payload FROM events'))).not.toContain('Secret poll');
  });

  it('are blanked from old event payloads even when the message had no text, while the conversation keeps its poll', async () => {
    const { h } = await world();
    await push(h, human(1, { content: '', poll: poll({ question: 'Old poll' }) }));
    h.advance(31 * DAY);
    await push(h, human(2, { content: '', poll: poll({ question: 'New poll' }) }));
    expect(await retentionJob(h.relay)).toBe(1);
    const data = await eventData(h);
    expect(data[0]).not.toHaveProperty('poll');
    expect(data[0].content).toBe('');
    expect(data[1].poll.question).toBe('New poll');
    expect(JSON.parse((await conversation(h, 1))!.poll).question).toBe('Old poll');
    expect(await retentionJob(h.relay)).toBe(0);
  });

  it('tell messages with a poll from messages without one, in history too', async () => {
    const { h } = await world();
    await ingestHistory(h, human(1, { content: '', poll: poll() }));
    expect(JSON.parse((await conversation(h, 1))!.poll).question).toBe('Lunch?');
    expect(await all(h, 'SELECT 1 FROM events')).toHaveLength(0);
    expect(await one(h, 'SELECT 1 AS n FROM conversation WHERE poll IS NOT NULL')).toEqual({ n: 1 });
  });
});

async function ingestHistory(h: Awaited<ReturnType<typeof world>>['h'], ...events: unknown[]) {
  const { ingest } = await import('./services/intake');
  return ingest(h.relay, { source: 'seed', events, history: true });
}
