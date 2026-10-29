import type { RegisteredCommands, UploadedEmoji } from '@logitland/contracts';
import { describe, expect, it } from 'vitest';
import { CONSENT_COMMAND } from './services/interactions';
import { GUILD, harness, seedOwner, type Harness } from './testing';
import { APP, admin, check, discordError, discordWorld, runChecks } from './mirror.testkit';

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
  it('registers the /consent command from the one shared definition and audits it', async () => {
    const { h, world, owner, as } = await ready();
    world.commands = [];
    const res = await h.internal('POST', '/internal/admin/discord/commands', undefined, as);
    expect(res.status).toBe(200);
    expect((await res.json()) as RegisteredCommands).toEqual({
      commands: [{ id: '810000000000000100', name: 'consent', subcommands: ['agree', 'withdraw', 'status'] }],
    });

    expect(h.discordCalls.map(path)).toEqual([`PUT /applications/${APP}/guilds/${GUILD}/commands`]);
    expect(h.discordCalls[0]!.headers.get('authorization')).toBe('Bot test-bot-token');
    expect(await h.discordCalls[0]!.json()).toEqual([JSON.parse(JSON.stringify(CONSENT_COMMAND))]);
    expect(await audit(h, 'discord.%')).toEqual([
      {
        actor_type: 'admin',
        actor_id: owner.id,
        action: 'discord.commands_registered',
        target_type: 'discord',
        target_id: GUILD,
        diff: JSON.stringify({ commands: { from: null, to: ['consent'] } }),
      },
    ]);
  });

  it('turns the setup check from fail to ok', async () => {
    const { h, world, as } = await ready();
    world.commands = [];
    const before = ((await (await h.internal('GET', '/internal/admin/setup', undefined, as)).json()) as { checks: { id: string; status: string }[] }).checks;
    expect(before.find((c) => c.id === 'consent-command')!.status).toBe('fail');
    await h.internal('POST', '/internal/admin/discord/commands', undefined, as);
    const after = ((await (await h.internal('GET', '/internal/admin/setup', undefined, as)).json()) as { checks: { id: string; status: string }[] }).checks;
    expect(after.find((c) => c.id === 'consent-command')!.status).toBe('ok');
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

describe('POST /internal/admin/discord/emoji', () => {
  it('uploads only the standing emoji the application lacks, once, and turns the setup check from warn to ok', async () => {
    const { h, world, owner, as } = await ready();
    world.emoji = [{ id: '820000000000000001', name: 'standing_past' }];
    expect(check(await runChecks(h, as), 'standing-emoji').status).toBe('warn');

    const first = await h.internal('POST', '/internal/admin/discord/emoji', undefined, as);
    expect((await first.json()) as UploadedEmoji).toEqual({
      uploaded: ['standing_now', 'standing_banned', 'standing_next', 'standing_line_on', 'standing_line_off'],
    });
    const posts = h.discordCalls.filter((r) => path(r) === `POST /applications/${APP}/emojis`);
    expect(posts).toHaveLength(5);
    expect(await posts[0]!.json()).toEqual({ name: 'standing_now', image: expect.stringMatching(/^data:image\/png;base64,iVBORw0KGgo/) });

    const again = await h.internal('POST', '/internal/admin/discord/emoji', undefined, as);
    expect((await again.json()) as UploadedEmoji).toEqual({ uploaded: [] });
    expect(h.discordCalls.filter((r) => path(r) === `POST /applications/${APP}/emojis`)).toHaveLength(5);
    expect(check(await runChecks(h, as), 'standing-emoji').status).toBe('ok');
    expect((await audit(h, 'discord.emoji%')).map((a) => [a.actor_id, a.target_id])).toEqual([[owner.id, APP]]);
  });
});
