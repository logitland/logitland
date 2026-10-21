import { describe, expect, it } from 'vitest';
import { BENCH, FORUM, GUILD, LOUNGE, harness, seedChannel, seedOwner } from './testing';
import { runSetup } from './services/setup';
import { updateSettings } from './services/settings';
import { BOT_ROLE, P, admin, check, connectGateway, deny, discordError, discordWorld, named, runChecks } from './mirror.testkit';

const AGENTS = '130000000000000001';
const ADOPTED = '130000000000000002';

async function ready(opts: Parameters<typeof harness>[0] = {}) {
  const h = harness({ moderator: named('jev'), ...opts });
  const world = discordWorld(h);
  for (const id of [AGENTS, ADOPTED])
    await h.db
      .prepare("INSERT INTO guild_roles (id, guild_id, name, permissions, updated_at) VALUES (?, ?, 'role', '0', ?)")
      .bind(id, GUILD, h.now().toISOString())
      .run();
  await updateSettings(h.relay, 'adm_test', { agents_role_id: AGENTS, adopted_role_id: ADOPTED });
  await seedChannel(h.relay, { id: LOUNGE, name: 'lounge', access: 'post' });
  await connectGateway(h);
  const a = await admin(h);
  return { h, world, ...a, run: () => runChecks(h, a.as) };
}

describe('GET /internal/admin/setup', () => {
  it('reports every check ok on a relay that is set up properly', async () => {
    const { run } = await ready();
    const checks = await run();
    expect(checks.map((c) => c.id)).toEqual([
      'bot-token',
      'bot-in-server',
      'message-content-intent',
      'interactions-url',
      'consent-command',
      'agent-roles',
      'agent-channels',
      'gateway',
      'classifier',
      'admins',
    ]);
    expect(checks.filter((c) => c.status !== 'ok')).toEqual([]);
    for (const c of checks) {
      expect(c.title).not.toBe('');
      expect(c.detail).not.toBe('');
      expect(c.fix).toBe('');
    }
  });

  it('is for admins only, and not on the public app', async () => {
    const { h } = await ready();
    const person = await seedOwner(h.relay, '200000000000000002', 'person');
    expect((await h.internal('GET', '/internal/admin/setup', undefined, { 'x-logitland-owner': person.id })).status).toBe(403);
    expect((await h.call('GET', '/internal/admin/setup')).status).toBe(404);
  });

  it('gives every check that is not ok a fix, and never leaks tokens or Discord’s own error text', async () => {
    const { h, world, run } = await ready();
    const down = discordError(500, 0, 'Discord said no');
    for (const key of ['GET /users/@me', 'GET /applications/@me', 'GET /guilds/100000000000000001/roles']) world.overrides[key] = down;
    world.overrides[`GET /applications/400000000000000001/guilds/${GUILD}/commands`] = discordError(403, 50001, 'Discord said no');
    await h.db.prepare("DELETE FROM intake_state WHERE source = 'gateway'").run();
    const checks = await run();
    const bad = checks.filter((c) => c.status !== 'ok');
    expect(bad.length).toBeGreaterThan(5);
    for (const c of bad) {
      expect(c.fix, c.id).not.toBe('');
      expect(`${c.title} ${c.detail} ${c.fix}`).not.toMatch(/Discord said no|test-bot-token|token-110/);
    }
  });
});

describe('the bot token and the bot’s place in the server', () => {
  it('fails clearly when Discord rejects the token, and says it is unknown when Discord is down', async () => {
    const { world, run } = await ready();
    world.overrides['GET /users/@me'] = discordError(401, 0);
    let checks = await run();
    expect(check(checks, 'bot-token')).toMatchObject({ status: 'fail', detail: 'Discord rejected the bot token.' });
    expect(check(checks, 'bot-token').fix).toContain('Reset Token');
    expect(check(checks, 'bot-in-server')).toMatchObject({ status: 'unknown' });
    expect(check(checks, 'bot-in-server').fix).toContain('bot token first');
    expect(checks).toHaveLength(10);

    world.overrides['GET /users/@me'] = discordError(500, 0);
    checks = await run();
    expect(check(checks, 'bot-token')).toMatchObject({ status: 'unknown', detail: 'Discord answered HTTP 500.' });
  });

  it('says so when the relay can’t reach Discord at all', async () => {
    const { world, run } = await ready();
    world.overrides['GET /users/@me'] = () => {
      throw new TypeError('fetch failed');
    };
    expect(check(await run(), 'bot-token')).toMatchObject({ status: 'unknown', detail: 'The relay couldn’t reach Discord.' });
  });

  it('fails when the bot isn’t in the server', async () => {
    const { world, run } = await ready();
    world.botRoles = [];
    world.overrides[`GET /guilds/${GUILD}/members/900000000000000001`] = discordError(404, 10007);
    const c = check(await run(), 'bot-in-server');
    expect(c.status).toBe('fail');
    expect(c.fix).toContain('URL Generator');
  });
});

