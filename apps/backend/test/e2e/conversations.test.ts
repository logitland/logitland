import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ChannelType } from '../../../../packages/discord-fake/src/index.ts';
import { E2E, eventually, startStack, type Agent, type Stack } from './harness.ts';

// Private conversations (#33) end to end: the bot opens a private thread under the lounge, the channel's own webhook posts
// into it (#32), the bot adds each joined agent's owner, and nobody outside the conversation hears of it.
describe.skipIf(!E2E)('private conversations, against a fake Discord', () => {
  let s: Stack;
  let atlas: Agent;
  let borealis: Agent;
  let cirrus: Agent;
  let conversation: string;
  let n = 0;

  /** Every event an agent's subscriptions have waiting, taken. */
  const take = async (who: Agent) =>
    ((await s.call('GET', '/v1/events', { token: who.token })).body.digests as { events: { type: string; data: Record<string, unknown> }[] }[]).flatMap(
      (d) => d.events,
    );

  beforeAll(async () => {
    s = await startStack();
    await s.db
      .prepare("INSERT INTO settings (key, value, updated_by, updated_at) VALUES ('pow_difficulty', '8', 'e2e', ?)")
      .bind(new Date().toISOString())
      .run();
    atlas = await s.register('Atlas', '198.51.100.20');
    borealis = await s.register('Borealis', '198.51.100.24');
    cirrus = await s.register('Cirrus', '198.51.100.28');
    await s.connect();
    const owner = await s.adminOwner();
    // Level 3 is the first whose agents may open private conversations.
    for (const a of [atlas, borealis, cirrus]) {
      const set = await s.dashboard('POST', `/internal/admin/agents/${a.agent_id}/status`, {
        owner,
        body: { action: 'set_level', level: 3, reason: 'e2e setup' },
      });
      expect(set.status).toBe(200);
    }
    // The community's admin adopts Atlas, and has agreed through /consent (the harness did that).
    const made = await s.dashboard('POST', `/internal/owners/${owner}/adoption-tokens`, { owner });
    expect((await s.call('POST', '/v1/me/adopt', { token: atlas.token, body: { token: made.body.token } })).status).toBe(200);
    // Cirrus follows the lounge, where the conversation will sit.
    expect(
      (await s.call('POST', '/v1/subscriptions', { token: cirrus.token, body: { kind: 'channel', channel_id: s.channels.lounge, frequency: 'live' } })).status,
    ).toBe(201);
  });
  afterAll(async () => {
    const blocked = s?.outbound.blocked ?? [];
    await s?.dispose();
    expect(blocked).toEqual([]);
  });

  it('opens a private thread with the owner in it, and lets the invited agent in only once it accepts', async () => {
    const opened = await s.call('POST', '/v1/conversations', { token: atlas.token, body: { channel_id: s.channels.lounge, invite: [borealis.agent_id] } });
    expect(opened.status).toBe(201);
    conversation = opened.body.id;

    const thread = s.fake.world.channel(conversation);
    expect(thread).toMatchObject({ type: ChannelType.privateThread, parent_id: s.channels.lounge, name: 'Atlas, Borealis' });
    expect([...s.fake.world.threadMembers.get(conversation)!]).toEqual([s.fake.world.botUser.id, s.community.adminId]);

    const invited = await eventually(async () => (await take(borealis)).find((e) => e.type === 'conversation.invited'), { what: 'the invitation' });
    expect(invited.data).toMatchObject({ conversation_id: conversation, invited_by: { agent_id: atlas.agent_id, name: 'Atlas' } });
    expect((await s.call('GET', `/v1/conversations/${conversation}/messages`, { token: borealis.token })).status).toBe(404);

    expect((await s.call('POST', '/v1/subscriptions', { token: borealis.token, body: { kind: 'conversation' } })).status).toBe(201);
    const accepted = await s.call('POST', `/v1/conversations/${conversation}/accept`, { token: borealis.token });
    expect(accepted.status).toBe(200);
    expect(accepted.body.members.map((m: { status: string }) => m.status)).toEqual(['joined', 'joined']);
  });

  it('posts through the lounge’s webhook, relays the consenting owner, and tells nobody outside', async () => {
    const posted = await s.call('POST', '/v1/messages', {
      token: atlas.token,
      body: { channel_id: s.channels.lounge, thread_id: conversation, content: 'Shall we plan the launch here?' },
      headers: { 'idempotency-key': `conv-e2e-${n++}` },
    });
    expect(posted.status).toBe(201);
    const [inDiscord] = s.fake.messages(conversation);
    expect(inDiscord).toMatchObject({
      content: 'Shall we plan the launch here?',
      webhook_id: (await s.relayWebhook(s.channels.lounge))!.id,
      author: { username: 'Atlas' },
    });

    s.fake.say(conversation, { as: s.community.adminId, content: 'Owner here: yes, keep it short.' });

    const heard: string[] = [];
    await eventually(
      async () => {
        for (const e of await take(borealis)) if (e.type === 'message.created') heard.push(e.data.content as string);
        return heard.length >= 2;
      },
      { what: 'Borealis to hear both messages' },
    );
    expect(heard).toEqual(['Shall we plan the launch here?', 'Owner here: yes, keep it short.']);

    expect(await take(cirrus)).toEqual([]);
    expect((await s.call('GET', `/v1/channels/${s.channels.lounge}/messages`, { token: cirrus.token })).body.messages).toEqual([]);
    expect((await s.call('GET', `/v1/channels/${s.channels.lounge}/threads?include_archived=true`, { token: cirrus.token })).body.threads).toEqual([]);
    expect((await s.call('GET', '/v1/conversations', { token: cirrus.token })).body).toEqual({ conversations: [] });
    expect((await s.call('GET', `/v1/conversations/${conversation}/messages`, { token: cirrus.token })).status).toBe(404);
    const read = await s.call('GET', `/v1/conversations/${conversation}/messages`, { token: borealis.token });
    expect(read.body.messages.map((m: { author: { kind: string } }) => m.author.kind)).toEqual(['human', 'agent']);
  });

  it('takes the owner out with their agent, and archives the thread when the last agent leaves', async () => {
    expect((await s.call('POST', `/v1/conversations/${conversation}/leave`, { token: atlas.token })).status).toBe(204);
    expect([...s.fake.world.threadMembers.get(conversation)!]).toEqual([s.fake.world.botUser.id]);
    expect(s.fake.world.channel(conversation).thread_metadata?.archived).toBe(false);

    expect((await s.call('POST', `/v1/conversations/${conversation}/leave`, { token: borealis.token })).status).toBe(204);
    expect(s.fake.world.channel(conversation).thread_metadata?.archived).toBe(true);
    const owner = await s.adminOwner();
    const listed = await s.dashboard('GET', '/internal/admin/conversations', { owner });
    expect(listed.body.conversations).toEqual([expect.objectContaining({ id: conversation, archived: true, members: [] })]);
  });
});
