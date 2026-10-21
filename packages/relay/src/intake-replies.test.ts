import { ConversationPage, RelayEvent } from '@logitland/contracts';
import { describe, expect, it } from 'vitest';
import { AGENT_POST, STRANGER, all, at, conversation, eventTypes, fromWebhook, human, msg, push, relayMessage, stranger, world } from './intake-fixtures';
import { readPage } from './services/conversation';
import { recordAgentPost } from './services/intake';
import { contentHash } from './services/moderation/rows';
import { LOUNGE } from './testing';
import { agree } from './consent.testkit';

const eventData = async (h: Awaited<ReturnType<typeof world>>['h'], type = 'message.created') =>
  (await all<{ payload: string }>(h, 'SELECT payload FROM events WHERE type = ? ORDER BY seq', type)).map((r) => JSON.parse(r.payload).data);
const read = async (h: Awaited<ReturnType<typeof world>>['h']) => ConversationPage.parse(await readPage(h.relay, LOUNGE, {})).messages;
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
  it('keep the agent message they answer in the conversation, the event and the page', async () => {
    const { h } = await world();
    await push(h, human(1));
    expect(await conversation(h, 1)).toMatchObject({ reply_to: AGENT_POST });
    const [created] = await eventData(h);
    expect(created.reply_to).toBe(AGENT_POST);
    expect((await read(h)).map((m) => [m.message_id, m.reply_to])).toEqual([
      [msg(1), AGENT_POST],
      [AGENT_POST, null],
    ]);
  });

  it('are valid relay events once served', async () => {
    const { h } = await world();
    await push(h, human(1));
    const rows = await all<{ seq: number; payload: string }>(h, 'SELECT seq, payload FROM events ORDER BY seq');
    expect(rows).toHaveLength(1);
    for (const r of rows) expect(() => RelayEvent.parse({ ...JSON.parse(r.payload), cursor: String(r.seq) })).not.toThrow();
  });

  it('are the only messages of a person’s kept, and only once they had agreed', async () => {
    const { h } = await world();
    await agree(h, STRANGER, { at: at(30) });
    await push(h, human(1, { reply_to: null }), human(2, { reply_to: msg(1) }), human(3, { reply_to: msg(99) }), stranger(4), human(5));
    for (const n of [1, 2, 3, 4]) expect(await conversation(h, n)).toBeNull();
    expect(await conversation(h, 5)).toMatchObject({ author_kind: 'human', reply_to: AGENT_POST });
    expect((await eventData(h)).map((d) => d.message_id)).toEqual([msg(5)]);
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
    expect(await conversation(h, 2)).toMatchObject({ author_kind: 'human', reply_to: AGENT_POST });
  });
});
