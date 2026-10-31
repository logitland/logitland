// Discord calling the relay: signed interactions to an endpoint, and the follow-ups coming back.

import { createPublicKey, verify } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DiscordFake } from '../src/index.ts';
import { fixture, sleep, type Fixture } from './helpers.ts';

let f: Fixture;
let fake: DiscordFake;
let relay: Server;
let endpoint: string;
const received: { headers: IncomingMessage['headers']; raw: string; verified: boolean }[] = [];
let respond: (body: any) => { status: number; body: unknown } = () => ({ status: 200, body: { type: 4, data: { content: 'ok', flags: 64 } } });
let delayMs = 0;

const SPKI_ED25519_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

beforeAll(async () => {
  f = await fixture();
  fake = f.fake;
  relay = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks).toString('utf8');
    // What the relay does: check the signature over timestamp + raw body against the application's public key.
    const signature = String(req.headers['x-signature-ed25519'] ?? '');
    const timestamp = String(req.headers['x-signature-timestamp'] ?? '');
    const key = createPublicKey({ key: Buffer.concat([SPKI_ED25519_PREFIX, Buffer.from(fake.publicKey, 'hex')]), format: 'der', type: 'spki' });
    const verified = signature.length === 128 && verify(null, Buffer.from(timestamp + raw), key, Buffer.from(signature, 'hex'));
    received.push({ headers: req.headers, raw, verified });
    if (!verified) return void res.writeHead(401).end('invalid request signature');
    if (delayMs) await sleep(delayMs);
    const out = respond(JSON.parse(raw));
    res.writeHead(out.status, { 'content-type': 'application/json' }).end(JSON.stringify(out.body));
  }).listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => relay.once('listening', resolve));
  endpoint = `http://127.0.0.1:${(relay.address() as AddressInfo).port}/discord/interactions`;
  fake.application.interactions_endpoint_url = endpoint;
});
afterAll(async () => {
  relay.closeAllConnections();
  await new Promise((resolve) => relay.close(resolve));
  await fake.close();
});

describe('sending interactions', () => {
  it('signs a slash command with the application key, in Discord’s shape', async () => {
    received.length = 0;
    const out = await fake.interact({ user: f.alice.id, command: { name: 'mirror', subcommand: 'agree' }, channelId: f.text.id });
    expect(out.status).toBe(200);
    expect(out.body).toEqual({ type: 4, data: { content: 'ok', flags: 64 } });
    expect(received).toHaveLength(1);
    expect(received[0]!.verified).toBe(true);
    expect(received[0]!.headers['content-type']).toBe('application/json');
    const p = JSON.parse(received[0]!.raw);
    expect(p).toMatchObject({
      type: 2,
      application_id: fake.application.id,
      guild_id: f.guild.id,
      channel_id: f.text.id,
      version: 1,
      data: { name: 'mirror', type: 1, options: [{ name: 'agree', type: 1 }] },
      member: { user: { id: f.alice.id, username: 'alice' }, roles: [] },
    });
    expect(p.id).toMatch(/^\d{17,20}$/);
    expect(p.token.length).toBeGreaterThan(40);
    expect(Number(received[0]!.headers['x-signature-timestamp'])).toBeCloseTo(Date.now() / 1000, -1);
  });

  it('puts the member’s current roles in the payload, and the registered command ID', async () => {
    const [cmd] = await new (await import('@logitland/discord')).DiscordRest({ botToken: fake.botToken, base: fake.apiBase }).putGuildCommands(
      fake.application.id,
      f.guild.id,
      [{ name: 'mirror', description: 'x', type: 1 }],
    );
    fake.world.setMemberRole(f.guild.id, f.bob.id, f.consentRole.id, true);
    received.length = 0;
    await fake.interact({ user: f.bob.id, command: { name: 'mirror', subcommand: 'leave' } });
    const p = JSON.parse(received[0]!.raw);
    expect(p.member.roles).toEqual([f.consentRole.id]);
    expect(p.data.id).toBe(cmd!.id);
    expect(p.channel_id).toBe(f.text.id);
  });

  it('sends a button click and a ping', async () => {
    received.length = 0;
    const welcome = await fake.world.postMessage(f.text.id, { author: fake.world.botUser, content: 'Welcome' });
    await fake.interact({ user: f.alice.id, button: { customId: 'mirror_agree', messageId: welcome.id }, channelId: f.text.id });
    expect(JSON.parse(received[0]!.raw)).toMatchObject({ type: 3, data: { custom_id: 'mirror_agree', component_type: 2 }, message: { id: welcome.id } });
    await fake.interact({ user: f.alice.id, ping: true });
    expect(JSON.parse(received[1]!.raw)).toMatchObject({ type: 1 });
  });

  it('changes the clicked button’s message with an UPDATE_MESSAGE answer and later edits of @original', async () => {
    const card = (content: string) => [{ type: 17, components: [{ type: 10, content }] }];
    const message = fake.world.postMessage(f.text.id, { author: fake.world.botUser, flags: 1 << 15, components: card('Full card') });
    respond = () => ({ status: 200, body: { type: 7, data: { flags: 1 << 15, components: card('One line') } } });
    const { interaction } = await fake.interact({ user: f.alice.id, button: { customId: 'staff_dismiss:x', messageId: message.id }, channelId: f.text.id });
    expect(fake.messages(f.text.id).find((m) => m.id === message.id)?.components).toEqual(card('One line'));

    const res = await fetch(`${fake.apiBase}/webhooks/${fake.application.id}/${interaction.token}/messages/@original`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ components: card('Done') }),
    });
    expect(res.status).toBe(200);
    expect(fake.messages(f.text.id).find((m) => m.id === message.id)?.components).toEqual(card('Done'));

    respond = () => ({ status: 200, body: { type: 7, data: { content: 'text on a V2 message' } } });
    await expect(fake.interact({ user: f.alice.id, button: { customId: 'staff_dismiss:x', messageId: message.id }, channelId: f.text.id })).rejects.toThrow(
      /refuse this UPDATE_MESSAGE/,
    );
    respond = () => ({ status: 200, body: { type: 4, data: { content: 'ok', flags: 64 } } });
  });

  it('sends a bad or missing signature, and a stale timestamp, when asked', async () => {
    received.length = 0;
    const bad = await fake.interact({ user: f.alice.id, command: { name: 'mirror', subcommand: 'status' }, signature: 'invalid' });
    expect(bad.status).toBe(401);
    expect(received[0]!.verified).toBe(false);
    const missing = await fake.interact({ user: f.alice.id, command: { name: 'mirror', subcommand: 'status' }, signature: 'missing' });
    expect(missing.status).toBe(401);
    expect(received[1]!.headers['x-signature-ed25519']).toBeUndefined();
    const stale = await fake.interact({ user: f.alice.id, command: { name: 'mirror', subcommand: 'status' }, timestamp: Math.floor(Date.now() / 1000) - 3600 });
    expect(stale.status).toBe(200);
    expect(Number(received[2]!.headers['x-signature-timestamp'])).toBeLessThan(Date.now() / 1000 - 3000);
    expect(received[2]!.verified).toBe(true);
  });

  it('uses a key supplied by the test', async () => {
    const { generateKeyPairSync } = await import('node:crypto');
    const pair = generateKeyPairSync('ed25519');
    const other = await DiscordFake.start({ interactionKeyPem: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() });
    try {
      const expected = createPublicKey(pair.privateKey).export({ type: 'spki', format: 'der' }).subarray(-32).toString('hex');
      expect(other.publicKey).toBe(expected);
      expect(other.publicKey).not.toBe(fake.publicKey);
    } finally {
      await other.close();
    }
  });
});

