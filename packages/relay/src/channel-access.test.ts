import { Permission } from '@logitland/discord';
import { describe, expect, it } from 'vitest';
import { ingest } from './services/intake';
import { updateSettings } from './services/settings';
import { GUILD, LOUNGE, harness, seedAgent, seedChannel, seedOwner, type Harness } from './testing';

// Channel access by Discord roles (#9): what an agent may see and do is the channel's overwrites, evaluated as if it held
// @agents and the level roles up to its own, regardless of ownership.

const AGENTS = '130000000000000001';
const LEVEL_3 = '130000000000000003';
const STAFF = '110000000000000021';
const LAB = '110000000000000022';
const READ_ONLY = '110000000000000023';
const ANNOUNCE = '110000000000000024';
const P = Permission;
const VIEW = String(P.VIEW_CHANNEL | P.READ_MESSAGE_HISTORY);
const POST = String(P.VIEW_CHANNEL | P.READ_MESSAGE_HISTORY | P.SEND_MESSAGES | P.SEND_MESSAGES_IN_THREADS);
// As on a real server: @everyone's base role allows posting, so a closed channel denies it as well as viewing.
const hideFromEveryone = { id: GUILD, type: 0 as const, allow: '0', deny: String(P.VIEW_CHANNEL | P.SEND_MESSAGES | P.SEND_MESSAGES_IN_THREADS) };

/** A server where @everyone sees nothing in the agent channels unless an agent role is let in. */
async function server() {
  const h = harness();
  const admin = 'adm_test';
  for (const [id, name] of [
    [AGENTS, 'agents'],
    [LEVEL_3, 'level 3'],
  ])
    await h.db
      .prepare("INSERT INTO guild_roles (id, guild_id, name, permissions, updated_at) VALUES (?, ?, ?, '0', ?)")
      .bind(id, GUILD, name, h.now().toISOString())
      .run();
  await updateSettings(h.relay, admin, { agents_role_id: AGENTS });
  await h.db.prepare('UPDATE levels SET role_id = ? WHERE level = 3').bind(LEVEL_3).run();
  await seedChannel(h.relay, { id: LOUNGE, name: 'lounge' });
  await seedChannel(h.relay, { id: STAFF, name: 'staff', overwrites: [hideFromEveryone] });
  await seedChannel(h.relay, { id: LAB, name: 'lab', overwrites: [hideFromEveryone, { id: LEVEL_3, type: 0, allow: POST, deny: '0' }] });
  await seedChannel(h.relay, { id: READ_ONLY, name: 'read-only', overwrites: [hideFromEveryone, { id: AGENTS, type: 0, allow: VIEW, deny: '0' }] });
  return h;
}

const names = async (h: Harness, token: string) =>
  ((await (await h.call('GET', '/v1/channels', undefined, h.as(token))).json()) as { channels: { name: string }[] }).channels.map((c) => c.name).sort();

describe('which channels an agent sees', () => {
  it('stacks level roles and gives owned and unowned agents the same access at the same level', async () => {
    const h = await server();
    const owner = await seedOwner(h.relay);
    expect(await names(h, (await seedAgent(h.relay, { level: 1 })).token)).toEqual(['lounge', 'read-only']);
    expect(await names(h, (await seedAgent(h.relay, { level: 4 })).token)).toEqual(['lab', 'lounge', 'read-only']);
    expect(await names(h, (await seedAgent(h.relay, { level: 1, ownerId: owner.id })).token)).toEqual(['lounge', 'read-only']);
  });

  it('treats a channel it can’t see as missing, and one it can only read as closed to posting', async () => {
    const h = await server();
    const agent = await seedAgent(h.relay, { level: 1, ownerId: (await seedOwner(h.relay)).id });
    expect((await h.call('GET', `/v1/channels/${STAFF}/messages`, undefined, h.as(agent.token))).status).toBe(404);
    const post = await h.call(
      'POST',
      '/v1/messages',
      { channel_id: READ_ONLY, content: 'hello' },
      { ...h.as(agent.token), 'idempotency-key': 'read-only-post-1' },
    );
    expect(post.status).toBe(403);
  });

  it('never offers a channel the bot itself can’t view', async () => {
    const h = await server();
    await ingest(h.relay, { source: 'gateway', events: [{ kind: 'channel_hidden', channel_id: LOUNGE, guild_id: GUILD, type: 'text' }] });
    expect(await names(h, (await seedAgent(h.relay, { level: 5 })).token)).toEqual(['lab', 'read-only']);
  });
});

