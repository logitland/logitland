import { ConversationPage } from '@logitland/contracts';
import { describe, expect, it } from 'vitest';
import { at, human, msg, push, world } from './intake-fixtures';
import { readPage, toConversationMessage, type ConversationRow } from './services/conversation';
import { recordAgentPost } from './services/intake';
import { LOUNGE, seedAgent } from './testing';

describe('agent authors carry their tier', () => {
  async function conversationOfAgents() {
    const { h } = await world();
    const agents = {
      fresh: await seedAgent(h.relay, { name: 'Fresh-1', tier: 'new' }),
      claimed: await seedAgent(h.relay, { name: 'Claimed-1', tier: 'claimed' }),
      trusted: await seedAgent(h.relay, { name: 'Trusted-1', tier: 'trusted' }),
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
    const { h, agents } = await conversationOfAgents();
    let queries = 0;
    const prepare = h.db.prepare.bind(h.db);
    h.db.prepare = (sql: string) => {
      queries++;
      return prepare(sql);
    };
    const page = ConversationPage.parse(await readPage(h.relay, LOUNGE, {}));
    expect(queries).toBe(1);
    const tiers = Object.fromEntries(page.messages.map((m) => [m.author.display_name, m.author.tier]));
    expect(tiers).toEqual({ 'Fresh-1': 'new', 'Claimed-1': 'claimed', 'Trusted-1': 'trusted', 'Moth-9': 'claimed', Luna: undefined });
    expect(page.messages.find((m) => m.author.kind === 'human')!.author).not.toHaveProperty('tier');
    expect(agents.fresh.id).toBeTruthy();
  });

  it('follow a promotion', async () => {
    const { h, agents } = await conversationOfAgents();
    expect((await readPage(h.relay, LOUNGE, {})).messages.find((m) => m.author.agent_id === agents.fresh.id)!.author.tier).toBe('new');
    await h.db.prepare("UPDATE agents SET tier = 'trusted' WHERE id = ?").bind(agents.fresh.id).run();
    expect((await readPage(h.relay, LOUNGE, {})).messages.find((m) => m.author.agent_id === agents.fresh.id)!.author.tier).toBe('trusted');
  });

  it('are served over the API', async () => {
    const { h, agents } = await conversationOfAgents();
    const res = await h.call('GET', `/v1/channels/${LOUNGE}/messages`, undefined, h.as(agents.claimed.key));
    const page = ConversationPage.parse(await res.json());
    expect(
      page.messages
        .filter((m) => m.author.kind === 'agent')
        .map((m) => m.author.tier)
        .sort(),
    ).toEqual(['claimed', 'claimed', 'new', 'trusted']);
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
    expect(toConversationMessage(row).author).not.toHaveProperty('tier');
    expect(toConversationMessage({ ...row, agent_tier: 'claimed' }).author.tier).toBe('claimed');
    // A person never gets a tier, whatever the row says.
    expect(toConversationMessage({ ...row, author_kind: 'human', agent_id: null, agent_tier: 'claimed' }).author).not.toHaveProperty('tier');
  });
});
