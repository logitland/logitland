import { Permission } from '@logitland/discord';
import type { SetupCheck } from '@logitland/contracts';
import type { Moderator } from './services/moderation/classifier';
import { ADMIN_DISCORD, GUILD, LOUNGE, seedOwner, type Harness } from './testing';

// A scriptable Discord for the setup tests: a server with roles, channels, commands and webhooks that the
// harness's fake Discord answers from. Change the world, run the call, read h.discordCalls.

export const BOT = '900000000000000001';
export const APP = '400000000000000001';
export const CONSENT_ROLE = '500000000000000001';
export const BOT_ROLE = '500000000000000002';
export const EXISTING_HOOK = '600000000000000001';
export const NEW_HOOK = '600000000000000777';
export const MANAGE_ROLES = 1n << 28n;
export const CREATE_PRIVATE_THREADS = 1n << 36n;

export const P = { ...Permission, MANAGE_ROLES, CREATE_PRIVATE_THREADS };
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
export interface ChannelSpec {
  id: string;
  guild_id?: string;
  name: string;
  type: number;
  parent_id?: string | null;
  position?: number;
  permission_overwrites?: OverwriteSpec[];
  available_tags?: { id: string; name: string; moderated?: boolean }[];
}

export interface World {
  application: { id: string; name: string; flags: number; interactions_endpoint_url: string | null };
  roles: RoleSpec[];
  botRoles: string[];
  channels: ChannelSpec[];
  commands: { id: string; name: string; description: string; type: number; options: { type: number; name: string }[] }[];
  /** webhook id → the channel it posts to */
  webhooks: Record<string, string>;
  /** Answers that replace the normal one, keyed `METHOD /path` (without /api/v10). */
  overrides: Record<string, () => Response>;
  createdHooks: number;
  messages: number;
}

/**
 * How a channel should be set up: @everyone can't send or start threads, the consent role can send, and the bot's role gets
 * its own allow (a role's server-wide permission doesn't survive an @everyone deny in the channel).
 */
export const enforced = (): OverwriteSpec[] => [
  { id: GUILD, type: 0, allow: '0', deny: bits(P.SEND_MESSAGES, P.SEND_MESSAGES_IN_THREADS, P.CREATE_PUBLIC_THREADS, P.CREATE_PRIVATE_THREADS) },
  { id: CONSENT_ROLE, type: 0, allow: bits(P.SEND_MESSAGES, P.SEND_MESSAGES_IN_THREADS), deny: '0' },
  { id: BOT_ROLE, type: 0, allow: bits(P.SEND_MESSAGES, P.SEND_MESSAGES_IN_THREADS, P.CREATE_PUBLIC_THREADS), deny: '0' },
];

export const deny = (id: string, ...flags: bigint[]): OverwriteSpec => ({ id, type: 0, allow: '0', deny: bits(...flags) });
export const allow = (id: string, ...flags: bigint[]): OverwriteSpec => ({ id, type: 0, allow: bits(...flags), deny: '0' });

/** One overwrite per ID, as Discord stores them: later entries for the same ID win bit by bit. */
export function overwrites(...entries: OverwriteSpec[]): OverwriteSpec[] {
  const byId = new Map<string, OverwriteSpec>();
  for (const e of entries) {
    const was = byId.get(e.id);
    if (!was) {
      byId.set(e.id, { ...e });
      continue;
    }
    byId.set(e.id, {
      ...e,
      allow: String((BigInt(was.allow) & ~BigInt(e.deny)) | BigInt(e.allow)),
      deny: String((BigInt(was.deny) & ~BigInt(e.allow)) | BigInt(e.deny)),
    });
  }
  return [...byId.values()];
}

