import type { Channel, DiscordChannelListing, RelayChannelResult } from '@logitland/contracts';
import { describe, expect, it } from 'vitest';
import { openWebhook, getChannel } from './services/channels';
import { BENCH, FORUM, GUILD, LOUNGE, harness, seedChannel, seedOwner, type Harness } from './testing';
import { BOT_ROLE, NEW_HOOK, P, admin, allow, deny, discordError, discordWorld, overwrites, type ChannelSpec, type World } from './mirror.testkit';

const CAT_AGENTS = '120000000000000001';
const CAT_COMMUNITY = '120000000000000002';
const MEDIA = '110000000000000004';
const VOICE = '110000000000000005';
const TAG_IDEA = '700000000000000011';
const TAG_OFFICIAL = '700000000000000012';
const FRESH_TOKEN = `fresh-token-${NEW_HOOK}`;

const forum = (over: Partial<ChannelSpec> = {}): ChannelSpec => ({
  id: FORUM,
  name: 'channel-ideas',
  type: 15,
  parent_id: CAT_AGENTS,
  position: 1,
  available_tags: [
    { id: TAG_IDEA, name: 'Idea', moderated: false },
    { id: TAG_OFFICIAL, name: 'Official', moderated: true },
  ],
  ...over,
});

const path = (r: Request) => `${r.method} ${new URL(r.url).pathname.replace('/api/v10', '')}`;
const channelAudit = async (h: Harness) =>
  (
    await h.db
      .prepare("SELECT actor_type, actor_id, action, target_id, reason, diff FROM audit_log WHERE target_type = 'channel' ORDER BY rowid")
      .all<{ actor_type: string; actor_id: string; action: string; target_id: string; reason: string | null; diff: string }>()
  ).results;
const stored = (h: Harness, id: string) =>
  h.db.prepare('SELECT *, CAST(1 AS INTEGER) AS one FROM channels WHERE id = ?').bind(id).first<Record<string, string | number | null>>();

async function ready() {
  const h = harness();
  const world = discordWorld(h);
  const a = await admin(h);
  const relay = (channelId: string, body: unknown = {}) => h.internal('POST', `/internal/admin/discord/channels/${channelId}/relay`, body, a.as);
  return { h, world, ...a, relay };
}

