// The fake Gateway, driven by a raw WebSocket client: the handshake, identify, heartbeats, dispatch order,
// intents, resume, invalid session, RECONNECT and every close code the relay has to handle.

import { DiscordRest } from '@logitland/discord';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CloseCode, Intent, encodeFrame, type DiscordFake } from '../src/index.ts';
import { fixture, sleep, type Fixture } from './helpers.ts';
import { RawClient } from './ws-client.ts';

const ALL = Intent.guilds | Intent.guildMessages | Intent.messageContent;
const PROPERTIES = { os: 'linux', browser: 'test', device: 'test' };

let f: Fixture;
let fake: DiscordFake;
let rest: DiscordRest;
const clients: RawClient[] = [];

beforeAll(async () => {
  f = await fixture({ gateway: { heartbeatIntervalMs: 5000 } });
  fake = f.fake;
  rest = new DiscordRest({ botToken: fake.botToken, base: fake.apiBase });
});
afterAll(() => fake.close());
beforeEach(() => {
  fake.gateway.shutdown();
  fake.gateway.ackHeartbeats = true;
  fake.gateway.nextResume = 'ok';
  fake.gateway.options.eventLagMs = 0;
  fake.gateway.options.resumeWindowMs = 120_000;
  fake.gateway.sessionStartLimit.remaining = 1000;
  fake.reset({ messages: true });
});
afterEach(() => {
  for (const c of clients.splice(0)) c.kill();
});

async function connect(query = '?v=10&encoding=json'): Promise<RawClient> {
  const c = await RawClient.connect(`${fake.gatewayUrl}${query}`);
  clients.push(c);
  return c;
}

const identifyFrame = (over: Record<string, unknown> = {}) => ({ op: 2, d: { token: fake.botToken, intents: ALL, properties: PROPERTIES, ...over } });

/** Connects, reads HELLO, identifies, and reads READY and GUILD_CREATE. */
async function session(intents = ALL) {
  const client = await connect();
  const hello = await client.nextJson();
  client.send(identifyFrame({ intents }));
  const ready = await client.nextJson();
  const guildCreate = await client.nextJson();
  return { client, hello, ready, guildCreate };
}

