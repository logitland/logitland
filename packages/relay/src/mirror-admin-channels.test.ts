import type { Channel } from '@logitland/contracts';
import { describe, expect, it } from 'vitest';
import { openWebhook, getChannel } from './services/channels';
import { ADMIN_DISCORD, BENCH, FORUM, GUILD, LOUNGE, harness, seedChannel, seedOwner, type Harness } from './testing';

const WEBHOOK_ID = '600000000000000009';
const TOKEN = 'wh-secret-token-ZZZ';
const URL_FOR = (id = WEBHOOK_ID) => `https://discord.com/api/webhooks/${id}/${TOKEN}`;

async function setup() {
  const h = harness();
  const admin = await seedOwner(h.relay, ADMIN_DISCORD, 'admin');
  const as = { 'x-logitland-owner': admin.id };
  const patch = (channelId: string, body: unknown, headers = as) => h.internal('PATCH', `/internal/admin/channels/${channelId}`, body, headers);
  return { h, admin, as, patch };
}

/** Plays Discord: channels by ID and webhooks by ID, with the channel each webhook posts to. */
function discordKnows(
  h: Harness,
  o: { channels?: Record<string, { type: number; name: string; guild_id?: string; available_tags?: unknown[] }>; webhooks?: Record<string, string> },
) {
  h.setDiscord(async (req) => {
    const path = new URL(req.url).pathname.replace('/api/v10', '');
    const channel = /^\/channels\/(\d+)$/.exec(path);
    if (channel) {
      const c = o.channels?.[channel[1]!];
      return c ? Response.json({ id: channel[1], guild_id: GUILD, ...c }) : Response.json({ message: 'Unknown Channel', code: 10003 }, { status: 404 });
    }
    const hook = /^\/webhooks\/(\d+)\/[\w-]+$/.exec(path);
    if (hook) {
      const to = o.webhooks?.[hook[1]!];
      return to ? Response.json({ id: hook[1], channel_id: to }) : Response.json({ message: 'Unknown Webhook', code: 10015 }, { status: 404 });
    }
    return Response.json({});
  });
}

const audits = async (h: Harness) =>
  (
    await h.db
      .prepare("SELECT actor_type, actor_id, action, target_id, diff FROM audit_log WHERE target_type = 'channel' ORDER BY rowid")
      .all<{ actor_type: string; actor_id: string; action: string; target_id: string; diff: string }>()
  ).results;

describe('GET /internal/admin/channels', () => {
  it('lists every channel with its policy and whether it has a webhook, never the webhook', async () => {
    const { h, as } = await setup();
    await seedChannel(h.relay, { id: LOUNGE, name: 'lounge', access: 'post', publicMirror: true });
    await seedChannel(h.relay, { id: BENCH, name: 'bench', access: 'off', webhookUrl: null });
    const res = await h.internal('GET', '/internal/admin/channels', undefined, as);
    expect(res.status).toBe(200);
    const { channels } = (await res.json()) as { channels: Channel[] };
    expect(channels).toEqual([
      {
        id: BENCH,
        guild_id: GUILD,
        name: 'bench',
        type: 'text',
        agent_access: 'off',
        pace_per_agent_per_minute: 10,
        public_mirror: false,
        verified_only: false,
        has_webhook: false,
      },
      {
        id: LOUNGE,
        guild_id: GUILD,
        name: 'lounge',
        type: 'text',
        agent_access: 'post',
        pace_per_agent_per_minute: 10,
        public_mirror: true,
        verified_only: false,
        has_webhook: true,
      },
    ]);
    expect(JSON.stringify(channels)).not.toContain('token');
  });

  it('is for admins only', async () => {
    const { h } = await setup();
    const person = await seedOwner(h.relay, '200000000000000002', 'person');
    expect((await h.internal('GET', '/internal/admin/channels', undefined, { 'x-logitland-owner': person.id })).status).toBe(403);
    expect((await h.internal('PATCH', `/internal/admin/channels/${LOUNGE}`, { name: 'x' }, { 'x-logitland-owner': person.id })).status).toBe(403);
    expect((await h.call('GET', '/internal/admin/channels')).status).toBe(404);
  });
});