describe('GET /internal/admin/discord/channels', () => {
  const server = (world: World) => {
    world.channels = [
      { id: CAT_AGENTS, name: 'Agents', type: 4, position: 1 },
      { id: CAT_COMMUNITY, name: 'Community', type: 4, position: 0 },
      { id: LOUNGE, name: 'lounge', type: 0, parent_id: CAT_AGENTS, position: 0 },
      forum(),
      { id: BENCH, name: 'news', type: 5, parent_id: CAT_COMMUNITY, position: 3 },
      { id: MEDIA, name: 'pictures', type: 16, parent_id: null, position: 0, permission_overwrites: [deny(BOT_ROLE, P.VIEW_CHANNEL)] },
      { id: VOICE, name: 'voice', type: 2, parent_id: CAT_COMMUNITY, position: 4 },
      { id: '110000000000000006', name: 'stage', type: 13, parent_id: CAT_COMMUNITY, position: 5 },
    ];
  };

  it('lists the supported channels with category, type, tags, relay status and the bot’s permissions', async () => {
    const { h, world, as } = await ready();
    server(world);
    await seedChannel(h.relay, { id: LOUNGE, name: 'lounge', access: 'post' });
    const res = await h.internal('GET', '/internal/admin/discord/channels', undefined, as);
    expect(res.status).toBe(200);
    const listing = (await res.json()) as DiscordChannelListing;

    expect(listing.guild_id).toBe(GUILD);
    expect(listing.categories).toEqual([
      { id: CAT_COMMUNITY, name: 'Community', position: 0 },
      { id: CAT_AGENTS, name: 'Agents', position: 1 },
    ]);
    expect(listing.channels.map((c) => [c.name, c.type, c.type_label, c.category_id])).toEqual([
      ['pictures', 'media', 'Media', null],
      ['news', 'announcement', 'Announcement', CAT_COMMUNITY],
      ['lounge', 'text', 'Text', CAT_AGENTS],
      ['channel-ideas', 'forum', 'Forum', CAT_AGENTS],
    ]);

    const by = Object.fromEntries(listing.channels.map((c) => [c.id, c]));
    expect(by[LOUNGE]!.relay).toEqual({
      id: LOUNGE,
      guild_id: GUILD,
      name: 'lounge',
      type: 'text',
      agent_access: 'post',
      pace_per_agent_per_minute: 10,
      verified_only: false,
      has_webhook: true,
    });
    expect(by[FORUM]!.relay).toBeNull();
    expect(by[LOUNGE]!.available_tags).toEqual([]);
    expect(by[FORUM]!.available_tags).toEqual([
      { id: TAG_IDEA, name: 'Idea', moderated: false },
      { id: TAG_OFFICIAL, name: 'Official', moderated: true },
    ]);
    expect(by[LOUNGE]!.bot).toEqual({ can_view: true, can_read_history: true, can_manage_webhooks: true, can_create_threads: true, can_send_in_threads: true });
    expect(JSON.stringify(listing)).not.toContain('token');
  });

  it('works out the bot’s permissions per channel, so a denied View Channel hides the rest', async () => {
    const { world, h, as } = await ready();
    server(world);
    const listing = (await (await h.internal('GET', '/internal/admin/discord/channels', undefined, as)).json()) as DiscordChannelListing;
    const media = listing.channels.find((c) => c.id === MEDIA)!;
    expect(media.bot).toEqual({ can_view: false, can_read_history: false, can_manage_webhooks: false, can_create_threads: false, can_send_in_threads: false });
  });

  it('reflects Manage Webhooks and thread permissions granted server-wide or taken away in a channel', async () => {
    const { world, h, as } = await ready();
    world.roles.find((r) => r.id === BOT_ROLE)!.permissions = '0';
    world.channels = [
      { id: LOUNGE, name: 'lounge', type: 0, permission_overwrites: [] },
      { id: BENCH, name: 'bench', type: 0, permission_overwrites: overwrites(allow(BOT_ROLE, P.MANAGE_WEBHOOKS), deny(BOT_ROLE, P.CREATE_PUBLIC_THREADS)) },
    ];
    const listing = (await (await h.internal('GET', '/internal/admin/discord/channels', undefined, as)).json()) as DiscordChannelListing;
    const bots = Object.fromEntries(listing.channels.map((c) => [c.id, c.bot]));
    expect(bots[LOUNGE]).toMatchObject({ can_manage_webhooks: false, can_create_threads: true });
    expect(bots[BENCH]).toMatchObject({ can_manage_webhooks: true, can_create_threads: false, can_send_in_threads: true });
  });

  it('is for admins, and fails plainly when Discord or the configuration does', async () => {
    const { world, h, as } = await ready();
    const person = await seedOwner(h.relay, '200000000000000002', 'person');
    expect((await h.internal('GET', '/internal/admin/discord/channels', undefined, { 'x-logitland-owner': person.id })).status).toBe(403);
    expect((await h.call('GET', '/internal/admin/discord/channels')).status).toBe(404);

    world.overrides[`GET /guilds/${GUILD}/channels`] = discordError(500, 0, 'internal discord text');
    const down = await h.internal('GET', '/internal/admin/discord/channels', undefined, as);
    expect(down.status).toBe(502);
    expect(await down.text()).not.toContain('internal discord text');
    world.overrides[`GET /guilds/${GUILD}/channels`] = discordError(403, 50001);
    expect((await h.internal('GET', '/internal/admin/discord/channels', undefined, as)).status).toBe(422);

    const noGuild = harness({ env: { DISCORD_GUILD_ID: undefined } });
    const other = await admin(noGuild);
    expect((await noGuild.internal('GET', '/internal/admin/discord/channels', undefined, other.as)).status).toBe(503);
  });
});

