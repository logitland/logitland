import type { ConsentMessage, RegisteredCommands } from '@logitland/contracts';
import { execFile } from 'node:child_process';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { consentNotice } from './services/consent';
import { AGREE_BUTTON, MIRROR_COMMAND } from './services/interactions';
import { FORUM, GUILD, LOUNGE, harness, seedOwner, type Harness } from './testing';
import { APP, admin, discordError, discordWorld } from './mirror.testkit';

const SCRIPT = fileURLToPath(new URL('../../../apps/backend/scripts/register-commands.mjs', import.meta.url));
const path = (r: Request) => `${r.method} ${new URL(r.url).pathname.replace('/api/v10', '')}`;
const audit = async (h: Harness, like: string) =>
  (
    await h.db
      .prepare('SELECT actor_type, actor_id, action, target_type, target_id, diff FROM audit_log WHERE action LIKE ? ORDER BY rowid')
      .bind(like)
      .all<{ actor_type: string; actor_id: string; action: string; target_type: string; target_id: string; diff: string }>()
  ).results;

async function ready() {
  const h = harness();
  const world = discordWorld(h);
  const a = await admin(h);
  return { h, world, ...a };
}

describe('POST /internal/admin/discord/commands', () => {
  it('registers the /mirror command from the one shared definition and audits it', async () => {
    const { h, world, owner, as } = await ready();
    world.commands = [];
    const res = await h.internal('POST', '/internal/admin/discord/commands', undefined, as);
    expect(res.status).toBe(200);
    expect((await res.json()) as RegisteredCommands).toEqual({
      commands: [{ id: '810000000000000100', name: 'mirror', subcommands: ['agree', 'leave', 'status'] }],
    });

    expect(h.discordCalls.map(path)).toEqual([`PUT /applications/${APP}/guilds/${GUILD}/commands`]);
    expect(h.discordCalls[0]!.headers.get('authorization')).toBe('Bot test-bot-token');
    expect(await h.discordCalls[0]!.json()).toEqual([JSON.parse(JSON.stringify(MIRROR_COMMAND))]);
    expect(await audit(h, 'discord.%')).toEqual([
      {
        actor_type: 'admin',
        actor_id: owner.id,
        action: 'discord.commands_registered',
        target_type: 'discord',
        target_id: GUILD,
        diff: JSON.stringify({ commands: { from: null, to: ['mirror'] } }),
      },
    ]);
  });

  it('turns the setup check from fail to ok', async () => {
    const { h, world, as } = await ready();
    world.commands = [];
    const before = ((await (await h.internal('GET', '/internal/admin/setup', undefined, as)).json()) as { checks: { id: string; status: string }[] }).checks;
    expect(before.find((c) => c.id === 'mirror-command')!.status).toBe('fail');
    await h.internal('POST', '/internal/admin/discord/commands', undefined, as);
    const after = ((await (await h.internal('GET', '/internal/admin/setup', undefined, as)).json()) as { checks: { id: string; status: string }[] }).checks;
    expect(after.find((c) => c.id === 'mirror-command')!.status).toBe('ok');
  });

  it('explains a refusal, a Discord outage and missing configuration, and is for admins only', async () => {
    const { h, world, as } = await ready();
    const put = `PUT /applications/${APP}/guilds/${GUILD}/commands`;
    world.overrides[put] = discordError(403, 20012, 'Missing Access');
    const refused = await h.internal('POST', '/internal/admin/discord/commands', undefined, as);
    expect(refused.status).toBe(422);
    expect(await refused.text()).not.toContain('Missing Access');
    world.overrides[put] = discordError(500, 0);
    expect((await h.internal('POST', '/internal/admin/discord/commands', undefined, as)).status).toBe(502);
    expect(await audit(h, 'discord.%')).toEqual([]);

    const person = await seedOwner(h.relay, '200000000000000002', 'person');
    expect((await h.internal('POST', '/internal/admin/discord/commands', undefined, { 'x-logitland-owner': person.id })).status).toBe(403);

    const bare = harness({ env: { DISCORD_APPLICATION_ID: undefined } });
    const other = await admin(bare);
    expect((await bare.internal('POST', '/internal/admin/discord/commands', undefined, other.as)).status).toBe(503);
  });
});

describe('apps/backend/scripts/register-commands.mjs', () => {
  async function runScript(respond: (req: IncomingMessage, body: string) => { status: number; json: unknown }) {
    const seen: { method?: string; url?: string; authorization?: string; body: string }[] = [];
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        seen.push({ method: req.method, url: req.url, authorization: req.headers.authorization, body });
        const out = respond(req, body);
        res.writeHead(out.status, { 'content-type': 'application/json' }).end(JSON.stringify(out.json));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const env = {
        PATH: process.env.PATH,
        DISCORD_APPLICATION_ID: APP,
        DISCORD_GUILD_ID: GUILD,
        DISCORD_BOT_TOKEN: 'script-test-token',
        DISCORD_API_BASE: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      };
      const result = await promisify(execFile)(process.execPath, [SCRIPT], { env }).then(
        (r) => ({ code: 0, stdout: r.stdout, stderr: r.stderr }),
        (e: { code: number; stdout: string; stderr: string }) => ({ code: e.code, stdout: e.stdout, stderr: e.stderr }),
      );
      return { seen, ...result };
    } finally {
      server.close();
    }
  }

  it('sends exactly the definition the setup page registers', async () => {
    const out = await runScript((_req, body) => ({
      status: 200,
      json: (JSON.parse(body) as { name: string }[]).map((c, i) => ({ ...c, id: `81000000000000020${i}` })),
    }));
    expect(out.code).toBe(0);
    expect(out.seen).toHaveLength(1);
    expect(out.seen[0]!.method).toBe('PUT');
    expect(out.seen[0]!.url).toBe(`/applications/${APP}/guilds/${GUILD}/commands`);
    expect(out.seen[0]!.authorization).toBe('Bot script-test-token');
    expect(JSON.parse(out.seen[0]!.body)).toEqual([JSON.parse(JSON.stringify(MIRROR_COMMAND))]);
    expect(out.stdout).toContain('Registered 1 command');
    expect(out.stdout).toContain('/mirror (agree, leave, status)');
    expect(out.stdout + out.stderr).not.toContain('script-test-token');
  });

  it('reports Discord’s refusal without the token and exits non-zero', async () => {
    const out = await runScript(() => ({ status: 403, json: { code: 50001, message: 'Missing Access' } }));
    expect(out.code).toBe(1);
    expect(out.stderr).toContain('HTTP 403');
    expect(out.stderr).toContain('Missing Access');
    expect(out.stderr).not.toContain('script-test-token');
  });
});

