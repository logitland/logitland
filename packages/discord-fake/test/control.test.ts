// The /_fake control API, used the way a separate process would: nothing but HTTP.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DiscordFake } from '../src/index.ts';
import { RawClient } from './ws-client.ts';

let fake: DiscordFake;
let control: string;

beforeAll(async () => {
  fake = await DiscordFake.start();
  control = fake.controlUrl;
});
afterAll(() => fake.close());

async function call<T = any>(method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> {
  const res = await fetch(`${control}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, body: (await res.json()) as T };
}

describe('seeding and acting over HTTP', () => {
  const ids: Record<string, string> = {};

  it('seeds a guild with channels of every type, a role and members', async () => {
    ids.guild = (await call('POST', '/guilds', { name: 'Remote' })).body.id;
    ids.role = (await call('POST', '/roles', { guild: ids.guild, name: 'Mirror', position: 3 })).body.id;
    ids.alice = (await call('POST', '/members', { guild: ids.guild, username: 'alice' })).body.id;
    for (const [key, kind, tags] of [
      ['text', 'text', undefined],
      ['news', 'announcement', undefined],
      ['forum', 'forum', [{ name: 'idea' }]],
      ['media', 'media', [{ name: 'art' }]],
    ] as const)
      ids[key] = (await call('POST', '/channels', { guild: ids.guild, name: key, kind, tags })).body.id;
    const hook = (await call('POST', '/webhooks', { channel: ids.text, name: 'Relay' })).body;
    expect(hook.url).toBe(`https://discord.com/api/webhooks/${hook.id}/${hook.token}`);
    expect(hook.fakeUrl).toBe(`${fake.apiBase}/webhooks/${hook.id}/${hook.token}`);
    ids.hookId = hook.id;
    ids.hookToken = hook.token;

    const state = (await call('GET', '/state')).body;
    expect(state).toMatchObject({ api_base: fake.apiBase, gateway_url: fake.gatewayUrl, bot_token: fake.botToken, public_key: fake.publicKey });
    const guild = state.guilds.find((g: any) => g.id === ids.guild);
    expect(guild.channels.map((c: any) => c.type).sort((a: number, b: number) => a - b)).toEqual([0, 5, 15, 16]);
    expect(guild.channels.find((c: any) => c.id === ids.text).webhooks[0]).toMatchObject({ id: ids.hookId, name: 'Relay' });
    expect(guild.members.map((m: any) => m.username)).toEqual(expect.arrayContaining(['alice']));
  });

  it('posts, edits and deletes as a person, and reads everything posted', async () => {
    const m = (await call('POST', '/messages', { channel: ids.text, as: ids.alice, content: 'hello from afar' })).body;
    expect(m).toMatchObject({ content: 'hello from afar', author: { id: ids.alice } });
    await call('PATCH', `/messages/${ids.text}/${m.id}`, { content: 'edited' });
    expect((await call('GET', `/messages?channel=${ids.text}`)).body.messages.map((x: any) => x.content)).toEqual(['edited']);
    await call('DELETE', `/messages/${ids.text}/${m.id}`);
    expect((await call('GET', `/messages?channel=${ids.text}`)).body.messages).toEqual([]);
  });

  it('starts forum posts and threads, updates and deletes them', async () => {
    const post = (await call('POST', '/messages', { channel: ids.forum, as: ids.alice, content: 'my idea', thread_name: 'An idea' })).body;
    expect(post.channel_id).toBe(post.id);
    const starter = (await call('POST', '/messages', { channel: ids.news, as: ids.alice, content: 'news' })).body;
    const thread = (await call('POST', '/threads', { channel: ids.news, message: starter.id, name: 'Discuss', as: ids.alice })).body;
    expect(thread).toMatchObject({ id: starter.id, type: 10 });
    expect((await call('PATCH', `/threads/${thread.id}`, { archived: true, name: 'Closed' })).body).toMatchObject({
      name: 'Closed',
      thread_metadata: { archived: true },
    });
    await call('DELETE', `/threads/${thread.id}`);
    expect((await call('GET', `/messages?channel=${thread.id}`)).status).toBe(400);
  });

  it('grants and takes a role as an admin would', async () => {
    await call('POST', `/members/${ids.guild}/${ids.alice}/roles/${ids.role}`, {});
    expect(fake.world.guild(ids.guild!).members.get(ids.alice!)!.roles).toEqual([ids.role]);
    await call('POST', `/members/${ids.guild}/${ids.alice}/roles/${ids.role}`, { remove: true });
    expect(fake.world.guild(ids.guild!).members.get(ids.alice!)!.roles).toEqual([]);
  });

  it('records each request, filters by route, and clears', async () => {
    await fetch(`${fake.apiBase}/webhooks/${ids.hookId}/${ids.hookToken}?wait=true`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'logged', username: 'Atlas' }),
    });
    const { requests } = (await call('GET', '/requests?route=webhook.execute')).body;
    expect(requests.at(-1)).toMatchObject({
      route: 'webhook.execute',
      method: 'POST',
      status: 200,
      body: { content: 'logged', username: 'Atlas' },
      query: { wait: 'true' },
    });
    await call('DELETE', '/requests');
    expect((await call('GET', '/requests')).body.requests).toEqual([]);
  });

  it('injects and removes failures', async () => {
    const { id } = (
      await call('POST', '/failures', { match: { route: 'webhook.execute' }, behaviour: { type: 'rate_limit', retryAfter: 4 }, times: 'forever' })
    ).body;
    const post = () =>
      fetch(`${fake.apiBase}/webhooks/${ids.hookId}/${ids.hookToken}?wait=true`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: 'x', username: 'A' }),
      });
    const res = await post();
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('4');
    expect(await res.json()).toMatchObject({ retry_after: 4, global: false });
    expect((await post()).status).toBe(429);
    expect((await call('GET', '/failures')).body.failures[0]).toMatchObject({ id, hits: 2, times: 'forever' });
    await call('DELETE', `/failures/${id}`);
    expect((await post()).status).toBe(200);
    expect((await call('POST', '/failures', { behaviour: { type: 'explode' } })).status).toBe(400);
  });

  it('changes the application and the rate limits', async () => {
    expect((await call('PATCH', '/application', { messageContent: 'off', interactions_endpoint_url: 'http://127.0.0.1:9/x' })).body).toMatchObject({
      flags: 0,
      interactions_endpoint_url: 'http://127.0.0.1:9/x',
    });
    await call('PATCH', '/application', { messageContent: 'limited', interactions_endpoint_url: null });
    expect(fake.application.flags).toBe(1 << 19);
    expect((await call('POST', '/rate-limits', { enforce: true, webhook: { limit: 1 } })).body).toMatchObject({ enforce: true, webhook: { limit: 1 } });
    await call('POST', '/rate-limits', { enforce: false, webhook: { limit: 5 } });
  });

  it('refuses bad input plainly', async () => {
    expect(await call('POST', '/guilds', { name: 5 })).toMatchObject({ status: 400, body: { error: 'name must be a string' } });
    expect((await call('POST', '/channels', {})).body.error).toBe('guild is required');
    expect((await call('GET', '/nothing')).status).toBe(404);
    const bad = await fetch(`${control}/guilds`, { method: 'POST', body: '{nope' });
    expect(bad.status).toBe(400);
  });
});