describe('POST /internal/admin/discord/channels/:channelId/relay', () => {
  it('reads the channel from Discord, creates its webhook, and saves it with the defaults', async () => {
    const { h, world, owner, relay } = await ready();
    world.channels = [forum()];
    const res = await relay(FORUM);
    expect(res.status).toBe(201);
    const out = (await res.json()) as RelayChannelResult;
    expect(out).toEqual({
      channel: {
        id: FORUM,
        guild_id: GUILD,
        name: 'channel-ideas',
        type: 'forum',
        agent_access: 'post_new_threads',
        pace_per_agent_per_minute: 10,
        verified_only: false,
        has_webhook: true,
      },
      webhook_created: true,
      tags: [
        { id: TAG_IDEA, name: 'Idea', moderated: false },
        { id: TAG_OFFICIAL, name: 'Official', moderated: true },
      ],
    });

    expect(h.discordCalls.map(path)).toEqual([`GET /channels/${FORUM}`, `POST /channels/${FORUM}/webhooks`]);
    const create = h.discordCalls[1]!;
    expect(create.headers.get('authorization')).toBe('Bot test-bot-token');
    expect(await create.json()).toEqual({ name: 'Logitland relay' });
    expect(create.headers.get('x-audit-log-reason')).not.toBeNull();

    const row = (await getChannel(h.relay, FORUM))!;
    expect(row.webhook_id).toBe(NEW_HOOK);
    expect(row.webhook_ciphertext).not.toContain(FRESH_TOKEN);
    expect(await openWebhook(h.relay, row)).toEqual({ id: NEW_HOOK, token: FRESH_TOKEN });
    expect(JSON.parse((await stored(h, FORUM))!.tags as string)).toEqual(out.tags);

    const [entry, ...rest] = await channelAudit(h);
    expect(rest).toEqual([]);
    expect(entry).toMatchObject({ actor_type: 'admin', actor_id: owner.id, action: 'channel.added', target_id: FORUM });
    expect(JSON.parse(entry!.diff)).toMatchObject({
      name: { from: null, to: 'channel-ideas' },
      type: { from: null, to: 'forum' },
      agent_access: { from: null, to: 'post_new_threads' },
      webhook: { from: null, to: 'set' },
    });
    const everything = JSON.stringify((await h.db.prepare('SELECT * FROM audit_log').all()).results) + JSON.stringify(h.log.lines) + JSON.stringify(out);
    expect(everything).not.toContain(FRESH_TOKEN);
  });

  it('saves no tags for text and announcement channels, and allows new threads there', async () => {
    const { h, world, relay } = await ready();
    world.channels = [{ id: LOUNGE, name: 'lounge', type: 0 }];
    const res = await relay(LOUNGE, { agent_access: 'post_new_threads' });
    expect(res.status).toBe(201);
    expect(((await res.json()) as RelayChannelResult).channel).toMatchObject({ type: 'text', agent_access: 'post_new_threads' });
    expect((await stored(h, LOUNGE))!.tags).toBe('[]');
  });

  it('applies the request’s access and pace instead of the defaults', async () => {
    const { world, relay } = await ready();
    world.channels = [{ id: LOUNGE, name: 'lounge', type: 0 }];
    const out = (await (await relay(LOUNGE, { agent_access: 'read_only', pace_per_agent_per_minute: 3 })).json()) as RelayChannelResult;
    expect(out.channel).toMatchObject({ agent_access: 'read_only', pace_per_agent_per_minute: 3 });
  });

  it('keeps an existing webhook and settings, and updates only what the request sets', async () => {
    const { h, world, relay } = await ready();
    world.channels = [{ id: LOUNGE, name: 'lounge', type: 0 }];
    await seedChannel(h.relay, { id: LOUNGE, name: 'lounge', access: 'read_only', pace: 4 });
    const before = (await getChannel(h.relay, LOUNGE))!.webhook_ciphertext;

    const same = await relay(LOUNGE);
    expect(same.status).toBe(200);
    const out = (await same.json()) as RelayChannelResult;
    expect(out).toMatchObject({
      webhook_created: false,
      channel: { agent_access: 'read_only', pace_per_agent_per_minute: 4, has_webhook: true },
    });
    expect(h.discordCalls.map(path)).toEqual([`GET /channels/${LOUNGE}`]);
    expect((await getChannel(h.relay, LOUNGE))!.webhook_ciphertext).toBe(before);
    expect(await channelAudit(h)).toEqual([]);

    const changed = (await (await relay(LOUNGE, { agent_access: 'post' })).json()) as RelayChannelResult;
    expect(changed.channel).toMatchObject({ agent_access: 'post', pace_per_agent_per_minute: 4 });
    expect((await channelAudit(h)).map((e) => e.action)).toEqual(['channel.updated']);
  });

  it('treats a channel that exists but is off as not relayed yet, and applies the defaults', async () => {
    const { h, world, relay } = await ready();
    world.channels = [{ id: LOUNGE, name: 'lounge', type: 0 }];
    await seedChannel(h.relay, { id: LOUNGE, name: 'lounge', access: 'off', pace: 4 });
    const out = (await (await relay(LOUNGE)).json()) as RelayChannelResult;
    expect(out.channel).toMatchObject({ agent_access: 'post', pace_per_agent_per_minute: 4, has_webhook: true });
    expect(world.createdHooks).toBe(0);
  });

  it('refreshes the name and tags from Discord each time, and audits only what an admin would call a change', async () => {
    const { h, world, relay } = await ready();
    world.channels = [forum()];
    await relay(FORUM);
    world.channels = [forum({ available_tags: [{ id: TAG_IDEA, name: 'Idea!', moderated: false }] })];
    await relay(FORUM);
    expect(JSON.parse((await stored(h, FORUM))!.tags as string)).toEqual([{ id: TAG_IDEA, name: 'Idea!', moderated: false }]);
    expect((await channelAudit(h)).map((e) => e.action)).toEqual(['channel.added']);

    world.channels = [forum({ name: 'renamed' })];
    await relay(FORUM);
    const audits = await channelAudit(h);
    expect(audits.map((e) => e.action)).toEqual(['channel.added', 'channel.updated']);
    expect(JSON.parse(audits[1]!.diff)).toEqual({ name: { from: 'channel-ideas', to: 'renamed' } });
  });

  it('answers 422 “Give the bot Manage Webhooks in this channel” when Discord says 403, and stores nothing', async () => {
    const { h, world, relay } = await ready();
    world.channels = [forum()];
    world.overrides[`POST /channels/${FORUM}/webhooks`] = discordError(403, 50013, 'Missing Permissions');
    const res = await relay(FORUM);
    expect(res.status).toBe(422);
    expect(((await res.json()) as { detail: string }).detail).toBe('Give the bot Manage Webhooks in this channel');
    expect(await getChannel(h.relay, FORUM)).toBeNull();
    expect(await channelAudit(h)).toEqual([]);
  });

  it('explains the webhook limit, other refusals and a Discord outage', async () => {
    const { world, relay } = await ready();
    world.channels = [forum()];
    world.overrides[`POST /channels/${FORUM}/webhooks`] = discordError(400, 30007, 'Maximum number of webhooks reached (15)');
    expect(((await (await relay(FORUM)).json()) as { detail: string }).detail).toContain('most webhooks Discord allows');
    world.overrides[`POST /channels/${FORUM}/webhooks`] = discordError(404, 10003);
    const refused = await relay(FORUM);
    expect(refused.status).toBe(422);
    world.overrides[`POST /channels/${FORUM}/webhooks`] = discordError(503, 0);
    expect((await relay(FORUM)).status).toBe(502);
    world.overrides[`GET /channels/${FORUM}`] = discordError(500, 0);
    expect((await relay(FORUM)).status).toBe(502);
  });

  it('refuses a channel in another server, and one Discord doesn’t show the bot, before creating anything', async () => {
    const { h, world, relay } = await ready();
    world.channels = [{ id: LOUNGE, guild_id: '999999999999999999', name: 'elsewhere', type: 0 }];
    const other = await relay(LOUNGE);
    expect(other.status).toBe(422);
    expect(((await other.json()) as { detail: string }).detail).toContain('isn’t in the Logitland server');
    expect((await relay(BENCH)).status).toBe(422);
    expect(world.createdHooks).toBe(0);
    expect(await getChannel(h.relay, LOUNGE)).toBeNull();
    expect(h.discordCalls.every((r) => r.method === 'GET')).toBe(true);
  });

  it('refuses threads, voice channels and categories', async () => {
    const { world, relay } = await ready();
    world.channels = [
      { id: LOUNGE, name: 'a thread', type: 11 },
      { id: BENCH, name: 'voice', type: 2 },
      { id: CAT_AGENTS, name: 'a category', type: 4 },
    ];
    for (const id of [LOUNGE, BENCH, CAT_AGENTS]) {
      const res = await relay(id);
      expect(res.status, id).toBe(422);
      expect(((await res.json()) as { detail: string }).detail).toContain('text, announcement, forum and media');
    }
    expect(world.createdHooks).toBe(0);
  });

  it('validates the request and is for admins', async () => {
    const { h, world, relay } = await ready();
    world.channels = [{ id: LOUNGE, name: 'lounge', type: 0 }];
    expect((await relay(LOUNGE, { agent_access: 'everything' })).status).toBe(400);
    expect((await relay(LOUNGE, { pace_per_agent_per_minute: 500 })).status).toBe(400);
    expect((await relay(LOUNGE, { verified_only: 'yes' })).status).toBe(400);
    expect((await relay('nope')).status).toBe(400);
    const person = await seedOwner(h.relay, '200000000000000002', 'person');
    expect((await h.internal('POST', `/internal/admin/discord/channels/${LOUNGE}/relay`, {}, { 'x-logitland-owner': person.id })).status).toBe(403);
    expect(world.createdHooks).toBe(0);
  });

  it('needs DISCORD_GUILD_ID', async () => {
    const h = harness({ env: { DISCORD_GUILD_ID: undefined } });
    discordWorld(h);
    const a = await admin(h);
    const res = await h.internal('POST', `/internal/admin/discord/channels/${LOUNGE}/relay`, {}, a.as);
    expect(res.status).toBe(503);
  });
});