describe('adding a channel', () => {
  it('fills the name, guild and type from Discord when they’re left out', async () => {
    const { h, admin, patch } = await setup();
    discordKnows(h, { channels: { [FORUM]: { type: 15, name: 'channel-ideas' } } });
    const res = await patch(FORUM, { agent_access: 'post_new_threads', public_mirror: true });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      id: FORUM,
      guild_id: GUILD,
      name: 'channel-ideas',
      type: 'forum',
      agent_access: 'post_new_threads',
      pace_per_agent_per_minute: 10,
      public_mirror: true,
      verified_only: false,
      has_webhook: false,
    });
    expect(h.discordCalls.map((r) => `${r.method} ${new URL(r.url).pathname}`)).toEqual([`GET /api/v10/channels/${FORUM}`]);
    expect(h.discordCalls[0]!.headers.get('authorization')).toBe('Bot test-bot-token');
    const [entry] = await audits(h);
    expect(entry).toMatchObject({ actor_type: 'admin', actor_id: admin.id, action: 'channel.added', target_id: FORUM });
    expect(JSON.parse(entry!.diff)).toMatchObject({
      name: { from: null, to: 'channel-ideas' },
      type: { from: null, to: 'forum' },
      public_mirror: { from: null, to: true },
    });
  });

  it('maps Discord’s channel types: text, announcement, forum and media', async () => {
    const { h, patch } = await setup();
    const ids = ['110000000000000011', '110000000000000012', '110000000000000013', '110000000000000014'];
    discordKnows(h, {
      channels: {
        [ids[0]!]: { type: 0, name: 'a' },
        [ids[1]!]: { type: 5, name: 'b' },
        [ids[2]!]: { type: 15, name: 'c' },
        [ids[3]!]: { type: 16, name: 'd' },
      },
    });
    const types = [];
    for (const id of ids) types.push(((await (await patch(id, { agent_access: 'off' })).json()) as Channel).type);
    expect(types).toEqual(['text', 'announcement', 'forum', 'media']);
  });

  it('asks Discord only for what’s missing, and lets the admin’s values win', async () => {
    const { h, patch } = await setup();
    const complete = await patch(LOUNGE, { name: 'lounge', guild_id: GUILD, type: 'text' });
    expect(complete.status).toBe(201);
    expect(h.discordCalls).toHaveLength(0);

    discordKnows(h, { channels: { [BENCH]: { type: 0, name: 'discord-name' } } });
    const partial = (await (await patch(BENCH, { name: 'my-name', pace_per_agent_per_minute: 4 })).json()) as Channel;
    expect(partial).toMatchObject({ name: 'my-name', guild_id: GUILD, type: 'text', pace_per_agent_per_minute: 4, agent_access: 'off' });
  });

  it('refuses channels Discord won’t show, or of a kind the relay can’t use', async () => {
    const { h, patch } = await setup();
    discordKnows(h, { channels: { [LOUNGE]: { type: 11, name: 'a thread' }, [BENCH]: { type: 2, name: 'voice' } } });
    for (const id of [LOUNGE, BENCH]) {
      const res = await patch(id, { agent_access: 'read_only' });
      expect(res.status).toBe(422);
      expect(((await res.json()) as { detail: string }).detail).toContain('text, announcement, forum and media');
    }
    const unknown = await patch(FORUM, { agent_access: 'read_only' });
    expect(unknown.status).toBe(422);
    expect(JSON.stringify(await unknown.json())).not.toContain('10003');
    expect(await getChannel(h.relay, LOUNGE)).toBeNull();
    expect(await audits(h)).toEqual([]);
  });

  it('reports Discord being unavailable as a retryable failure', async () => {
    const { h, patch } = await setup();
    h.setDiscord(async () => new Response('bad gateway', { status: 502 }));
    expect((await patch(LOUNGE, { agent_access: 'off' })).status).toBe(502);
    expect(await getChannel(h.relay, LOUNGE)).toBeNull();
  });
});

