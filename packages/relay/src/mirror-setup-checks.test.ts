import { describe, expect, it } from 'vitest';
import { BENCH, FORUM, GUILD, LOUNGE, harness, seedChannel, seedOwner } from './testing';
import { runSetup } from './services/setup';
import {
  BOT_ROLE,
  EXISTING_HOOK,
  P,
  admin,
  allow,
  bits,
  check,
  connectGateway,
  deny,
  discordError,
  discordWorld,
  named,
  overwrites,
  runChecks,
  type World,
} from './mirror.testkit';

async function ready(opts: Parameters<typeof harness>[0] = {}) {
  const h = harness({ moderator: named('jev'), ...opts });
  const world = discordWorld(h);
  await seedChannel(h.relay, { id: LOUNGE, name: 'lounge', access: 'post' });
  await connectGateway(h);
  const a = await admin(h);
  return { h, world, ...a, run: () => runChecks(h, a.as) };
}

const channelId = (id: string, part: string) => `channel:${id}:${part}`;

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
      'channels-relayed',
      channelId(LOUNGE, 'webhook'),
      channelId(LOUNGE, 'history'),
      channelId(LOUNGE, 'threads'),
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
    for (const key of [
      'GET /users/@me',
      'GET /applications/@me',
      'GET /guilds/100000000000000001/roles',
      'GET /guilds/100000000000000001/channels',
      `GET /webhooks/${EXISTING_HOOK}/token-${LOUNGE}`,
    ])
      world.overrides[key] = down;
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
    expect(checks).toHaveLength(12);

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

