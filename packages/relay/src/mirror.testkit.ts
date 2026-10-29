import { Permission } from '@logitland/discord';
import type { SetupCheck } from '@logitland/contracts';
import type { Moderator } from './services/moderation/classifier';
import { CONSENT_COMMAND } from './services/interactions';
import { STANDING_EMOJI } from './services/standing-emoji';
import { ADMIN_DISCORD, GUILD, application, seedOwner, type Harness } from './testing';

// A scriptable Discord for the setup tests: the application, the server's roles, the bot's membership and the commands that
// the harness's fake Discord answers from. Change the world, run the call, read h.discordCalls.

export const BOT = '900000000000000001';
export const APP = '400000000000000001';
export const BOT_ROLE = '500000000000000002';

export const P = Permission;
export const bits = (...flags: bigint[]) => String(flags.reduce((a, b) => a | b, 0n));

export interface RoleSpec {
  id: string;
  name: string;
  position: number;
  permissions: string;
  managed?: boolean;
}
export interface OverwriteSpec {
  id: string;
  type: 0 | 1;
  allow: string;
  deny: string;
}

export interface World {
  application: { id: string; name: string; flags: number; interactions_endpoint_url: string | null };
  roles: RoleSpec[];
  botRoles: string[];
  commands: { id: string; name: string; description: string; type: number; options: { type: number; name: string }[] }[];
  /** The application's emoji. */
  emoji: { id: string; name: string }[];
  /** Answers that replace the normal one, keyed `METHOD /path` (without /api/v10). */
  overrides: Record<string, () => Response>;
}

export const deny = (id: string, ...flags: bigint[]): OverwriteSpec => ({ id, type: 0, allow: '0', deny: bits(...flags) });

export function goodWorld(): World {
  return {
    application: { id: APP, name: 'Logitland', flags: 1 << 19, interactions_endpoint_url: 'https://relay.logitland.test/v1/discord/interactions' },
    roles: [
      {
        id: GUILD,
        name: '@everyone',
        position: 0,
        permissions: bits(P.VIEW_CHANNEL, P.SEND_MESSAGES, P.READ_MESSAGE_HISTORY, P.SEND_MESSAGES_IN_THREADS, P.CREATE_PUBLIC_THREADS),
      },
      { id: BOT_ROLE, name: 'Logitland Relay', position: 5, permissions: bits(P.MANAGE_WEBHOOKS) },
    ],
    botRoles: [BOT_ROLE],
    commands: [
      {
        id: '810000000000000001',
        name: CONSENT_COMMAND.name,
        description: CONSENT_COMMAND.description,
        type: CONSENT_COMMAND.type,
        options: CONSENT_COMMAND.options.map((o) => ({ type: o.type, name: o.name })),
      },
    ],
    emoji: Object.keys(STANDING_EMOJI).map((name, i) => ({ id: `82000000000000000${i}`, name })),
    overrides: {},
  };
}

const json = (body: unknown, status = 200) => Response.json(body, { status });
export const discordError =
  (status: number, code: number, message = 'Discord said no') =>
  () =>
    json({ code, message }, status);

/** Makes the harness's Discord answer from `world`. Returns the same object so tests can change it afterwards. */
export function discordWorld(h: Harness, world: World = goodWorld()): World {
  h.setDiscord(async (req) => {
    const path = new URL(req.url).pathname.replace('/api/v10', '');
    const key = `${req.method} ${path}`;
    const override = world.overrides[key];
    if (override) return override();
    let m: RegExpExecArray | null;
    if (key === 'GET /users/@me') return json({ id: BOT, username: 'logitland-relay', bot: true });
    if (key === 'GET /applications/@me') return json({ ...application([ADMIN_DISCORD]), ...world.application });
    if ((m = /^GET \/guilds\/\d+\/members\/(\d+)$/.exec(key)))
      return m[1] === BOT
        ? json({ user: { id: BOT, username: 'logitland-relay' }, roles: world.botRoles })
        : json({ message: 'Unknown Member', code: 10007 }, 404);
    if (/^GET \/guilds\/\d+\/roles$/.test(key)) return json(world.roles);
    if (/^GET \/applications\/\d+\/guilds\/\d+\/commands$/.test(key)) return json(world.commands);
    if (/^PUT \/applications\/\d+\/guilds\/\d+\/commands$/.test(key)) {
      const sent = (await req.json()) as { name: string; description: string; type: number; options: { type: number; name: string }[] }[];
      world.commands = sent.map((c, i) => ({ ...c, id: `81000000000000010${i}` }));
      return json(world.commands);
    }
    if (/^GET \/applications\/\d+\/emojis$/.test(key)) return json({ items: world.emoji });
    if (/^POST \/applications\/\d+\/emojis$/.test(key)) {
      const { name } = (await req.json()) as { name: string };
      const made = { id: `82000000000000010${world.emoji.length}`, name };
      world.emoji.push(made);
      return json(made);
    }
    return json({});
  });
  return world;
}

export const named = (name: NonNullable<Moderator['name']>): Moderator => ({ name, review: async () => ({ verdict: 'pass' as const }) });

export async function connectGateway(
  h: Harness,
  status = 'connected',
  over: Partial<{ updated_at: string; last_event_at: string | null; last_error: string | null }> = {},
) {
  await h.db
    .prepare("INSERT OR REPLACE INTO intake_state (source, status, last_event_at, last_heartbeat_at, last_error, updated_at) VALUES ('gateway', ?, ?, ?, ?, ?)")
    .bind(
      status,
      'last_event_at' in over ? over.last_event_at : '2026-10-19T02:59:00.000Z',
      '2026-10-19T02:59:30.000Z',
      over.last_error ?? null,
      over.updated_at ?? h.now().toISOString(),
    )
    .run();
}

export async function admin(h: Harness) {
  const owner = await seedOwner(h.relay, ADMIN_DISCORD, 'admin');
  return { owner, as: { 'x-logitland-owner': owner.id } };
}

export async function runChecks(h: Harness, as: Record<string, string>): Promise<SetupCheck[]> {
  const res = await h.internal('GET', '/internal/admin/setup', undefined, as);
  if (res.status !== 200) throw new Error(`setup answered ${res.status}: ${await res.text()}`);
  return ((await res.json()) as { checks: SetupCheck[] }).checks;
}

export const check = (checks: SetupCheck[], id: string): SetupCheck => {
  const found = checks.find((c) => c.id === id);
  if (!found) throw new Error(`no check ${id} in ${checks.map((c) => c.id).join(', ')}`);
  return found;
};
