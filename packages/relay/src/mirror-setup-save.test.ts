import type { RelayChannelResult } from '@logitland/contracts';
import { describe, expect, it } from 'vitest';
import { getChannel } from './services/channels';
import { saveChannel, type ChannelRowWithTags } from './services/setup';
import { BENCH, FORUM, GUILD, LOUNGE, harness, seedChannel, type Harness } from './testing';
import { NEW_HOOK, admin, connectGateway, discordError, discordWorld, type ChannelSpec } from './mirror.testkit';
import { runSetup } from './services/setup';

const MEDIA = '110000000000000004';
const forum = (over: Partial<ChannelSpec> = {}): ChannelSpec => ({
  id: FORUM,
  name: 'channel-ideas',
  type: 15,
  available_tags: [],
  ...over,
});
const path = (r: Request) => `${r.method} ${new URL(r.url).pathname.replace('/api/v10', '')}`;

async function ready() {
  const h = harness();
  const world = discordWorld(h);
  const a = await admin(h);
  const relay = (channelId: string, body: unknown = {}) => h.internal('POST', `/internal/admin/discord/channels/${channelId}/relay`, body, a.as);
  const patch = (channelId: string, body: unknown) => h.internal('PATCH', `/internal/admin/channels/${channelId}`, body, a.as);
  return { h, world, ...a, relay, patch };
}

describe('what a relayed channel starts with', () => {
  it('lets agents post in a text channel and start threads in a forum or media channel, at one pace', async () => {
    const { world, relay } = await ready();
    world.channels = [{ id: LOUNGE, name: 'lounge', type: 0 }, forum(), { id: MEDIA, name: 'gallery', type: 16 }];
    const text = (await (await relay(LOUNGE)).json()) as RelayChannelResult;
    const forumOut = (await (await relay(FORUM)).json()) as RelayChannelResult;
    const media = (await (await relay(MEDIA)).json()) as RelayChannelResult;
    expect(text.channel).toMatchObject({ agent_access: 'post', pace_per_agent_per_minute: 10 });
    expect(forumOut.channel).toMatchObject({ agent_access: 'post_new_threads', pace_per_agent_per_minute: 10 });
    expect(media.channel).toMatchObject({ agent_access: 'post_new_threads', pace_per_agent_per_minute: 10 });
  });

  it('still takes what the request says, and an existing forum keeps its own access', async () => {
    const { h, world, relay } = await ready();
    world.channels = [forum()];
    await seedChannel(h.relay, { id: FORUM, name: 'channel-ideas', type: 'forum', access: 'read_only' });
    expect(((await (await relay(FORUM)).json()) as RelayChannelResult).channel.agent_access).toBe('read_only');
    expect(((await (await relay(FORUM, { agent_access: 'post' })).json()) as RelayChannelResult).channel.agent_access).toBe('post');
  });
});

describe('the Gateway line of the checklist', () => {
  it('says what the time is, in words and in UTC, and that it was the last thing Discord sent', async () => {
    const { h, owner } = await ready();
    await connectGateway(h, 'connected', { last_event_at: '2026-10-19T02:59:22.267Z' });
    const check = (await runSetup(h.relay)).checks.find((c) => c.id === 'gateway')!;
    expect(check.status).toBe('ok');
    expect(check.detail).toBe('Connected. The last thing Discord sent it was at 2026-10-19 02:59 UTC (less than a minute ago).');
    expect(check.detail).not.toMatch(/T\d\d:\d\d:\d\d|\.\d{3}Z/);
    expect(owner.id).toBeTruthy();

    h.advance(3 * 60_000);
    await connectGateway(h, 'connected', { last_event_at: '2026-10-19T00:30:00.000Z' });
    expect((await runSetup(h.relay)).checks.find((c) => c.id === 'gateway')!.detail).toBe(
      'Connected. The last thing Discord sent it was at 2026-10-19 00:30 UTC (2 hours ago).',
    );
  });
});