describe('POST /internal/admin/discord/consent-message', () => {
  const post = (h: Harness, as: Record<string, string>, channel_id: string) =>
    h.internal('POST', '/internal/admin/discord/consent-message', { channel_id }, as);

  it('has the bot post the explanation with an agree button and returns where it went', async () => {
    const { h, world, owner, as } = await ready();
    world.channels = [{ id: LOUNGE, name: 'welcome', type: 0 }];
    const res = await post(h, as, LOUNGE);
    expect(res.status).toBe(201);
    expect((await res.json()) as ConsentMessage).toEqual({
      channel_id: LOUNGE,
      message_id: '820000000000000001',
      url: `https://discord.com/channels/${GUILD}/${LOUNGE}/820000000000000001`,
    });

    expect(h.discordCalls.map(path)).toEqual([`GET /channels/${LOUNGE}`, `POST /channels/${LOUNGE}/messages`]);
    const sent = h.discordCalls[1]!;
    expect(sent.headers.get('authorization')).toBe('Bot test-bot-token');
    const payload = (await sent.json()) as { content: string; components: unknown; allowed_mentions: unknown };
    expect(payload.components).toEqual([{ type: 1, components: [{ type: 2, style: 1, label: 'I agree: let me chat', custom_id: 'mirror_agree' }] }]);
    expect(AGREE_BUTTON).toBe('mirror_agree');
    expect(payload.allowed_mentions).toEqual({ parse: [] });
    // The same notice that /mirror agree shows, pointing at the mirror site and not the relay.
    expect(payload.content).toBe(consentNotice(h.relay.config.dashboardUrl));
    expect(payload.content.length).toBeLessThanOrEqual(2000);
    expect(payload.content).toContain(`${h.relay.config.dashboardUrl}/privacy`);
    expect(payload.content).not.toContain(h.relay.config.publicUrl);
    expect(payload.content).toContain('/mirror leave');
    expect(payload.content).toContain('display name');

    expect(await audit(h, 'discord.%')).toEqual([
      {
        actor_type: 'admin',
        actor_id: owner.id,
        action: 'discord.consent_message_posted',
        target_type: 'channel',
        target_id: LOUNGE,
        diff: JSON.stringify({ message: { from: null, to: '820000000000000001' } }),
      },
    ]);
  });

  it('works in an announcement channel but refuses forum, media, voice and other-server channels', async () => {
    const { h, world, as } = await ready();
    world.channels = [
      { id: LOUNGE, name: 'news', type: 5 },
      { id: FORUM, name: 'ideas', type: 15 },
      { id: '110000000000000004', name: 'pictures', type: 16 },
      { id: '110000000000000005', name: 'voice', type: 2 },
      { id: '110000000000000006', guild_id: '999999999999999999', name: 'elsewhere', type: 0 },
    ];
    expect((await post(h, as, LOUNGE)).status).toBe(201);
    for (const id of [FORUM, '110000000000000004', '110000000000000005', '110000000000000006']) expect((await post(h, as, id)).status, id).toBe(422);
    expect(world.messages).toBe(1);
  });

  it('says what to do when the bot can’t post there, and when Discord is down', async () => {
    const { h, world, as } = await ready();
    world.channels = [{ id: LOUNGE, name: 'welcome', type: 0 }];
    world.overrides[`POST /channels/${LOUNGE}/messages`] = discordError(403, 50013, 'Missing Permissions');
    const refused = await post(h, as, LOUNGE);
    expect(refused.status).toBe(422);
    expect(((await refused.json()) as { detail: string }).detail).toContain('Send Messages');
    world.overrides[`POST /channels/${LOUNGE}/messages`] = discordError(502, 0);
    expect((await post(h, as, LOUNGE)).status).toBe(502);
    expect(await audit(h, 'discord.%')).toEqual([]);
  });

  it('validates the body and is for admins only', async () => {
    const { h, world, as } = await ready();
    world.channels = [{ id: LOUNGE, name: 'welcome', type: 0 }];
    expect((await h.internal('POST', '/internal/admin/discord/consent-message', {}, as)).status).toBe(400);
    expect((await h.internal('POST', '/internal/admin/discord/consent-message', { channel_id: 'general' }, as)).status).toBe(400);
    const person = await seedOwner(h.relay, '200000000000000002', 'person');
    expect((await post(h, { 'x-logitland-owner': person.id }, LOUNGE)).status).toBe(403);
    expect(world.messages).toBe(0);
  });
});