describe('each relayed channel', () => {
  it('checks only channels that are relayed (agents can use it)', async () => {
    const { h, run } = await ready();
    await seedChannel(h.relay, { id: BENCH, name: 'bench', access: 'off' });
    expect((await run()).some((c) => c.id.startsWith(`channel:${BENCH}`))).toBe(false);
    await h.db.prepare("UPDATE channels SET agent_access = 'read_only' WHERE id = ?").bind(BENCH).run();
    expect((await run()).some((c) => c.id.startsWith(`channel:${BENCH}`))).toBe(true);
  });

  it('warns when nothing is relayed yet', async () => {
    const { h, run } = await ready();
    await h.db.prepare('DELETE FROM channels').run();
    expect(check(await run(), 'channels-relayed')).toMatchObject({ status: 'warn', fix: expect.stringContaining('Relay') });
  });

  describe('webhook', () => {
    const id = channelId(LOUNGE, 'webhook');

    it('fails when a channel agents post in has no webhook, but a read-only one needs none', async () => {
      const { h, run } = await ready();
      await h.db.prepare('UPDATE channels SET webhook_ciphertext = NULL, webhook_id = NULL WHERE id = ?').bind(LOUNGE).run();
      expect(check(await run(), id)).toMatchObject({ status: 'fail', detail: '#lounge has no webhook, so agents can’t post.' });
      await h.db.prepare("UPDATE channels SET agent_access = 'read_only' WHERE id = ?").bind(LOUNGE).run();
      expect(check(await run(), id)).toMatchObject({ status: 'ok', detail: expect.stringContaining('no webhook is needed') });
    });

    it('fails when the webhook posts to a different channel or has been deleted', async () => {
      const { world, run } = await ready();
      world.webhooks[EXISTING_HOOK] = BENCH;
      const wrong = check(await run(), id);
      expect(wrong).toMatchObject({ status: 'fail', detail: expect.stringContaining('different channel') });
      expect(wrong.fix).toContain('relay the channel again');
      delete world.webhooks[EXISTING_HOOK];
      const gone = check(await run(), id);
      expect(gone).toMatchObject({ status: 'fail', detail: expect.stringContaining('no longer knows') });
    });

    it('is unknown, not failed, when Discord can’t say', async () => {
      const { world, run } = await ready();
      world.overrides[`GET /webhooks/${EXISTING_HOOK}/token-${LOUNGE}`] = discordError(502, 0);
      expect(check(await run(), id)).toMatchObject({ status: 'unknown', detail: 'Discord answered HTTP 502.' });
    });
  });

  describe('bot permissions', () => {
    const id = channelId(LOUNGE, 'history');
    const withOverwrites = async (extra: ReturnType<typeof deny>[], base?: (w: World) => void) => {
      const t = await ready();
      base?.(t.world);
      t.world.channels[0]!.permission_overwrites = overwrites(...extra);
      return check(await t.run(), id);
    };

    it('needs View Channel and Read Message History', async () => {
      expect((await withOverwrites([])).status).toBe('ok');
      const noView = await withOverwrites([deny(BOT_ROLE, P.VIEW_CHANNEL)]);
      expect(noView).toMatchObject({ status: 'fail', detail: expect.stringContaining('can’t view #lounge') });
      expect(noView.fix).toContain('View Channel');
      const noHistory = await withOverwrites([deny(BOT_ROLE, P.READ_MESSAGE_HISTORY)]);
      expect(noHistory).toMatchObject({ status: 'fail', detail: expect.stringContaining('message history') });
      expect(noHistory.fix).toContain('Read Message History');
    });

    it('follows Discord’s overwrite order: a role allow beats the @everyone deny', async () => {
      const c = await withOverwrites([deny(GUILD, P.VIEW_CHANNEL), allow(BOT_ROLE, P.VIEW_CHANNEL)]);
      expect(c.status).toBe('ok');
    });

    it('lets a member overwrite for the bot beat a role deny', async () => {
      const t = await ready();
      t.world.channels[0]!.permission_overwrites = overwrites(deny(BOT_ROLE, P.READ_MESSAGE_HISTORY), {
        id: '900000000000000001',
        type: 1,
        allow: bits(P.READ_MESSAGE_HISTORY),
        deny: '0',
      });
      expect(check(await t.run(), id).status).toBe('ok');
    });

    it('treats a denied View Channel as denying everything else, even if History is allowed', async () => {
      const c = await withOverwrites([{ id: BOT_ROLE, type: 0, allow: bits(P.READ_MESSAGE_HISTORY), deny: bits(P.VIEW_CHANNEL) }]);
      expect(c.detail).toContain('can’t view');
    });

    it('lets Administrator through every overwrite', async () => {
      const c = await withOverwrites(
        [deny(BOT_ROLE, P.VIEW_CHANNEL, P.READ_MESSAGE_HISTORY)],
        (w) => (w.roles.find((r) => r.id === BOT_ROLE)!.permissions = bits(P.ADMINISTRATOR)),
      );
      expect(c.status).toBe('ok');
    });

    it('fails when Discord doesn’t show the channel to the bot', async () => {
      const t = await ready();
      t.world.channels = [];
      const c = check(await t.run(), id);
      expect(c).toMatchObject({ status: 'fail', detail: expect.stringContaining('doesn’t show #lounge to the bot') });
    });

    it('is unknown for every channel check when the channel list can’t be fetched', async () => {
      const t = await ready();
      t.world.overrides[`GET /guilds/${GUILD}/channels`] = discordError(500, 0);
      const checks = await t.run();
      for (const part of ['history', 'threads']) expect(check(checks, channelId(LOUNGE, part)).status).toBe('unknown');
      expect(check(checks, channelId(LOUNGE, 'webhook')).status).toBe('ok');
    });
  });

  describe('threads', () => {
    const id = channelId(LOUNGE, 'threads');

    it('warns for a text channel when the bot can’t start threads, and fails if agents are meant to start them', async () => {
      const t = await ready();
      t.world.channels[0]!.permission_overwrites = overwrites(deny(BOT_ROLE, P.CREATE_PUBLIC_THREADS));
      const warned = check(await t.run(), id);
      expect(warned).toMatchObject({ status: 'warn', detail: expect.stringContaining('Create Public Threads') });
      expect(warned.fix).toContain('Create Public Threads');
      await t.h.db.prepare("UPDATE channels SET agent_access = 'post_new_threads' WHERE id = ?").bind(LOUNGE).run();
      expect(check(await t.run(), id)).toMatchObject({ status: 'fail', detail: expect.stringContaining('Agents can’t start new threads here') });
    });

    it('names both missing permissions', async () => {
      const t = await ready();
      t.world.channels[0]!.permission_overwrites = overwrites(deny(BOT_ROLE, P.CREATE_PUBLIC_THREADS, P.SEND_MESSAGES_IN_THREADS));
      const c = check(await t.run(), id);
      expect(c.detail).toContain('Create Public Threads and Send Messages in Threads');
    });

    it('applies to announcement channels but not to forum or media channels', async () => {
      const t = await ready();
      await seedChannel(t.h.relay, { id: BENCH, name: 'news', type: 'announcement', access: 'post_new_threads' });
      await seedChannel(t.h.relay, { id: FORUM, name: 'ideas', type: 'forum', access: 'post_new_threads' });
      const checks = await t.run();
      expect(checks.some((c) => c.id === channelId(BENCH, 'threads'))).toBe(true);
      expect(checks.some((c) => c.id === channelId(FORUM, 'threads'))).toBe(false);
    });
  });
});

describe('the Gateway', () => {
  const id = 'gateway';

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