describe('the Gateway keeps it current', () => {
  it('opens a channel the moment Discord’s overwrites change, and forgets one that is deleted', async () => {
    const h = await server();
    const agent = await seedAgent(h.relay, { level: 1 });
    const channel = { kind: 'channel_update', channel_id: STAFF, guild_id: GUILD, name: 'staff', type: 'text', slowmode_seconds: 0 };
    await ingest(h.relay, { source: 'gateway', events: [{ ...channel, overwrites: [hideFromEveryone, { id: AGENTS, type: 0, allow: VIEW, deny: '0' }] }] });
    expect(await names(h, agent.token)).toEqual(['lounge', 'read-only', 'staff']);
    await ingest(h.relay, { source: 'gateway', events: [{ kind: 'channel_delete', channel_id: STAFF }] });
    expect(await names(h, agent.token)).toEqual(['lounge', 'read-only']);
  });

  it('keeps no messages from a channel no agent can see', async () => {
    const h = await server();
    const message = (channel_id: string, message_id: string) => ({
      kind: 'message_create',
      channel_id,
      message_id,
      author: { id: '200000000000000050', username: 'newsbot', bot: true },
      content: 'internal note',
      timestamp: h.now().toISOString(),
    });
    await ingest(h.relay, { source: 'gateway', events: [message(STAFF, '300000000000000001'), message(LOUNGE, '300000000000000002')] });
    const { results } = await h.db.prepare('SELECT CAST(message_id AS TEXT) AS id FROM conversation').all<{ id: string }>();
    expect(results.map((r) => r.id)).toEqual(['300000000000000002']);
  });
});

describe('posting', () => {
  it('makes the channel’s webhook the first time an agent posts there, and reuses it', async () => {
    const h = harness();
    await seedChannel(h.relay, { id: ANNOUNCE, name: 'news', webhookUrl: null });
    let made = 0;
    let n = 300000000000000100n;
    h.setDiscord(async (req) => {
      const url = new URL(req.url);
      if (url.pathname.endsWith(`/channels/${ANNOUNCE}/webhooks`)) {
        made++;
        return Response.json({ id: '600000000000000777', token: 'made-token', channel_id: ANNOUNCE, name: 'Logitland agents' });
      }
      n += 1n;
      return Response.json({ id: String(n), channel_id: ANNOUNCE, content: '', timestamp: h.now().toISOString(), edited_timestamp: null });
    });
    const agent = await seedAgent(h.relay);
    for (const key of ['first-post-0001', 'second-post-001']) {
      const res = await h.call('POST', '/v1/messages', { channel_id: ANNOUNCE, content: `post ${key}` }, { ...h.as(agent.token), 'idempotency-key': key });
      expect(res.status).toBe(201);
    }
    expect(made).toBe(1);
    expect(h.discordCalls.filter((r) => r.url.includes('/webhooks/600000000000000777/made-token'))).toHaveLength(2);
  });

  it('holds links where its roles lack Embed Links, and keeps the channel’s slowmode per agent', async () => {
    const h = harness();
    const noLinks = { id: GUILD, type: 0 as const, allow: '0', deny: String(P.EMBED_LINKS) };
    await seedChannel(h.relay, { id: LOUNGE, overwrites: [noLinks], slowmode: 30 });
    const agent = await seedAgent(h.relay);
    const send = (content: string, key: string) =>
      h.call('POST', '/v1/messages', { channel_id: LOUNGE, content }, { ...h.as(agent.token), 'idempotency-key': key });
    expect(await (await send('see https://example.com/page', 'link-post-0001')).json()).toMatchObject({ status: 'held', policy_code: 'links_not_allowed' });
    expect((await send('a message without a link', 'slow-post-00001')).status).toBe(201);
    expect((await send('and something else entirely', 'slow-post-00002')).status).toBe(429);
  });
});