describe('the Message Content intent', () => {
  it('is ok with either flag and fails without them', async () => {
    const { world, run } = await ready();
    world.application.flags = 1 << 18;
    expect(check(await run(), 'message-content-intent').status).toBe('ok');
    world.application.flags = 1 << 19;
    expect(check(await run(), 'message-content-intent').status).toBe('ok');
    world.application.flags = (1 << 12) | (1 << 15);
    const c = check(await run(), 'message-content-intent');
    expect(c.status).toBe('fail');
    expect(c.fix).toContain('Message Content Intent');
  });
});

describe('the interactions endpoint URL', () => {
  it('must be the relay’s own /v1/discord/interactions', async () => {
    const { world, run } = await ready();
    const expected = 'https://relay.logitland.test/v1/discord/interactions';
    world.application.interactions_endpoint_url = `${expected}/`;
    expect(check(await run(), 'interactions-url').status).toBe('ok');

    world.application.interactions_endpoint_url = null;
    let c = check(await run(), 'interactions-url');
    expect(c).toMatchObject({ status: 'fail', detail: expect.stringContaining('No Interactions Endpoint URL') });
    expect(c.fix).toContain(expected);

    world.application.interactions_endpoint_url = 'https://other.example/discord/interactions';
    c = check(await run(), 'interactions-url');
    expect(c.status).toBe('fail');
    expect(c.detail).toContain('https://other.example/discord/interactions');
    expect(c.detail).toContain(expected);
  });
});

describe('the /consent command', () => {
  it('must be registered with all three subcommands', async () => {
    const { world, run } = await ready();
    expect(check(await run(), 'consent-command').status).toBe('ok');

    world.commands[0]!.options = [{ type: 1, name: 'agree' }];
    let c = check(await run(), 'consent-command');
    expect(c).toMatchObject({ status: 'fail', detail: expect.stringContaining('“withdraw”, “status”') });
    expect(c.fix).toContain('Register commands');

    world.commands = [];
    c = check(await run(), 'consent-command');
    expect(c).toMatchObject({ status: 'fail', detail: 'The /consent command isn’t registered in the server.' });
  });

  it('ignores a same-named option that is not a subcommand', async () => {
    const { world, run } = await ready();
    world.commands[0]!.options = [
      { type: 3, name: 'agree' },
      { type: 1, name: 'withdraw' },
      { type: 1, name: 'status' },
    ];
    expect(check(await run(), 'consent-command').detail).toContain('“agree”');
  });

  it('fails when the relay doesn’t know its application or server', async () => {
    const h = harness({ env: { DISCORD_APPLICATION_ID: undefined, DISCORD_GUILD_ID: undefined } });
    discordWorld(h);
    const checks = (await runSetup(h.relay)).checks;
    expect(check(checks, 'consent-command')).toMatchObject({ status: 'fail', detail: expect.stringContaining('DISCORD_GUILD_ID') });
    expect(check(checks, 'bot-in-server').status).toBe('fail');
    const noApp = harness({ env: { DISCORD_APPLICATION_ID: undefined } });
    discordWorld(noApp);
    expect(check((await runSetup(noApp.relay)).checks, 'consent-command').detail).toContain('DISCORD_APPLICATION_ID');
  });
});

describe('the agent roles', () => {
  const id = 'agent-roles';

  it('fail without @agents or with a role the server no longer has, and warn without @adopted', async () => {
    const { h, run } = await ready();
    await updateSettings(h.relay, 'adm_test', { adopted_role_id: null });
    expect(check(await run(), id)).toMatchObject({ status: 'warn', detail: expect.stringContaining('No @adopted role') });
    await h.db.prepare('DELETE FROM guild_roles WHERE id = ?').bind(AGENTS).run();
    expect(check(await run(), id)).toMatchObject({ status: 'fail', detail: expect.stringContaining('isn’t in the server any more') });
    await updateSettings(h.relay, 'adm_test', { agents_role_id: null });
    const unmapped = check(await run(), id);
    expect(unmapped).toMatchObject({ status: 'fail', detail: expect.stringContaining('No @agents role') });
    expect(unmapped.fix).toContain('settings');
  });
});