describe('agents starting new threads', () => {
  it('is allowed in every kind of channel: forums and media take posts, text and announcement channels get a thread from a message', async () => {
    const { h, patch } = await setup();
    const kinds = [
      [LOUNGE, 'text'],
      [BENCH, 'announcement'],
      [FORUM, 'forum'],
      ['110000000000000004', 'media'],
    ] as const;
    for (const [id, type] of kinds) {
      await seedChannel(h.relay, { id, type, access: 'post', name: type });
      const res = await patch(id, { agent_access: 'post_new_threads' });
      expect(res.status, type).toBe(200);
      expect(((await res.json()) as Channel).agent_access).toBe('post_new_threads');
    }
    expect((await patch(LOUNGE, { name: 'lounge', guild_id: GUILD, type: 'announcement', agent_access: 'post_new_threads' })).status).toBe(200);
  });

  it('can be set when adding a text channel', async () => {
    const { h, patch } = await setup();
    expect((await patch(LOUNGE, { name: 'x', guild_id: GUILD, type: 'text', agent_access: 'post_new_threads' })).status).toBe(201);
    expect((await getChannel(h.relay, LOUNGE))!.agent_access).toBe('post_new_threads');
  });
});

describe('only channels in the Logitland server', () => {
  const OTHER = '999999999999999999';

  it('refuses a channel moved to, or added from, another server', async () => {
    const { h, patch } = await setup();
    await seedChannel(h.relay, { id: LOUNGE });
    const moved = await patch(LOUNGE, { guild_id: OTHER });
    expect(moved.status).toBe(422);
    expect(((await moved.json()) as { detail: string }).detail).toContain('isn’t in the Logitland server');
    expect((await getChannel(h.relay, LOUNGE))!.guild_id).toBe(GUILD);

    expect((await patch(BENCH, { name: 'x', guild_id: OTHER, type: 'text' })).status).toBe(422);
    expect(await getChannel(h.relay, BENCH)).toBeNull();

    discordKnows(h, { channels: { [FORUM]: { type: 15, name: 'elsewhere', guild_id: OTHER } } });
    expect((await patch(FORUM, { agent_access: 'post' })).status).toBe(422);
    expect(await getChannel(h.relay, FORUM)).toBeNull();
    expect(await audits(h)).toEqual([]);
  });

  it('also refuses further changes to a channel that is already recorded under another server', async () => {
    const { h, patch } = await setup();
    await seedChannel(h.relay, { id: LOUNGE });
    await h.db.prepare('UPDATE channels SET guild_id = ? WHERE id = ?').bind(OTHER, LOUNGE).run();
    expect((await patch(LOUNGE, { pace_per_agent_per_minute: 3 })).status).toBe(422);
    expect((await patch(LOUNGE, { guild_id: GUILD, pace_per_agent_per_minute: 3 })).status).toBe(200);
  });
});

describe('forum and media tags', () => {
  const TAGS = [
    { id: '700000000000000011', name: 'Idea', moderated: false },
    { id: '700000000000000012', name: 'Official', moderated: true },
  ];
  const tagsOf = async (h: Harness, id: string) =>
    JSON.parse((await h.db.prepare('SELECT tags FROM channels WHERE id = ?').bind(id).first<{ tags: string }>())!.tags) as unknown[];

  it('are read from Discord when a new forum channel is added', async () => {
    const { h, patch } = await setup();
    discordKnows(h, { channels: { [FORUM]: { type: 15, name: 'ideas', available_tags: TAGS } } });
    expect((await patch(FORUM, { agent_access: 'post' })).status).toBe(201);
    expect(await tagsOf(h, FORUM)).toEqual(TAGS);
  });

  it('are refreshed whenever an existing forum or media channel is saved', async () => {
    const { h, patch } = await setup();
    await seedChannel(h.relay, { id: FORUM, type: 'forum', name: 'ideas' });
    expect(await tagsOf(h, FORUM)).toEqual([]);
    discordKnows(h, { channels: { [FORUM]: { type: 15, name: 'ideas', available_tags: TAGS } } });
    await patch(FORUM, { pace_per_agent_per_minute: 4 });
    expect(await tagsOf(h, FORUM)).toEqual(TAGS);
    expect(h.discordCalls.map((r) => `${r.method} ${new URL(r.url).pathname}`)).toEqual([`GET /api/v10/channels/${FORUM}`]);
    expect((await audits(h)).map((a) => Object.keys(JSON.parse(a.diff)))).toEqual([['pace_per_agent_per_minute']]);
  });

  it('are read for a new forum channel even when the admin gave every field', async () => {
    const { h, patch } = await setup();
    discordKnows(h, { channels: { [FORUM]: { type: 15, name: 'ideas', available_tags: TAGS } } });
    await patch(FORUM, { name: 'ideas', guild_id: GUILD, type: 'forum' });
    expect(await tagsOf(h, FORUM)).toEqual(TAGS);
  });

  it('keep the old tags, and the save goes through, when Discord can’t be reached', async () => {
    const { h, patch } = await setup();
    await seedChannel(h.relay, { id: FORUM, type: 'forum', name: 'ideas' });
    await h.db.prepare('UPDATE channels SET tags = ? WHERE id = ?').bind(JSON.stringify(TAGS), FORUM).run();
    h.setDiscord(async () => new Response('down', { status: 503 }));
    expect((await patch(FORUM, { pace_per_agent_per_minute: 4 })).status).toBe(200);
    expect(await tagsOf(h, FORUM)).toEqual(TAGS);
    expect(h.log.lines.some((l) => l.event === 'admin.tags_refresh_failed')).toBe(true);
  });

  it('are not looked up for text channels or when nothing changes', async () => {
    const { h, patch } = await setup();
    await seedChannel(h.relay, { id: LOUNGE, type: 'text', access: 'post' });
    await seedChannel(h.relay, { id: FORUM, type: 'forum', name: 'ideas', access: 'post' });
    await patch(LOUNGE, { pace_per_agent_per_minute: 4 });
    await patch(FORUM, { agent_access: 'post' });
    expect(h.discordCalls).toHaveLength(0);
  });
});