describe('the handshake', () => {
  it('answers the RFC 6455 example key with the documented accept value', async () => {
    const c = await RawClient.connect(`${fake.gatewayUrl}?v=10&encoding=json`, { key: 'dGhlIHNhbXBsZSBub25jZQ==' });
    clients.push(c);
    expect(c.acceptHeader).toBe('s3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
  });

  it('refuses a plain HTTP request to the Gateway path and an upgrade elsewhere', async () => {
    const res = await fetch(`${fake.url}/gateway`);
    expect(res.status).toBe(404);
    await expect(RawClient.connect(`${fake.url.replace('http', 'ws')}/elsewhere`)).rejects.toThrow();
  });

  it('works with a client written by someone else: the global WebSocket', async () => {
    const ws = new WebSocket(`${fake.gatewayUrl}?v=10&encoding=json`);
    const frames: { op: number; t: string | null; s: number | null; d: any }[] = [];
    ws.onmessage = (e) => frames.push(JSON.parse(String(e.data)));
    await fake.waitFor(() => frames.length >= 1, { message: 'no HELLO' });
    expect(frames[0]).toMatchObject({ op: 10, d: { heartbeat_interval: 5000 } });
    ws.send(JSON.stringify(identifyFrame()));
    await fake.waitFor(() => frames.some((x) => x.t === 'GUILD_CREATE'), { message: 'no GUILD_CREATE' });
    expect(frames.map((x) => x.t)).toEqual([null, 'READY', 'GUILD_CREATE']);
    ws.close(1000);
    await fake.waitFor(() => ws.readyState === WebSocket.CLOSED);
  });

  it('sends HELLO with heartbeat_interval first', async () => {
    const c = await connect();
    expect(await c.nextJson()).toEqual({ op: 10, d: { heartbeat_interval: 5000 }, s: null, t: null });
  });
});

describe('identify and ready', () => {
  it('answers IDENTIFY with READY (session_id, resume_gateway_url, application, unavailable guilds) then GUILD_CREATE', async () => {
    const { ready, guildCreate } = await session();
    expect(ready).toMatchObject({ op: 0, t: 'READY', s: 1 });
    expect(ready.d).toMatchObject({
      v: 10,
      user: { id: fake.application.id, bot: true },
      guilds: [{ id: f.guild.id, unavailable: true }],
      session_id: expect.stringMatching(/^[0-9a-f]{32}$/),
      resume_gateway_url: fake.gatewayUrl,
      application: { id: fake.application.id, flags: fake.application.flags },
    });
    expect(guildCreate).toMatchObject({ op: 0, t: 'GUILD_CREATE', s: 2 });
    expect(guildCreate.d.id).toBe(f.guild.id);
  });

  it('GUILD_CREATE lists channels with types and tags, roles, the bot as a member and active threads', async () => {
    const first = fake.say(f.text.id, { as: f.alice, content: 'a message' });
    const live = fake.startThread(f.text.id, first.id, 'Live thread', f.alice);
    const archived = fake.startThread(f.text.id, fake.say(f.text.id, { as: f.alice, content: 'another' }).id, 'Old thread', f.alice);
    fake.world.updateThread(archived.id, { archived: true });
    const { guildCreate } = await session();
    const d = guildCreate.d;
    const byId = new Map<string, any>(d.channels.map((c: any) => [c.id, c]));
    expect([...byId.keys()].sort()).toEqual([f.text.id, f.announcement.id, f.forum.id, f.media.id].sort());
    expect(byId.get(f.forum.id)).toMatchObject({ type: 15, name: 'ideas', available_tags: [{ name: 'idea' }, { name: 'question' }] });
    expect(byId.get(f.media.id).type).toBe(16);
    expect(byId.get(f.announcement.id).type).toBe(5);
    // Channels and threads inside GUILD_CREATE carry no guild_id, as on Discord.
    expect(byId.get(f.text.id)).not.toHaveProperty('guild_id');
    expect(d.threads.map((t: any) => t.id)).toEqual([live.id]);
    expect(d.threads[0]).toMatchObject({ type: 11, parent_id: f.text.id, name: 'Live thread' });
    expect(d.threads[0]).not.toHaveProperty('guild_id');
    expect(d.roles.map((r: any) => r.name)).toEqual(expect.arrayContaining(['@everyone', 'Relay', 'Mirror']));
    expect(d.members.map((m: any) => m.user.id)).toEqual([fake.application.id]);
    expect(d).toMatchObject({ large: false, member_count: 4 });
  });

  it('records the IDENTIFY it received', async () => {
    await session();
    const [id] = fake.gateway.received('IDENTIFY');
    expect(id!.d).toMatchObject({ token: fake.botToken, intents: ALL, properties: PROPERTIES });
    expect(fake.gateway.info()).toHaveLength(1);
    expect(fake.gateway.info()[0]).toMatchObject({ connected: true, intents: ALL, seq: 2 });
  });

  it('counts sessions against the start limit, and answers INVALID_SESSION (false) when it is used up', async () => {
    await session();
    expect((await rest.getGatewayBot()).session_start_limit.remaining).toBe(999);
    fake.gateway.sessionStartLimit.remaining = 0;
    expect((await rest.getGatewayBot()).session_start_limit.remaining).toBe(0);
    const c = await connect();
    await c.nextJson();
    c.send(identifyFrame());
    expect(await c.nextJson()).toMatchObject({ op: 9, d: false });
  });
});

describe('heartbeats', () => {
  it('acknowledges heartbeats with and without a sequence number', async () => {
    const { client } = await session();
    client.send({ op: 1, d: null });
    expect(await client.nextJson()).toMatchObject({ op: 11 });
    client.send({ op: 1, d: 2 });
    expect(await client.nextJson()).toMatchObject({ op: 11 });
    expect(fake.gateway.info()[0]!.heartbeats).toBe(2);
    expect(fake.gateway.received('HEARTBEAT').map((x) => x.d)).toEqual([null, 2]);
  });

  it('answers a heartbeat before IDENTIFY', async () => {
    const c = await connect();
    await c.nextJson();
    c.send({ op: 1, d: null });
    expect(await c.nextJson()).toMatchObject({ op: 11 });
  });

  it('stops answering when told to, so a client can detect a zombie', async () => {
    const { client } = await session();
    fake.gateway.ackHeartbeats = false;
    client.send({ op: 1, d: 2 });
    await sleep(150);
    expect(client.frames).toHaveLength(0);
    fake.gateway.ackHeartbeats = true;
    client.send({ op: 1, d: 2 });
    expect(await client.nextJson()).toMatchObject({ op: 11 });
  });
});

describe('dispatch', () => {
  it('sends webhook posts, bot posts and people’s messages with increasing sequence numbers', async () => {
    const { client } = await session();
    const hook = { id: f.textHook.id, token: f.textHook.token };
    await rest.executeWebhook(hook, { content: 'from an agent', username: 'Atlas' });
    fake.say(f.text.id, { as: f.alice, content: 'from a person' });
    await rest.createMessage(f.text.id, { content: 'from the bot' });
    const events = [await client.nextJson(), await client.nextJson(), await client.nextJson()];
    expect(events.map((e) => e.t)).toEqual(['MESSAGE_CREATE', 'MESSAGE_CREATE', 'MESSAGE_CREATE']);
    expect(events.map((e) => e.s)).toEqual([3, 4, 5]);
    expect(events.map((e) => e.d.content)).toEqual(['from an agent', 'from a person', 'from the bot']);
    const [agent, person, botPost] = events.map((e) => e.d);
    expect(agent).toMatchObject({
      guild_id: f.guild.id,
      channel_id: f.text.id,
      webhook_id: f.textHook.id,
      author: { id: f.textHook.id, username: 'Atlas', bot: true },
      type: 0,
    });
    expect(agent).not.toHaveProperty('member');
    expect(person).toMatchObject({
      guild_id: f.guild.id,
      author: { id: f.alice.id, username: 'alice', global_name: 'Alice' },
      member: { roles: [] },
      mentions: [],
    });
    expect(person.author.bot).toBeUndefined();
    expect(botPost.author).toMatchObject({ id: fake.application.id, bot: true });
    expect(agent.timestamp).toMatch(/^\d{4}-\d\d-\d\dT[\d:.]+Z$/);
  });

  it('sends edits, deletes and bulk deletes', async () => {
    const { client } = await session();
    const a = fake.say(f.text.id, { as: f.alice, content: 'one' });
    const b = fake.say(f.text.id, { as: f.alice, content: 'two' });
    const c = fake.say(f.text.id, { as: f.bob, content: 'three' });
    for (let i = 0; i < 3; i++) await client.nextJson();
    fake.edit(f.text.id, a.id, 'one, edited');
    fake.remove(f.text.id, b.id);
    fake.removeMany(f.text.id, [a.id, c.id]);
    const update = await client.nextJson();
    expect(update).toMatchObject({ t: 'MESSAGE_UPDATE', s: 6, d: { id: a.id, content: 'one, edited', guild_id: f.guild.id } });
    expect(update.d.edited_timestamp).toMatch(/^\d{4}/);
    expect(await client.nextJson()).toMatchObject({ t: 'MESSAGE_DELETE', s: 7, d: { id: b.id, channel_id: f.text.id, guild_id: f.guild.id } });
    expect(await client.nextJson()).toMatchObject({ t: 'MESSAGE_DELETE_BULK', s: 8, d: { ids: [a.id, c.id], channel_id: f.text.id, guild_id: f.guild.id } });
  });

  it('announces a forum post as THREAD_CREATE, then MESSAGE_CREATE in the thread (thread ID = message ID)', async () => {
    const { client } = await session();
    await rest.executeWebhook({ id: f.forumHook.id, token: f.forumHook.token }, { content: 'opening post', username: 'Atlas', thread_name: 'Topic' });
    const thread = await client.nextJson();
    const message = await client.nextJson();
    expect(thread).toMatchObject({
      t: 'THREAD_CREATE',
      s: 3,
      d: { type: 11, parent_id: f.forum.id, name: 'Topic', newly_created: true, guild_id: f.guild.id },
    });
    expect(message).toMatchObject({ t: 'MESSAGE_CREATE', s: 4, d: { content: 'opening post' } });
    expect(message.d.id).toBe(thread.d.id);
    expect(message.d.channel_id).toBe(thread.d.id);
  });

  it('announces thread starts from a message, then updates and deletions', async () => {
    const { client } = await session();
    const m = fake.say(f.text.id, { as: f.alice, content: 'start' });
    await client.nextJson();
    await rest.startThreadFromMessage(f.text.id, m.id, { name: 'Chat' });
    expect(await client.nextJson()).toMatchObject({ t: 'THREAD_CREATE', d: { id: m.id, name: 'Chat', parent_id: f.text.id, newly_created: true } });
    expect(await client.nextJson()).toMatchObject({ t: 'MESSAGE_UPDATE', d: { id: m.id, flags: 32 } });
    fake.world.updateThread(m.id, { name: 'Renamed', archived: true });
    expect(await client.nextJson()).toMatchObject({ t: 'THREAD_UPDATE', d: { id: m.id, name: 'Renamed', thread_metadata: { archived: true } } });
    fake.world.deleteThread(m.id);
    expect(await client.nextJson()).toMatchObject({ t: 'THREAD_DELETE', d: { id: m.id, guild_id: f.guild.id, parent_id: f.text.id, type: 11 } });
  });

  it('delivers system messages and replies with their types', async () => {
    const { client } = await session();
    const first = fake.say(f.text.id, { as: f.alice, content: 'question' });
    fake.say(f.text.id, { as: f.bob, content: 'answer', replyTo: first.id });
    fake.say(f.text.id, { as: f.alice, content: '', type: 7 });
    expect((await client.nextJson()).d.type).toBe(0);
    expect(await client.nextJson()).toMatchObject({ d: { type: 19, message_reference: { message_id: first.id } } });
    expect((await client.nextJson()).d.type).toBe(7);
  });

  it('can lag behind REST, so a client sees the HTTP answer first', async () => {
    const { client } = await session();
    fake.gateway.options.eventLagMs = 200;
    const { message } = await rest.executeWebhook({ id: f.textHook.id, token: f.textHook.token }, { content: 'slow gateway', username: 'Atlas' });
    expect(client.frames).toHaveLength(0);
    const event = await client.nextJson();
    expect(event.d.id).toBe(message.id);
  });

  it('only sends the events the session’s intents cover', async () => {
    const { client } = await session(Intent.guilds);
    const m = fake.say(f.text.id, { as: f.alice, content: 'invisible without GUILD_MESSAGES' });
    fake.startThread(f.text.id, m.id, 'visible with GUILDS', f.alice);
    const first = await client.nextJson();
    expect(first).toMatchObject({ t: 'THREAD_CREATE', s: 3 });
    await sleep(100);
    expect(client.frames).toHaveLength(0);
  });
});

describe('intents', () => {
  it('without MESSAGE_CONTENT, other people’s and webhooks’ text is empty but the bot’s own is not', async () => {
    const { client } = await session(Intent.guilds | Intent.guildMessages);
    await rest.executeWebhook({ id: f.textHook.id, token: f.textHook.token }, { content: 'webhook text', username: 'Atlas' });
    fake.say(f.text.id, { as: f.alice, content: 'person text' });
    await rest.createMessage(f.text.id, { content: 'bot text' });
    fake.say(f.text.id, { as: f.alice, content: `hey <@${fake.application.id}>` });
    const events = [await client.nextJson(), await client.nextJson(), await client.nextJson(), await client.nextJson()];
    expect(events.map((e) => e.d.content)).toEqual(['', '', 'bot text', `hey <@${fake.application.id}>`]);
    expect(events[0]!.d).toMatchObject({ embeds: [], attachments: [], components: [], author: { username: 'Atlas' } });
  });

  it('with MESSAGE_CONTENT, text comes through', async () => {
    const { client } = await session(ALL);
    await rest.executeWebhook({ id: f.textHook.id, token: f.textHook.token }, { content: 'webhook text', username: 'Atlas' });
    expect((await client.nextJson()).d.content).toBe('webhook text');
  });

  it('closes 4014 when MESSAGE_CONTENT is identified but not enabled for the application', async () => {
    const before = fake.application.flags;
    fake.application.flags = 0;
    try {
      const c = await connect();
      await c.nextJson();
      c.send(identifyFrame());
      expect(await c.waitClose()).toBe(CloseCode.disallowedIntents);
      expect(fake.gateway.info()).toHaveLength(0);
    } finally {
      fake.application.flags = before;
    }
  });
});

describe('resume', () => {
  it('replays what was missed, in order, then RESUMED', async () => {
    const { client, ready } = await session();
    const sessionId = ready.d.session_id;
    fake.say(f.text.id, { as: f.alice, content: 'seen' });
    const seen = await client.nextJson();
    expect(seen.s).toBe(3);
    client.kill();
    await fake.waitFor(() => !fake.gateway.info()[0]!.connected);

    fake.say(f.text.id, { as: f.alice, content: 'missed 1' });
    await rest.executeWebhook({ id: f.textHook.id, token: f.textHook.token }, { content: 'missed 2', username: 'Atlas' });
    fake.remove(f.text.id, seen.d.id);

    const again = await connect();
    expect((await again.nextJson()).op).toBe(10);
    again.send({ op: 6, d: { token: fake.botToken, session_id: sessionId, seq: 3 } });
    const replay = [await again.nextJson(), await again.nextJson(), await again.nextJson()];
    expect(replay.map((e) => [e.t, e.s])).toEqual([
      ['MESSAGE_CREATE', 4],
      ['MESSAGE_CREATE', 5],
      ['MESSAGE_DELETE', 6],
    ]);
    expect(replay.slice(0, 2).map((e) => e.d.content)).toEqual(['missed 1', 'missed 2']);
    expect(await again.nextJson()).toMatchObject({ t: 'RESUMED', s: 7 });
    expect(fake.gateway.info()[0]).toMatchObject({ connected: true, resumes: 1 });

    // Live again, and the numbers carry on.
    fake.say(f.text.id, { as: f.bob, content: 'live' });
    expect(await again.nextJson()).toMatchObject({ t: 'MESSAGE_CREATE', s: 8 });
  });

  it('replays only what comes after the sequence number the client reports', async () => {
    const { client, ready } = await session();
    fake.say(f.text.id, { as: f.alice, content: 'a' });
    fake.say(f.text.id, { as: f.alice, content: 'b' });
    await client.nextJson();
    await client.nextJson();
    client.kill();
    await fake.waitFor(() => !fake.gateway.info()[0]!.connected);
    const again = await connect();
    await again.nextJson();
    again.send({ op: 6, d: { token: fake.botToken, session_id: ready.d.session_id, seq: 3 } });
    expect(await again.nextJson()).toMatchObject({ t: 'MESSAGE_CREATE', s: 4, d: { content: 'b' } });
    expect(await again.nextJson()).toMatchObject({ t: 'RESUMED' });
  });

  it('closes 4007 for a sequence number the session never reached', async () => {
    const { client, ready } = await session();
    client.kill();
    await fake.waitFor(() => !fake.gateway.info()[0]!.connected);
    const again = await connect();
    await again.nextJson();
    again.send({ op: 6, d: { token: fake.botToken, session_id: ready.d.session_id, seq: 999 } });
    expect(await again.waitClose()).toBe(CloseCode.invalidSeq);
  });

  it('answers INVALID_SESSION (false) for an unknown session, and the client can IDENTIFY on the same connection', async () => {
    const c = await connect();
    await c.nextJson();
    c.send({ op: 6, d: { token: fake.botToken, session_id: 'f'.repeat(32), seq: 1 } });
    expect(await c.nextJson()).toMatchObject({ op: 9, d: false });
    c.send(identifyFrame());
    expect(await c.nextJson()).toMatchObject({ t: 'READY' });
  });

  it('answers INVALID_SESSION when told to: false, or true for a session that can still be resumed', async () => {
    const { client, ready } = await session();
    client.kill();
    await fake.waitFor(() => !fake.gateway.info()[0]!.connected);

    fake.gateway.nextResume = 'invalid-resumable';
    const first = await connect();
    await first.nextJson();
    first.send({ op: 6, d: { token: fake.botToken, session_id: ready.d.session_id, seq: 2 } });
    expect(await first.nextJson()).toMatchObject({ op: 9, d: true });
    // The session is still there: asking again works.
    first.send({ op: 6, d: { token: fake.botToken, session_id: ready.d.session_id, seq: 2 } });
    expect(await first.nextJson()).toMatchObject({ t: 'RESUMED' });
    first.kill();
    await fake.waitFor(() => !fake.gateway.info()[0]!.connected);

    fake.gateway.nextResume = 'invalid';
    const second = await connect();
    await second.nextJson();
    second.send({ op: 6, d: { token: fake.botToken, session_id: ready.d.session_id, seq: 3 } });
    expect(await second.nextJson()).toMatchObject({ op: 9, d: false });
    // And now the session really is gone.
    second.send({ op: 6, d: { token: fake.botToken, session_id: ready.d.session_id, seq: 3 } });
    expect(await second.nextJson()).toMatchObject({ op: 9, d: false });
  });

  it('forgets a session that stayed away longer than the resume window', async () => {
    fake.gateway.options.resumeWindowMs = 50;
    const { client, ready } = await session();
    client.kill();
    await fake.waitFor(() => !fake.gateway.info()[0]!.connected);
    await sleep(100);
    const again = await connect();
    await again.nextJson();
    again.send({ op: 6, d: { token: fake.botToken, session_id: ready.d.session_id, seq: 2 } });
    expect(await again.nextJson()).toMatchObject({ op: 9, d: false });
  });

  it('moves a session to the new connection when it is resumed while the old one is still open', async () => {
    const { client: old, ready } = await session();
    const again = await connect();
    await again.nextJson();
    again.send({ op: 6, d: { token: fake.botToken, session_id: ready.d.session_id, seq: 2 } });
    expect(await again.nextJson()).toMatchObject({ t: 'RESUMED' });
    expect(await old.waitClose()).toBe(CloseCode.unknownError);
    fake.say(f.text.id, { as: f.alice, content: 'goes to the new one' });
    expect((await again.nextJson()).d.content).toBe('goes to the new one');
  });

  it('rejects a wrong token on RESUME (4004)', async () => {
    const c = await connect();
    await c.nextJson();
    c.send({ op: 6, d: { token: 'wrong', session_id: 'x', seq: 1 } });
    expect(await c.waitClose()).toBe(CloseCode.authenticationFailed);
  });
});

describe('server-initiated disconnects', () => {
  it('RECONNECT (op 7) asks the client to resume', async () => {
    const { client } = await session();
    fake.gateway.reconnect();
    expect(await client.nextJson()).toMatchObject({ op: 7, d: null });
  });

  it('closes with a chosen code and keeps the session resumable', async () => {
    const { client, ready } = await session();
    fake.gateway.close(4000, 'Unknown error');
    expect(await client.waitClose()).toBe(4000);
    expect(client.closed?.reason).toBe('Unknown error');
    const again = await connect();
    await again.nextJson();
    again.send({ op: 6, d: { token: fake.botToken, session_id: ready.d.session_id, seq: 2 } });
    expect(await again.nextJson()).toMatchObject({ t: 'RESUMED' });
  });

  it('4009 (and 4003, 4007) end the session: resuming gets INVALID_SESSION', async () => {
    const { client, ready } = await session();
    fake.gateway.close(4009, 'Session timed out');
    expect(await client.waitClose()).toBe(4009);
    const again = await connect();
    await again.nextJson();
    again.send({ op: 6, d: { token: fake.botToken, session_id: ready.d.session_id, seq: 2 } });
    expect(await again.nextJson()).toMatchObject({ op: 9, d: false });
  });

  it('INVALID_SESSION on a live connection', async () => {
    const { client } = await session();
    fake.gateway.invalidate(true);
    expect(await client.nextJson()).toMatchObject({ op: 9, d: true });
  });

  it('drops the connection with no close frame', async () => {
    const { client } = await session();
    fake.gateway.drop();
    expect(await client.waitClose()).toBe(1006);
  });

  it('can send text the client cannot parse', async () => {
    const { client } = await session();
    fake.gateway.sendRaw('{not json');
    expect((await client.next()).data.toString()).toBe('{not json');
  });
});

describe('close codes', () => {
  const closeFor = async (act: (c: RawClient) => void, opts: { hello?: boolean } = {}): Promise<number> => {
    const c = await connect();
    if (opts.hello !== false) await c.nextJson();
    act(c);
    return c.waitClose();
  };

  it('4004 for a wrong token', async () => {
    expect(await closeFor((c) => c.send(identifyFrame({ token: 'wrong' })))).toBe(4004);
  });

  it('4013 for invalid intents', async () => {
    expect(await closeFor((c) => c.send(identifyFrame({ intents: 1 << 30 })))).toBe(4013);
    expect(await closeFor((c) => c.send(identifyFrame({ intents: -1 })))).toBe(4013);
    expect(await closeFor((c) => c.send(identifyFrame({ intents: 'many' })))).toBe(4013);
  });

  it('4010 for an invalid shard', async () => {
    expect(await closeFor((c) => c.send(identifyFrame({ shard: [1, 1] })))).toBe(4010);
  });

  it('4005 for a second IDENTIFY', async () => {
    const { client } = await session();
    client.send(identifyFrame());
    expect(await client.waitClose()).toBe(4005);
  });

  it('4003 for anything but a heartbeat before IDENTIFY', async () => {
    expect(await closeFor((c) => c.send({ op: 3, d: { status: 'online' } }))).toBe(4003);
  });

  it('4002 for frames that are not JSON objects or lack what an opcode needs', async () => {
    expect(await closeFor((c) => c.sendText('not json'))).toBe(4002);
    expect(await closeFor((c) => c.sendText('[1,2]'))).toBe(4002);
    expect(await closeFor((c) => c.send({ d: {} }))).toBe(4002);
    expect(await closeFor((c) => c.send({ op: 2, d: { token: fake.botToken, intents: ALL } }))).toBe(4002);
    expect(await closeFor((c) => c.send({ op: 1, d: 'nope' }))).toBe(4002);
  });

  it('4001 for an unknown opcode', async () => {
    expect(await closeFor((c) => c.send({ op: 99, d: null }))).toBe(4001);
  });

  it('4012 for an unsupported API version, and 4002 for an unsupported encoding', async () => {
    const old = await connect('?v=8&encoding=json');
    expect(await old.waitClose()).toBe(4012);
    const etf = await connect('?v=10&encoding=etf');
    expect(await etf.waitClose()).toBe(4002);
  });

  it('4008 after more than 120 frames in a minute', async () => {
    const c = await connect();
    await c.nextJson();
    for (let i = 0; i < 125; i++) c.send({ op: 1, d: null });
    expect(await c.waitClose()).toBe(4008);
  });
});

describe('WebSocket framing', () => {
  it('answers a ping with a pong carrying the same payload', async () => {
    const { client } = await session();
    client.ping(Buffer.from('are you there'));
    const pong = await client.next();
    expect(pong.opcode).toBe(0xa);
    expect(pong.data.toString()).toBe('are you there');
  });

  it('reassembles a message sent in fragments, with a ping in the middle', async () => {
    const { client } = await session();
    const text = JSON.stringify({ op: 1, d: 2 });
    client.sendFrame(0x1, Buffer.from(text.slice(0, 4)), { fin: false });
    client.ping();
    client.sendFrame(0x0, Buffer.from(text.slice(4, 8)), { fin: false });
    client.sendFrame(0x0, Buffer.from(text.slice(8)), { fin: true });
    expect((await client.next()).opcode).toBe(0xa);
    expect(await client.nextJson()).toMatchObject({ op: 11 });
  });

  it('reads long frames: 16-bit and 64-bit lengths, multi-byte characters', async () => {
    const { client } = await session();
    client.send({ op: 1, d: null, note: 'é'.repeat(200) });
    expect(await client.nextJson()).toMatchObject({ op: 11 });
    client.send({ op: 1, d: null, pad: 'x'.repeat(70_000) });
    expect(await client.nextJson()).toMatchObject({ op: 11 });
    client.send({ op: 1, d: null, note: '日本語🙂' });
    expect(await client.nextJson()).toMatchObject({ op: 11 });
  });

  it('writes unmasked frames with the right length encoding', () => {
    const small = encodeFrame(0x1, Buffer.alloc(5));
    expect([small[0], small[1]]).toEqual([0x81, 5]);
    const medium = encodeFrame(0x1, Buffer.alloc(300));
    expect([medium[0], medium[1], medium.readUInt16BE(2)]).toEqual([0x81, 126, 300]);
    const large = encodeFrame(0x1, Buffer.alloc(70_000));
    expect([large[0], large[1], Number(large.readBigUInt64BE(2))]).toEqual([0x81, 127, 70_000]);
    expect(large.length).toBe(10 + 70_000);
  });

  it('echoes a close frame and ends the connection', async () => {
    const { client } = await session();
    client.close(1000, 'bye');
    expect(await client.waitClose()).toBe(1000);
    expect(client.closed?.code).toBe(1000);
    await fake.waitFor(() => !fake.gateway.info()[0]!.connected);
  });

  it('closes 1002 for an unmasked client frame and 1007 for invalid UTF-8', async () => {
    const { client } = await session();
    client.sendText('{"op":1,"d":null}', { mask: false });
    expect(await client.waitClose()).toBe(1002);
    const { client: second } = await session();
    second.sendFrame(0x1, Buffer.from([0xff, 0xfe, 0xfd]));
    expect(await second.waitClose()).toBe(1007);
  });

  it('closes 1002 for a continuation frame with nothing to continue', async () => {
    const { client } = await session();
    client.sendFrame(0x0, Buffer.from('x'));
    expect(await client.waitClose()).toBe(1002);
  });
});