describe('follow-ups', () => {
  const follow = (token: string, path: string, method = 'PATCH', body: unknown = { content: 'done' }) =>
    fetch(`${fake.apiBase}/webhooks/${fake.application.id}/${token}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('edits the original answer once the interaction was acknowledged', async () => {
    respond = () => ({ status: 200, body: { type: 5, data: { flags: 64 } } });
    const { interaction } = await fake.interact({ user: f.alice.id, command: { name: 'mirror', subcommand: 'leave' } });
    expect(interaction.acknowledged).toBe(true);
    const res = await follow(interaction.token, '/messages/@original', 'PATCH', { content: 'You left the mirror', allowed_mentions: { parse: [] } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ content: 'You left the mirror', flags: 64 });
    expect(interaction.followUps).toEqual([expect.objectContaining({ kind: 'original', content: 'You left the mirror' })]);
    await follow(interaction.token, '/messages/@original', 'PATCH', { content: 'Edited again' });
    expect(interaction.followUps[0]!.content).toBe('Edited again');
    const extra = await follow(interaction.token, '', 'POST', { content: 'one more', flags: 64 });
    expect(extra.status).toBe(200);
    expect(interaction.followUps.map((x) => x.content)).toEqual(['Edited again', 'one more']);
    expect((await follow(interaction.token, '/messages/@original', 'DELETE')).status).toBe(204);
    expect(interaction.followUps.map((x) => x.content)).toEqual(['one more']);
    respond = () => ({ status: 200, body: { type: 4, data: { content: 'ok', flags: 64 } } });
  });

  it('answers 404 until the interaction has been acknowledged, and 401 for a token it never issued', async () => {
    respond = () => ({ status: 200, body: { type: 5 } });
    delayMs = 300;
    const pending = fake.interact({ user: f.alice.id, command: { name: 'mirror', subcommand: 'status' } });
    await sleep(100);
    const token = [...fake.interactions.records.values()].at(-1)!.token;
    expect((await follow(token, '/messages/@original')).status).toBe(404);
    await pending;
    delayMs = 0;
    expect((await follow(token, '/messages/@original')).status).toBe(200);
    const unknown = await follow('not-a-token', '/messages/@original');
    expect(unknown.status).toBe(401);
    expect(await unknown.json()).toMatchObject({ code: 50027 });
    respond = () => ({ status: 200, body: { type: 4, data: { content: 'ok', flags: 64 } } });
  });

  it('expires the token after fifteen minutes', async () => {
    let now = Date.now();
    const timed = await DiscordFake.start({
      now: () => now,
      interactionKeyPem: fake.interactions.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    });
    const guild = timed.addGuild();
    const user = timed.addMember(guild.id, { username: 'dana' }).user;
    timed.addChannel(guild.id, { name: 'general' });
    timed.application.interactions_endpoint_url = endpoint;
    try {
      const { interaction } = await timed.interact({ user: user.id, command: { name: 'mirror', subcommand: 'status' } });
      const url = `${timed.apiBase}/webhooks/${timed.application.id}/${interaction.token}/messages/@original`;
      const patch = () => fetch(url, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'late' }) });
      expect((await patch()).status).toBe(200);
      now += 16 * 60_000;
      expect((await patch()).status).toBe(401);
    } finally {
      await timed.close();
    }
  });
});