describe('saving a channel', () => {
  it('writes only what the admin changed, so a rename from Discord in between is not undone', async () => {
    const { h, owner } = await ready();
    await seedChannel(h.relay, { id: LOUNGE, name: 'lounge', access: 'post', pace: 10 });
    const stale = (await getChannel(h.relay, LOUNGE)) as ChannelRowWithTags;
    // The Gateway's CHANNEL_UPDATE lands after the admin's page loaded and before the save.
    await h.db.prepare("UPDATE channels SET name = 'common-room', type = 'announcement' WHERE id = ?").bind(LOUNGE).run();

    await saveChannel(
      h.relay,
      owner.id,
      LOUNGE,
      stale,
      {
        name: stale.name,
        guild_id: stale.guild_id,
        type: stale.type,
        agent_access: stale.agent_access,
        pace_per_agent_per_minute: 3,
        verified_only: stale.verified_only === 1,
        tags: [],
      },
      undefined,
    );
    expect(await getChannel(h.relay, LOUNGE)).toMatchObject({ name: 'common-room', type: 'announcement', pace_per_agent_per_minute: 3, agent_access: 'post' });
    const audit = await h.db.prepare("SELECT diff FROM audit_log WHERE target_id = ? AND action = 'channel.updated'").bind(LOUNGE).first<{ diff: string }>();
    expect(JSON.parse(audit!.diff)).toEqual({ pace_per_agent_per_minute: { from: 10, to: 3 } });
  });

  it('still replaces or removes the webhook and the tags when asked', async () => {
    const { h, owner } = await ready();
    await seedChannel(h.relay, { id: FORUM, name: 'forum', type: 'forum', access: 'post_new_threads' });
    const before = (await getChannel(h.relay, FORUM)) as ChannelRowWithTags;
    const next = {
      name: before.name,
      guild_id: before.guild_id,
      type: before.type,
      agent_access: before.agent_access,
      pace_per_agent_per_minute: 10,
      verified_only: false,
      tags: [{ id: '700000000000000011', name: 'Idea', moderated: false }],
    };
    await saveChannel(h.relay, owner.id, FORUM, before, next, null);
    const after = (await getChannel(h.relay, FORUM)) as ChannelRowWithTags;
    expect(after).toMatchObject({ webhook_ciphertext: null, webhook_id: null });
    expect(JSON.parse(after.tags)).toEqual(next.tags);
  });
});

describe('a webhook made for a relay that then failed', () => {
  const hookUrl = `/webhooks/${NEW_HOOK}/fresh-token-${NEW_HOOK}`;
  const insertRow = (h: Harness) =>
    (h.db as unknown as { raw: { prepare(sql: string): { run(...v: unknown[]): unknown } } }).raw
      .prepare(
        "INSERT INTO channels (id, guild_id, name, type, agent_access, pace_per_agent_per_minute, webhook_id, tags, updated_at) VALUES (?, ?, 'channel-ideas', 'forum', 'post_new_threads', 10, '600000000000000001', '[]', ?)",
      )
      .run(FORUM, GUILD, h.now().toISOString());

  it('is deleted when another admin relayed the channel first', async () => {
    const { h, world, relay } = await ready();
    world.channels = [forum()];
    world.overrides[`POST /channels/${FORUM}/webhooks`] = () => {
      insertRow(h);
      world.createdHooks += 1;
      return Response.json({ id: NEW_HOOK, token: `fresh-token-${NEW_HOOK}`, channel_id: FORUM, name: 'Logitland relay' });
    };
    const res = await relay(FORUM);
    expect(res.status).toBe(409);
    expect(h.discordCalls.map(path)).toContain(`DELETE ${hookUrl}`);
    // The webhook that is in use is not the one that was deleted.
    expect((await getChannel(h.relay, FORUM))!.webhook_id).toBe('600000000000000001');
    expect(h.log.lines.some((l) => l.event === 'channel.webhook_dropped')).toBe(true);
    expect(JSON.stringify(h.log.lines)).not.toContain(`fresh-token-${NEW_HOOK}`);
  });

  it('is deleted when the save fails, and the failure that is reported is the save’s', async () => {
    const { h, world, relay } = await ready();
    world.channels = [forum()];
    const prepare = h.db.prepare.bind(h.db);
    h.db.prepare = (sql: string) => {
      if (sql.startsWith('INSERT INTO channels')) throw new Error('D1 is down');
      return prepare(sql);
    };
    const res = await relay(FORUM);
    expect(res.status).toBe(500);
    expect(h.discordCalls.map(path)).toContain(`DELETE ${hookUrl}`);
  });

  it('is left alone if Discord won’t delete it, and the request still reports why it failed', async () => {
    const { h, world, relay } = await ready();
    world.channels = [forum()];
    world.overrides[`POST /channels/${FORUM}/webhooks`] = () => {
      insertRow(h);
      return Response.json({ id: NEW_HOOK, token: `fresh-token-${NEW_HOOK}`, channel_id: FORUM, name: 'Logitland relay' });
    };
    world.overrides[`DELETE ${hookUrl}`] = discordError(500, 0);
    expect((await relay(FORUM)).status).toBe(409);
    expect(h.discordCalls.map(path)).toContain(`DELETE ${hookUrl}`);
  });

  it('is kept when it did get saved', async () => {
    const { h, world, relay } = await ready();
    world.channels = [forum()];
    expect((await relay(FORUM)).status).toBe(201);
    expect(h.discordCalls.map(path).filter((p) => p.startsWith('DELETE'))).toEqual([]);
    expect((await getChannel(h.relay, FORUM))!.webhook_id).toBe(NEW_HOOK);
  });
});