describe('the agent channels', () => {
  const id = 'agent-channels';

  it('warn when no channel is open to agents', async () => {
    const { h, run } = await ready();
    await h.db.prepare('DELETE FROM channels').run();
    await seedChannel(h.relay, { id: BENCH, name: 'bench', access: 'off' });
    expect(check(await run(), id)).toMatchObject({ status: 'warn', fix: expect.stringContaining('View Channel') });
  });

  it('fail naming the channels the bot can’t view', async () => {
    const { h, run } = await ready();
    await seedChannel(h.relay, { id: BENCH, name: 'bench' });
    await h.db.prepare('UPDATE channels SET hidden = 1 WHERE id = ?').bind(BENCH).run();
    const c = check(await run(), id);
    expect(c).toMatchObject({ status: 'fail', detail: expect.stringContaining(BENCH) });
    expect(c.fix).toContain('View Channel');
  });

  it('fail where agents may post but the bot can’t make the webhook, and need none where agents only read', async () => {
    const { h, run } = await ready();
    await seedChannel(h.relay, { id: BENCH, name: 'bench', webhookUrl: null });
    await seedChannel(h.relay, { id: FORUM, name: 'notices', type: 'forum', access: 'read_only', webhookUrl: null });
    expect(check(await run(), id).status).toBe('ok');
    const noWebhooks = JSON.stringify([deny(BOT_ROLE, P.MANAGE_WEBHOOKS), deny(GUILD, P.SEND_MESSAGES, P.SEND_MESSAGES_IN_THREADS, P.CREATE_PUBLIC_THREADS)]);
    await h.db.prepare('UPDATE channels SET overwrites = ? WHERE id = ?').bind(noWebhooks, FORUM).run();
    expect(check(await run(), id).status).toBe('ok');
    await h.db
      .prepare('UPDATE channels SET overwrites = ? WHERE id = ?')
      .bind(JSON.stringify([deny(BOT_ROLE, P.MANAGE_WEBHOOKS)]), BENCH)
      .run();
    const c = check(await run(), id);
    expect(c).toMatchObject({ status: 'fail', detail: expect.stringContaining('#bench') });
    expect(c.detail).not.toContain('#notices');
    expect(c.fix).toContain('Manage Webhooks');
  });
});

describe('the Gateway', () => {
  const id = 'gateway';

  it('says when Discord last sent it something, in UTC and in words', async () => {
    const { h, run } = await ready();
    await connectGateway(h, 'connected', { last_event_at: '2026-10-19T02:59:22.267Z' });
    expect(check(await run(), id)).toMatchObject({
      status: 'ok',
      detail: 'Connected. The last thing Discord sent it was at 2026-10-19 02:59 UTC (less than a minute ago).',
    });
    h.advance(3 * 60_000);
    await connectGateway(h, 'connected', { last_event_at: '2026-10-19T00:30:00.000Z' });
    expect(check(await run(), id).detail).toBe('Connected. The last thing Discord sent it was at 2026-10-19 00:30 UTC (2 hours ago).');
  });

  it('warns before it has reported, is ok when connected, and says when it went quiet', async () => {
    const { h, run } = await ready();
    await h.db.prepare("DELETE FROM intake_state WHERE source = 'gateway'").run();
    expect(check(await run(), id)).toMatchObject({ status: 'warn', detail: expect.stringContaining('hasn’t reported') });
    await connectGateway(h);
    expect(check(await run(), id)).toMatchObject({ status: 'ok', detail: expect.stringContaining('Connected') });
    await connectGateway(h, 'connected', { last_event_at: null });
    expect(check(await run(), id).detail).toBe('Connected. Discord hasn’t sent it anything yet since it started.');
    h.advance(6 * 60_000);
    expect(check(await run(), id)).toMatchObject({ status: 'warn', detail: expect.stringContaining('hasn’t reported for 6 minutes') });
  });

  it('warns while it is still connecting and fails when it has stopped', async () => {
    const { h, run } = await ready();
    for (const status of ['connecting', 'resuming', 'reconnecting', 'waiting: Discord asked the relay to slow down']) {
      await connectGateway(h, status);
      expect(check(await run(), id)).toMatchObject({ status: 'warn', detail: `The Gateway is ${status}.` });
    }
    await connectGateway(h, 'stopped: Discord rejected the bot token. Check DISCORD_BOT_TOKEN', { last_error: 'close code 4004' });
    const stopped = check(await run(), id);
    expect(stopped).toMatchObject({ status: 'fail', detail: 'The Gateway has stopped: Discord rejected the bot token. Check DISCORD_BOT_TOKEN.' });
    expect(stopped.fix).toContain('close code 4004');
  });
});

describe('the classifier', () => {
  const id = 'classifier';
  const status = async (opts: Parameters<typeof harness>[0]) => check(await (await ready(opts)).run(), id);

  it('is ok with Jev and warns when only the development stub is checking messages', async () => {
    expect(await status({})).toMatchObject({ status: 'ok' });
    expect(await status({ moderator: named('dev') })).toMatchObject({ status: 'warn', detail: expect.stringContaining('development stub') });
  });

  it('fails with no classifier at all, and is unknown when the build can’t say', async () => {
    const none = await status({ moderator: named('unconfigured') });
    expect(none).toMatchObject({ status: 'fail' });
    expect(none.fix).toContain('TYPESAFE_API_KEY');
    expect(await status({ moderator: { review: async () => ({ verdict: 'pass' as const }) } })).toMatchObject({ status: 'unknown' });
  });
});

describe('admins', () => {
  it('fail when nobody is set as an admin', async () => {
    const h = harness({ env: { ADMIN_DISCORD_IDS: '' } });
    discordWorld(h);
    expect(check((await runSetup(h.relay)).checks, 'admins')).toMatchObject({ status: 'fail', fix: expect.stringContaining('ADMIN_DISCORD_IDS') });
  });

  it('count the people who can use the admin pages', async () => {
    const h = harness({ env: { ADMIN_DISCORD_IDS: '200000000000000099,200000000000000098' } });
    discordWorld(h);
    expect(check((await runSetup(h.relay)).checks, 'admins').detail).toBe('2 people can use the admin pages.');
  });
});
