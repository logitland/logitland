import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ALL_BOT_PERMISSIONS, Permission } from '../../../../packages/discord-fake/src/index.ts';
import { E2E, eventually, startStack, type Stack } from './harness.ts';

// The admin's setup path: register the /consent command, map @agents, and open channels to agents in Discord itself. The
// relay learns the server from the Gateway and makes each channel's webhook when an agent first posts there. Every REST
// call the relay makes goes to the fake.
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
    s = await startStack({ ready: false });
    admin = await s.adminOwner();
  });
  afterAll(async () => {
    const blocked = s?.outbound.blocked ?? [];
    await s?.dispose();
    expect(blocked).toEqual([]);
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

  it('opens a channel to agents in Discord: the relay sees it through the Gateway and makes its webhook on the first post', async () => {
    const chatting = Permission.sendMessages | Permission.sendMessagesInThreads | Permission.createPublicThreads;
    const bot = { id: s.fake.world.guild(s.community.guildId).botRoleId, allow: ALL_BOT_PERMISSIONS };
    const everyoneOut = { id: s.community.guildId, deny: Permission.viewChannel };
    const workshop = s.fake.addChannel(s.community.guildId, { name: 'workshop', overwrites: [everyoneOut, bot] });

    // The Gateway connects and reports the server. Until @agents is mapped, the checklist says so.
    await s.connect();
    expect((await checks()).gateway).toMatchObject({ status: 'ok' });
    expect((await checks())['agent-roles']).toMatchObject({ status: 'fail', detail: expect.stringContaining('No @agents role') });

    const mapped = await s.dashboard('PATCH', '/internal/admin/settings', { owner: admin, body: { agents_role_id: s.community.agentsRoleId } });
    expect(mapped.status).toBe(200);
    const report = await checks();
    expect(Object.values(report).filter((c) => c.status === 'fail' || c.status === 'unknown')).toEqual([]);
    expect(report['agent-roles']!.status).toBe('warn');

    // The workshop is private, so agents don't see it.
    const agent = await s.register('Lantern', '198.51.100.40');
    const listed = async () =>
      ((await s.call('GET', '/v1/channels', { token: agent.token })).body.channels as { id: string }[]).find((c) => c.id === workshop.id);
    expect(await listed()).toBeUndefined();

    // The admin lets @agents in.
    s.fake.world.updateChannel(workshop.id, { overwrites: [everyoneOut, { id: s.community.agentsRoleId, allow: Permission.viewChannel | chatting }, bot] });
    expect(await eventually(listed, { what: 'the workshop to open to agents' })).toMatchObject({
      name: 'workshop',
      type: 'text',
      can_post: true,
      can_post_in_threads: true,
      can_start_threads: true,
      can_post_links: false,
    });
    const hasWebhook = async () =>
      (await s.dashboard('GET', '/internal/admin/channels', { owner: admin })).body.channels.find((c: { id: string }) => c.id === workshop.id).has_webhook;
    expect(await hasWebhook()).toBe(false);

    s.fake.reset();
    const post = (content: string, key: string) =>
      s.call('POST', '/v1/messages', { token: agent.token, body: { channel_id: workshop.id, content }, headers: { 'idempotency-key': key } });
    const sent = await post('First words through a new webhook', 'setup-first-post');
    expect(sent.status).toBe(201);
    const [created] = s.fake.requestsTo('channel.webhooks.create');
    expect(created).toMatchObject({ params: { channel: workshop.id }, body: { name: 'Logitland agents' }, status: 200 });
    expect(created!.headers.authorization).toBe(`Bot ${s.fake.botToken}`);
    const hook = (await s.relayWebhook(workshop.id))!;
    expect(s.fake.requestsTo('webhook.execute').map((r) => r.params.id)).toEqual([hook.id]);
    expect(s.fake.messages(workshop.id).map((m) => m.content)).toEqual(['First words through a new webhook']);
    expect(await hasWebhook()).toBe(true);

    // The next post uses the same webhook.
    expect((await post('And again', 'setup-second-post')).status).toBe(201);
    expect(s.fake.requestsTo('channel.webhooks.create')).toHaveLength(1);
    expect(s.fake.requestsTo('webhook.execute').map((r) => r.params.id)).toEqual([hook.id, hook.id]);
  });
});
