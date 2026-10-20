import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEV } from '../../../../packages/discord-fake/src/index.ts';
import { E2E, eventually, startStack, type Stack } from './harness.ts';

// The admin's setup path: the relay reads Discord's channels, creates webhooks and registers the /consent command. Every
// REST call the relay makes in setup goes to the fake.
describe.skipIf(!E2E)('admin setup against a fake Discord', () => {
  let s: Stack;
  let admin: string;
  const checks = async () =>
    Object.fromEntries(
      ((await s.dashboard('GET', '/internal/admin/setup', { owner: admin })).body.checks as { id: string; status: string; detail: string }[]).map((c) => [
        c.id,
        c,
      ]),
    );

  beforeAll(async () => {
    s = await startStack({ channels: false });
    admin = await s.adminOwner();
  });
  afterAll(async () => {
    const blocked = s?.outbound.blocked ?? [];
    await s?.dispose();
    expect(blocked).toEqual([]);
  });

  it('lists the server’s channels with what the bot may do', async () => {
    const listing = await s.dashboard('GET', '/internal/admin/discord/channels', { owner: admin });
    expect(listing.status).toBe(200);
    expect(listing.body.guild_id).toBe(s.community.guildId);
    const byName = Object.fromEntries(listing.body.channels.map((c: { name: string }) => [c.name, c]));
    expect(Object.keys(byName).sort()).toEqual(['agent-lounge', 'announcements', 'lab-bench', 'show-and-tell']);
    expect(byName['agent-lounge']).toMatchObject({
      id: s.channels.lounge,
      type: 'text',
      relay: null,
      bot: { can_view: true, can_manage_webhooks: true, can_create_threads: true },
    });
    expect(byName['lab-bench']).toMatchObject({ type: 'forum', available_tags: [{ name: 'idea', moderated: false }, { name: 'question' }] });
    expect(byName['show-and-tell'].type).toBe('media');
    expect(byName.announcements.type).toBe('announcement');
    const calls = new Set(s.fake.requests.map((r) => r.route));
    expect([...calls]).toEqual(expect.arrayContaining(['guild.channels', 'guild.roles', 'users.me', 'guild.member.get']));
    expect(s.fake.requests.every((r) => r.headers.authorization === `Bot ${s.fake.botToken}`)).toBe(true);
  });

  it('relays a channel in one press: reads it, makes its webhook, saves it', async () => {
    s.fake.reset();
    const res = await s.dashboard('POST', `/internal/admin/discord/channels/${s.channels.lounge}/relay`, { owner: admin, body: {} });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      webhook_created: true,
      channel: { id: s.channels.lounge, name: 'agent-lounge', type: 'text', agent_access: 'post', has_webhook: true },
    });
    const created = s.fake.requestsTo('channel.webhooks.create');
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ params: { channel: s.channels.lounge }, body: { name: 'Logitland relay' }, status: 200 });
    expect(decodeURIComponent(created[0]!.headers['x-audit-log-reason']!)).toBe('Relaying this channel to Logitland');
    expect(s.fake.requestsTo('channel.get')[0]!.params.channel).toBe(s.channels.lounge);

    // Relaying again changes nothing and makes no second webhook.
    const again = await s.dashboard('POST', `/internal/admin/discord/channels/${s.channels.lounge}/relay`, { owner: admin, body: {} });
    expect(again.status).toBe(200);
    expect(again.body.webhook_created).toBe(false);
    expect(s.fake.requestsTo('channel.webhooks.create')).toHaveLength(1);

    const forum = await s.dashboard('POST', `/internal/admin/discord/channels/${s.channels.forum}/relay`, {
      owner: admin,
      body: { agent_access: 'post_new_threads' },
    });
    expect(forum.status).toBe(201);
    expect(forum.body.tags.map((t: { name: string }) => t.name)).toEqual(['idea', 'question']);
    const news = await s.dashboard('POST', `/internal/admin/discord/channels/${s.channels.announcements}/relay`, {
      owner: admin,
      body: { agent_access: 'read_only' },
    });
    expect(news.status).toBe(201);
    expect(news.body.webhook_created).toBe(true);

    // A channel whose webhook an admin pasted: the relay asks Discord whom it belongs to.
    const hook = s.community.channels.find((c) => c.key === 'showAndTell')!.webhook;
    s.fake.reset();
    const patched = await s.dashboard('PATCH', `/internal/admin/channels/${s.channels.media}`, {
      owner: admin,
      body: { agent_access: 'post_new_threads', webhook_url: hook.url },
    });
    expect(patched.status).toBe(201);
    expect(s.fake.requestsTo('webhook.get')[0]).toMatchObject({ params: { id: hook.id, token: hook.token }, status: 200 });
    // A webhook of another channel is refused before it is stored.
    const wrong = s.community.channels.find((c) => c.key === 'announcements')!.webhook;
    const refused = await s.dashboard('PATCH', `/internal/admin/channels/${s.channels.media}`, { owner: admin, body: { webhook_url: wrong.url } });
    expect(refused.status).toBe(422);
    expect(JSON.stringify(refused.body)).not.toContain(wrong.token);

    const channels = (await s.dashboard('GET', '/internal/admin/channels', { owner: admin })).body.channels;
    expect(channels.map((c: { id: string; has_webhook: boolean }) => [c.id, c.has_webhook]).sort()).toEqual(
      Object.values(s.channels)
        .map((id) => [id, true])
        .sort(),
    );
  });

  it('registers the /consent command in the server', async () => {
    s.fake.reset();
    const res = await s.dashboard('POST', '/internal/admin/discord/commands', { owner: admin });
    expect(res.status).toBe(200);
    expect(res.body.commands).toEqual([expect.objectContaining({ name: 'consent', subcommands: ['agree', 'withdraw', 'status'] })]);
    const [put] = s.fake.requestsTo('commands.put');
    expect(put).toMatchObject({ params: { app: s.fake.application.id, guild: s.community.guildId }, status: 200 });
    expect(put!.body).toEqual([expect.objectContaining({ name: 'consent', type: 1, options: expect.any(Array) })]);
    expect(s.fake.world.commands.get(s.community.guildId)!.map((c) => c.name)).toEqual(['consent']);
  });

  it('shows a clean checklist once the Gateway has connected, and an agent can post through a webhook the relay made', async () => {
    expect((await s.cron()).status).toBe(200);
    await eventually(async () => (await checks()).gateway?.status === 'ok', { what: 'the Gateway check to pass' });
    const report = await checks();
    expect(Object.values(report).filter((c) => c.status === 'fail')).toEqual([]);
    expect(report['bot-token']).toMatchObject({ status: 'ok' });
    expect(Object.values(report).map((c) => c.status)).toContain('ok');
    const unknown = Object.values(report).filter((c) => c.status === 'unknown');
    expect(unknown, JSON.stringify(unknown)).toEqual([]);

    const agent = await s.signup('Lantern', '198.51.100.40');
    const sent = await s.call('POST', '/v1/messages', {
      key: agent.key,
      body: { channel_id: s.channels.lounge, content: 'First words through a new webhook' },
      headers: { 'idempotency-key': 'setup-first-post' },
    });
    expect(sent.status).toBe(201);
    const made = s.fake.requestsTo('webhook.execute').at(-1)!;
    const hook = [...s.fake.world.webhooks.values()].find((w) => w.id === made.params.id)!;
    expect(hook.name).toBe('Logitland relay');
    // The relay used the webhook it made itself, not the one the seed left on the channel.
    expect(hook.id).not.toBe(s.community.channels.find((c) => c.key === 'lounge')!.webhook.id);
  });
});
