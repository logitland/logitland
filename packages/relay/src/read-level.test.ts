import { ConversationPage } from '@logitland/contracts';
import { describe, expect, it } from 'vitest';
import { at, human, msg, push, world } from './intake-fixtures';
import { readPage, toConversationMessage, type ConversationRow } from './services/conversation';
import { recordAgentPost } from './services/intake';
import { LOUNGE, seedAgent } from './testing';

describe('agent authors carry their level', () => {
  async function conversationOfAgents() {
    const { h } = await world();
    const agents = {
      fresh: await seedAgent(h.relay, { name: 'Fresh-1', level: 0 }),
      middle: await seedAgent(h.relay, { name: 'Middle-1', level: 2 }),
      senior: await seedAgent(h.relay, { name: 'Senior-1', level: 5 }),
    };
    let n = 1;
    for (const a of Object.values(agents)) {
      await recordAgentPost(h.relay, {
        discordMessageId: msg(n),
        channelId: LOUNGE,
        threadId: null,
        agentId: a.id,
        displayName: a.name,
        content: `hello from ${a.name}`,
        relayMessageId: 'msg_01JB7Q2M8R',
        createdAt: at(0, n),
      });
      n++;
    }
    await push(h, human(10));
    return { h, agents };
  }

  it('through one joined query, with no lookup per agent', async () => {
    const { h } = await conversationOfAgents();
    let queries = 0;
    const prepare = h.db.prepare.bind(h.db);
    h.db.prepare = (sql: string) => {
      queries++;
      return prepare(sql);
    };
    const page = ConversationPage.parse(await readPage(h.relay, LOUNGE, {}));
    expect(queries).toBe(1);
    const levels = Object.fromEntries(page.messages.map((m) => [m.author.display_name, m.author.level]));
    expect(levels).toEqual({ 'Fresh-1': 0, 'Middle-1': 2, 'Senior-1': 5, 'Moth-9': 1, Luna: undefined });
    expect(page.messages.find((m) => m.author.kind === 'human')!.author).not.toHaveProperty('level');
  });

  it('follow a level change', async () => {
    const { h, agents } = await conversationOfAgents();
    const level = async () => (await readPage(h.relay, LOUNGE, {})).messages.find((m) => m.author.agent_id === agents.fresh.id)!.author.level;
    expect(await level()).toBe(0);
    await h.db.prepare('UPDATE agents SET level = 3 WHERE id = ?').bind(agents.fresh.id).run();
    expect(await level()).toBe(3);
  });

  it('are served over the API', async () => {
    const { h, agents } = await conversationOfAgents();
    const res = await h.call('GET', `/v1/channels/${LOUNGE}/messages`, undefined, h.as(agents.middle.token));
    const page = ConversationPage.parse(await res.json());
    expect(
      page.messages
        .filter((m) => m.author.kind === 'agent')
        .map((m) => m.author.level)
        .sort(),
    ).toEqual([0, 1, 2, 5]);
  });

  it('are left out by queries that don’t join agents, without breaking them', () => {
    const row: ConversationRow = {
      message_id: msg(1),
      channel_id: LOUNGE,
      thread_id: null,
      author_kind: 'agent',
      agent_id: 'agt_01JB7Q2M8R',
      author_ref: 'agt_01JB7Q2M8R',
      discord_user_id: null,
      display_name: 'Moth-9',
      content: 'hi',
      relay_message_id: null,
      created_at: at(0, 1),
      edited_at: null,
      deleted_at: null,
      removed_by: null,
      reply_to: null,
      withdrawn: 0,
    };
    expect(toConversationMessage(row).author).not.toHaveProperty('level');
    expect(toConversationMessage({ ...row, agent_level: 2 }).author.level).toBe(2);
    // A person never gets a level, whatever the row says.
    expect(toConversationMessage({ ...row, author_kind: 'human', agent_id: null, agent_level: 2 }).author).not.toHaveProperty('level');
  });
});
