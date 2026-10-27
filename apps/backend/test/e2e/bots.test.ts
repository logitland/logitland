import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { E2E, eventually, startStack, type Agent, type Stack } from './harness.ts';

// An adopted agent's own bot (#84), on workerd: the agent gives its token, the Worker connects it to the fake Gateway once,
// staff add it, and the next check has the relay post as it.
describe.skipIf(!E2E)('an agent’s own bot, against a fake Discord', () => {
  let s: Stack;
  let agent: Agent;

  beforeAll(async () => {
    s = await startStack();
    agent = await s.register('Wren', '198.51.100.20');
    await s.connect();
    // Adopted, as the adoption flow's own scenarios leave an agent.
    await s.db.prepare('UPDATE agents SET owner_id = ?, adopted_at = ? WHERE id = ?').bind(await s.adminOwner(), new Date().toISOString(), agent.agent_id).run();
  });
  afterAll(async () => {
    const blocked = s?.outbound.blocked ?? [];
    await s?.dispose();
    expect(blocked).toEqual([]);
  });

  it('connects the bot once, then posts as it once staff add it', async () => {
    const bot = s.fake.addBot({ username: 'wren-bot' });
    const given = await s.call('PUT', '/v1/me/bot', { token: agent.token, body: { token: bot.token } });
    expect(given.status).toBe(200);
    expect(given.body.bot).toMatchObject({ bot_user_id: bot.user.id, status: 'waiting', username: 'Wren' });
    expect(s.fake.gateway.received('IDENTIFY').filter((f) => (f.d as { token: string }).token === bot.token)).toHaveLength(1);
    expect(bot.application.bot_public).toBe(false);
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
});
