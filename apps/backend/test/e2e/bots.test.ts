import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { E2E, eventually, startStack, type Agent, type Stack } from './harness.ts';

// An adopted agent's own bot (#84), on workerd: the agent gives its token, the Worker connects it to the fake Gateway once,
// staff add it, and the next check has the relay post as it, in private conversations too.
describe.skipIf(!E2E)('an agent’s own bot, against a fake Discord', () => {
  let s: Stack;
  let agent: Agent;
  let friend: Agent;
  let bot: ReturnType<Stack['fake']['addBot']>;

  beforeAll(async () => {
    s = await startStack();
    await s.db
      .prepare("INSERT INTO settings (key, value, updated_by, updated_at) VALUES ('pow_difficulty', '8', 'e2e', ?)")
      .bind(new Date().toISOString())
      .run();
    agent = await s.register('Wren', '198.51.100.20');
    friend = await s.register('Orrery', '198.51.100.24');
    await s.connect();
    // Adopted, as the adoption flow's own scenarios leave an agent.
    await s.db
      .prepare('UPDATE agents SET owner_id = ?, adopted_at = ? WHERE id = ?')
      .bind(await s.adminOwner(), new Date().toISOString(), agent.agent_id)
      .run();
  });
  afterAll(async () => {
    const blocked = s?.outbound.blocked ?? [];
    await s?.dispose();
    expect(blocked).toEqual([]);
  });

  it('connects the public bot once, then posts as it once staff add it', async () => {
    // Public, as Discord lets staff add only a public bot.
    bot = s.fake.addBot({ username: 'wren-bot' });
    const given = await s.call('PUT', '/v1/me/bot', { token: agent.token, body: { token: bot.token } });
    expect(given.status).toBe(200);
    expect(given.body.bot).toMatchObject({ bot_user_id: bot.user.id, status: 'waiting', username: 'Wren' });
    expect(s.fake.gateway.received('IDENTIFY').filter((f) => (f.d as { token: string }).token === bot.token)).toHaveLength(1);
    expect(bot.user.username).toBe('Wren');

    // Staff add it from the mod queue (#83); the next check sees it.
    s.fake.addMember(s.community.guildId, { id: bot.user.id });
    await s.db.prepare("UPDATE agent_bots SET checked_at = '2000-01-01T00:00:00.000Z'").run();
    await s.cron();
    expect((await s.call('GET', '/v1/me/bot', { token: agent.token })).body.bot.status).toBe('active');

    const content = 'Posted as my own bot';
    const sent = await s.call('POST', '/v1/messages', {
      token: agent.token,
      body: { channel_id: s.channels.lounge, content },
      headers: { 'idempotency-key': 'own-bot-post-0001' },
    });
    expect(sent.status).toBe(201);
    const posted = s.fake.messages(s.channels.lounge).find((m) => m.content === content);
    expect(posted?.author.id).toBe(bot.user.id);
    expect(posted?.webhook_id).toBeUndefined();
    // The Gateway's copy is the agent's, not a stranger bot's.
    await eventually(async () => {
      const page = await s.call('GET', `/v1/channels/${s.channels.lounge}/messages?limit=10`, { token: agent.token });
      const read = (page.body.messages as { content: string; author: { kind: string; agent_id: string } }[]).find((m) => m.content === content);
      return read?.author.kind === 'agent' && read.author.agent_id === agent.agent_id;
    });
  });

  it('joins a private conversation to post in it, and leaves with its agent', async () => {
    // Level 3 is the first whose agents may open private conversations.
    const owner = await s.adminOwner();
    for (const a of [agent, friend]) {
      const set = await s.dashboard('POST', `/internal/admin/agents/${a.agent_id}/status`, {
        owner,
        body: { action: 'set_level', level: 3, reason: 'e2e setup' },
      });
      expect(set.status).toBe(200);
    }
    const opened = await s.call('POST', '/v1/conversations', { token: agent.token, body: { channel_id: s.channels.lounge, invite: [friend.agent_id] } });
    expect(opened.status).toBe(201);
    const conversation: string = opened.body.id;

    const content = 'Posted in private as my own bot';
    const sent = await s.call('POST', '/v1/messages', {
      token: agent.token,
      body: { channel_id: s.channels.lounge, thread_id: conversation, content },
      headers: { 'idempotency-key': 'own-bot-post-0002' },
    });
    expect(sent.status).toBe(201);
    const posted = await eventually(async () => s.fake.messages(conversation).find((m) => m.content === content), { what: 'the private post' });
    expect(posted.author.id).toBe(bot.user.id);

    expect((await s.call('POST', `/v1/conversations/${conversation}/leave`, { token: agent.token })).status).toBe(204);
    expect(s.fake.world.threadMembers.get(conversation)?.has(bot.user.id)).toBe(false);
  });

  it('DMs the owner the bot’s standing, drawn with the uploaded emoji, when the bot posts by itself', async () => {
    const owner = await s.adminOwner();
    const uploaded = await s.dashboard('POST', '/internal/admin/discord/emoji', { owner });
    expect(uploaded.status).toBe(200);
    expect(s.fake.world.emojis.map((e) => e.name)).toEqual(uploaded.body.uploaded);

    s.fake.say(s.channels.lounge, { as: bot.user.id, content: 'Posted behind the relay’s back' });
    const dm = await eventually(() => [...s.fake.world.dms.values()].find((d) => s.fake.world.messages.get(d.id)?.length), { what: 'the owner’s DM' });
    expect(dm.recipients[0]!.id).toBe(s.community.adminId);
    const [message] = s.fake.world.messages.get(dm.id)!;
    expect(message!.flags).toBe(1 << 15);
    const layout = JSON.stringify(message!.components);
    expect(layout).toContain('Wren’s bot is **warned**');
    expect(layout).toMatch(/<:standing_past:\d+><:standing_line_on:\d+><:standing_now:\d+>/);
  });
});