describe('channel webhooks', () => {
  it('seals a webhook that Discord says belongs to the channel, and never returns or audits the URL', async () => {
    const { h, as, patch } = await setup();
    await seedChannel(h.relay, { id: LOUNGE, webhookUrl: null });
    discordKnows(h, { webhooks: { [WEBHOOK_ID]: LOUNGE } });

    const res = await patch(LOUNGE, { webhook_url: URL_FOR() });
    expect(res.status).toBe(200);
    expect(((await res.json()) as Channel).has_webhook).toBe(true);
    expect(await (await h.internal('GET', '/internal/admin/channels', undefined, as)).text()).not.toContain(TOKEN);

    const row = (await getChannel(h.relay, LOUNGE))!;
    expect(row.webhook_id).toBe(WEBHOOK_ID);
    expect(row.webhook_ciphertext).not.toContain(TOKEN);
    expect(await openWebhook(h.relay, row)).toEqual({ id: WEBHOOK_ID, token: TOKEN });
    expect(h.discordCalls.map((r) => `${r.method} ${new URL(r.url).pathname}`)).toEqual([`GET /api/v10/webhooks/${WEBHOOK_ID}/${TOKEN}`]);
    expect(h.discordCalls[0]!.headers.get('authorization')).toBeNull();

    const everything = JSON.stringify((await h.db.prepare('SELECT * FROM audit_log').all()).results) + JSON.stringify(h.log.lines);
    expect(everything).not.toContain(TOKEN);
    expect(JSON.parse((await audits(h))[0]!.diff)).toEqual({ webhook: { from: null, to: 'set' } });
  });

  it('refuses a webhook that posts to another channel with 422, and keeps the old one', async () => {
    const { h, patch } = await setup();
    await seedChannel(h.relay, { id: LOUNGE });
    const before = (await getChannel(h.relay, LOUNGE))!.webhook_ciphertext;
    discordKnows(h, { webhooks: { [WEBHOOK_ID]: BENCH } });
    const res = await patch(LOUNGE, { webhook_url: URL_FOR() });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { detail: string }).detail).toContain('different channel');
    expect((await getChannel(h.relay, LOUNGE))!.webhook_ciphertext).toBe(before);
    expect(await audits(h)).toEqual([]);
    expect(JSON.stringify(h.log.lines)).not.toContain(TOKEN);
  });

  it('refuses a webhook Discord doesn’t know, and one that isn’t a webhook URL', async () => {
    const { h, patch } = await setup();
    await seedChannel(h.relay, { id: LOUNGE, webhookUrl: null });
    discordKnows(h, {});
    const unknown = await patch(LOUNGE, { webhook_url: URL_FOR() });
    expect(unknown.status).toBe(422);
    expect(JSON.stringify(await unknown.json())).not.toContain(TOKEN);
    const notAWebhook = await patch(LOUNGE, { webhook_url: 'https://example.com/api/webhooks/1/2' });
    expect(notAWebhook.status).toBe(400);
    expect(h.discordCalls).toHaveLength(1);
    expect((await getChannel(h.relay, LOUNGE))!.webhook_ciphertext).toBeNull();
  });

  it('records a replacement as "replaced" and a removal as null, and clear_webhook is idempotent', async () => {
    const { h, patch } = await setup();
    await seedChannel(h.relay, { id: LOUNGE });
    discordKnows(h, { webhooks: { [WEBHOOK_ID]: LOUNGE } });
    await patch(LOUNGE, { webhook_url: URL_FOR() });
    const cleared = await patch(LOUNGE, { clear_webhook: true });
    expect(((await cleared.json()) as Channel).has_webhook).toBe(false);
    const row = (await getChannel(h.relay, LOUNGE))!;
    expect(row).toMatchObject({ webhook_ciphertext: null, webhook_id: null });
    const entries = await audits(h);
    expect(JSON.parse(entries[0]!.diff)).toEqual({ webhook: { from: 'set', to: 'replaced' } });
    expect(JSON.parse(entries[1]!.diff)).toEqual({ webhook: { from: 'set', to: null } });
    await patch(LOUNGE, { clear_webhook: true });
    expect(await audits(h)).toHaveLength(2);
  });

  it('refuse webhook_url together with clear_webhook', async () => {
    const { h, patch } = await setup();
    await seedChannel(h.relay, { id: LOUNGE });
    expect((await patch(LOUNGE, { webhook_url: URL_FOR(), clear_webhook: true })).status).toBe(400);
  });
});