describe('steering the Gateway over HTTP', () => {
  it('closes, reconnects, drops and stops heartbeats', async () => {
    const connect = async () => {
      const c = await RawClient.connect(`${fake.gatewayUrl}?v=10&encoding=json`);
      await c.nextJson();
      c.send({ op: 2, d: { token: fake.botToken, intents: 513, properties: {} } });
      await c.nextJson();
      await c.nextJson();
      return c;
    };
    const a = await connect();
    expect((await call('GET', '/gateway')).body.sessions).toHaveLength(1);
    await call('POST', '/gateway/reconnect');
    expect(await a.nextJson()).toMatchObject({ op: 7 });
    await call('POST', '/gateway/heartbeats', { ack: false });
    a.send({ op: 1, d: 2 });
    await new Promise((r) => setTimeout(r, 100));
    expect(a.frames).toHaveLength(0);
    await call('POST', '/gateway/heartbeats', { ack: true });
    await call('POST', '/gateway/raw', { text: 'garbage' });
    expect((await a.next()).data.toString()).toBe('garbage');
    await call('POST', '/gateway/close', { code: 4000, reason: 'bye' });
    expect(await a.waitClose()).toBe(4000);

    const b = await connect();
    await call('POST', '/gateway/drop');
    expect(await b.waitClose()).toBe(1006);

    await call('POST', '/gateway/next-resume', { mode: 'invalid' });
    const sessionId = (await call('GET', '/gateway')).body.sessions[0].id;
    const c = await RawClient.connect(`${fake.gatewayUrl}?v=10&encoding=json`);
    await c.nextJson();
    c.send({ op: 6, d: { token: fake.botToken, session_id: sessionId, seq: 2 } });
    expect(await c.nextJson()).toMatchObject({ op: 9, d: false });
    c.kill();
    expect((await call('POST', '/gateway/options', { heartbeatIntervalMs: 1234 })).body.heartbeatIntervalMs).toBe(1234);
    expect((await call('POST', '/gateway/session-limit', { remaining: 3 })).body.remaining).toBe(3);
  });
});