export function goodWorld(): World {
  return {
    application: { id: APP, name: 'Logitland', flags: 1 << 19, interactions_endpoint_url: 'https://relay.logitland.test/discord/interactions' },
    roles: [
      {
        id: GUILD,
        name: '@everyone',
        position: 0,
        permissions: bits(
          P.VIEW_CHANNEL,
          P.SEND_MESSAGES,
          P.READ_MESSAGE_HISTORY,
          P.SEND_MESSAGES_IN_THREADS,
          P.CREATE_PUBLIC_THREADS,
          P.CREATE_PRIVATE_THREADS,
        ),
      },
      { id: CONSENT_ROLE, name: 'Chatter', position: 1, permissions: '0' },
      { id: BOT_ROLE, name: 'Logitland Relay', position: 5, permissions: bits(P.MANAGE_ROLES, P.MANAGE_WEBHOOKS) },
    ],
    botRoles: [BOT_ROLE],
    channels: [{ id: LOUNGE, name: 'lounge', type: 0, position: 0, permission_overwrites: enforced() }],
    commands: [
      {
        id: '810000000000000001',
        name: 'mirror',
        description: 'Join or leave the Logitland public mirror',
        type: 1,
        options: [
          { type: 1, name: 'agree' },
          { type: 1, name: 'leave' },
          { type: 1, name: 'status' },
        ],
      },
    ],
    webhooks: { [EXISTING_HOOK]: LOUNGE },
    overrides: {},
    createdHooks: 0,
    messages: 0,
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
    const channelOf = (id: string) => world.channels.find((c) => c.id === id);
    const withGuild = (c: ChannelSpec) => ({ guild_id: GUILD, ...c });
    let m: RegExpExecArray | null;
    if (key === 'GET /users/@me') return json({ id: BOT, username: 'logitland-relay', bot: true });
    if (key === 'GET /applications/@me') return json(world.application);
    if ((m = /^GET \/guilds\/\d+\/members\/(\d+)$/.exec(key)))
      return m[1] === BOT
        ? json({ user: { id: BOT, username: 'logitland-relay' }, roles: world.botRoles })
        : json({ message: 'Unknown Member', code: 10007 }, 404);
    if (/^GET \/guilds\/\d+\/roles$/.test(key)) return json(world.roles);
    if (/^GET \/guilds\/\d+\/channels$/.test(key)) return json(world.channels.map(withGuild));
    if (/^GET \/applications\/\d+\/guilds\/\d+\/commands$/.test(key)) return json(world.commands);
    if (/^PUT \/applications\/\d+\/guilds\/\d+\/commands$/.test(key)) {
      const sent = (await req.json()) as { name: string; description: string; type: number; options: { type: number; name: string }[] }[];
      world.commands = sent.map((c, i) => ({ ...c, id: `81000000000000010${i}` }));
      return json(world.commands);
    }
    if ((m = /^GET \/channels\/(\d+)$/.exec(key))) {
      const c = channelOf(m[1]!);
      return c ? json(withGuild(c)) : json({ message: 'Unknown Channel', code: 10003 }, 404);
    }
    if ((m = /^GET \/webhooks\/(\d+)\/[\w-]+$/.exec(key))) {
      const to = world.webhooks[m[1]!];
      return to ? json({ id: m[1], channel_id: to }) : json({ message: 'Unknown Webhook', code: 10015 }, 404);
    }
    if ((m = /^POST \/channels\/(\d+)\/webhooks$/.exec(key))) {
      world.createdHooks += 1;
      const id = world.createdHooks === 1 ? NEW_HOOK : String(BigInt(NEW_HOOK) + BigInt(world.createdHooks));
      world.webhooks[id] = m[1]!;
      return json({ id, token: `fresh-token-${id}`, channel_id: m[1], name: 'Logitland relay' });
    }
    if ((m = /^POST \/channels\/(\d+)\/messages$/.exec(key))) {
      world.messages += 1;
      return json({ id: `82000000000000000${world.messages}`, channel_id: m[1], content: '', timestamp: h.now().toISOString(), edited_timestamp: null });
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