describe('changing a channel', () => {
  it('updates access, pace, name and the mirror flag, and audits exactly what changed', async () => {
    const { h, admin, patch } = await setup();
    await seedChannel(h.relay, { id: LOUNGE, name: 'lounge', access: 'off', pace: 10 });
    const res = await patch(LOUNGE, { agent_access: 'post', pace_per_agent_per_minute: 6, public_mirror: true, name: 'agent-lounge' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      id: LOUNGE,
      name: 'agent-lounge',
      agent_access: 'post',
      pace_per_agent_per_minute: 6,
      public_mirror: true,
      verified_only: false,
      has_webhook: true,
    });
    const entries = await audits(h);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ actor_type: 'admin', actor_id: admin.id, action: 'channel.updated', target_id: LOUNGE });
    expect(JSON.parse(entries[0]!.diff)).toEqual({
      name: { from: 'lounge', to: 'agent-lounge' },
      agent_access: { from: 'off', to: 'post' },
      pace_per_agent_per_minute: { from: 10, to: 6 },
      public_mirror: { from: false, to: true },
    });
  });

  it('does nothing, and audits nothing, when the values are already what was asked', async () => {
    const { h, patch } = await setup();
    await seedChannel(h.relay, { id: LOUNGE, name: 'lounge', access: 'post', publicMirror: true });
    const res = await patch(LOUNGE, { agent_access: 'post', public_mirror: true, name: 'lounge' });
    expect(res.status).toBe(200);
    expect(await audits(h)).toEqual([]);
  });

  it('keeps what the patch leaves out', async () => {
    const { h, patch } = await setup();
    await seedChannel(h.relay, { id: FORUM, type: 'forum', access: 'post_new_threads', pace: 3, publicMirror: true, name: 'forum' });
    await patch(FORUM, { pace_per_agent_per_minute: 5 });
    expect(await getChannel(h.relay, FORUM)).toMatchObject({
      type: 'forum',
      agent_access: 'post_new_threads',
      pace_per_agent_per_minute: 5,
      public_mirror: 1,
      name: 'forum',
    });
  });

  it('validates the request', async () => {
    const { h, as, patch } = await setup();
    await seedChannel(h.relay, { id: LOUNGE });
    expect((await patch(LOUNGE, {})).status).toBe(400);
    expect((await patch(LOUNGE, { agent_access: 'everything' })).status).toBe(400);
    expect((await patch(LOUNGE, { type: 'voice' })).status).toBe(400);
    expect((await patch(LOUNGE, { pace_per_agent_per_minute: 500 })).status).toBe(400);
    expect((await patch(LOUNGE, { public_mirror: 'yes' })).status).toBe(400);
    expect((await patch('not-a-channel', { agent_access: 'off' })).status).toBe(400);
    expect((await h.internal('PATCH', `/internal/admin/channels/${LOUNGE}`, undefined, as)).status).toBe(400);
  });
});