describe('verified-only channels', () => {
  const diffs = async (h: Harness, id: string) =>
    (
      await h.db.prepare("SELECT diff FROM audit_log WHERE target_id = ? AND action = 'channel.updated' ORDER BY rowid").bind(id).all<{ diff: string }>()
    ).results.map((r) => JSON.parse(r.diff));

  it('are off by default, in the table and in what the admin API returns', async () => {
    const { h, patch } = await ready();
    await seedChannel(h.relay, { id: LOUNGE, name: 'lounge' });
    expect(await getChannel(h.relay, LOUNGE)).toMatchObject({ verified_only: 0 });
    const res = await patch(LOUNGE, { pace_per_agent_per_minute: 4 });
    expect(((await res.json()) as { verified_only: boolean }).verified_only).toBe(false);
  });

  it('are switched on and off with PATCH, change nothing else, and are audited', async () => {
    const { h, patch } = await ready();
    await seedChannel(h.relay, { id: LOUNGE, name: 'lounge', access: 'post', pace: 7 });
    const on = await patch(LOUNGE, { verified_only: true });
    expect(on.status).toBe(200);
    expect(await on.json()).toMatchObject({ verified_only: true, agent_access: 'post', pace_per_agent_per_minute: 7 });
    expect(await getChannel(h.relay, LOUNGE)).toMatchObject({ verified_only: 1, pace_per_agent_per_minute: 7 });
    expect(await diffs(h, LOUNGE)).toEqual([{ verified_only: { from: false, to: true } }]);

    // Saying the same again is not a change.
    expect((await patch(LOUNGE, { verified_only: true })).status).toBe(200);
    expect(await diffs(h, LOUNGE)).toHaveLength(1);

    expect(((await (await patch(LOUNGE, { verified_only: false })).json()) as { verified_only: boolean }).verified_only).toBe(false);
    expect(await diffs(h, LOUNGE)).toEqual([{ verified_only: { from: false, to: true } }, { verified_only: { from: true, to: false } }]);
  });

  it('can be set when a channel is first saved, and a non-boolean is refused', async () => {
    const { h, world, patch } = await ready();
    world.channels = [{ id: BENCH, name: 'bench', type: 0 }];
    const created = await patch(BENCH, { agent_access: 'post', verified_only: true });
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ verified_only: true });
    expect(await getChannel(h.relay, BENCH)).toMatchObject({ verified_only: 1 });
    expect((await patch(BENCH, { verified_only: 'yes' })).status).toBe(400);
  });

  it('are set from the relay dialog too, and an existing channel keeps its setting when the request leaves it out', async () => {
    const { h, world, relay } = await ready();
    world.channels = [forum()];
    const first = (await (await relay(FORUM, { verified_only: true })).json()) as RelayChannelResult;
    expect(first.channel.verified_only).toBe(true);
    const again = (await (await relay(FORUM, { pace_per_agent_per_minute: 5 })).json()) as RelayChannelResult;
    expect(again.channel).toMatchObject({ verified_only: true, pace_per_agent_per_minute: 5 });
    const off = (await (await relay(FORUM, { verified_only: false })).json()) as RelayChannelResult;
    expect(off.channel.verified_only).toBe(false);
    expect(await diffs(h, FORUM)).toEqual([{ pace_per_agent_per_minute: { from: 10, to: 5 } }, { verified_only: { from: true, to: false } }]);
  });

  it('show in the channel list the admin sees', async () => {
    const { h, a, patch } = await readyWithAdmin();
    await seedChannel(h.relay, { id: LOUNGE, name: 'lounge' });
    await patch(LOUNGE, { verified_only: true });
    const list = (await (await h.internal('GET', '/internal/admin/channels', undefined, a.as)).json()) as {
      channels: { id: string; verified_only: boolean }[];
    };
    expect(list.channels.find((c) => c.id === LOUNGE)!.verified_only).toBe(true);
  });
});

async function readyWithAdmin() {
  const r = await ready();
  return { ...r, a: { as: { 'x-logitland-owner': r.owner.id } } };
}
