import { describe, expect, it, vi } from 'vitest';
import { relayApp } from './app';
import { scrubPerson } from './services/scrub';
import { GUILD, LOUNGE, harness, seedChannel, type Harness } from './testing';

// scrubPerson (B1) was a stub while this was written, so it is replaced by a stand-in that keeps its contract:
// tombstone the person's messages and say how many.
vi.mock('./services/scrub', () => ({
  scrubMessage: vi.fn(),
  scrubPerson: vi.fn(async (relay: import('./context').Relay, discordUserId: string) => {
    const r = await relay.db
      .prepare("UPDATE conversation SET content = NULL, deleted_at = ?, removed_by = 'author' WHERE discord_user_id = ? AND deleted_at IS NULL")
      .bind(relay.now().toISOString(), discordUserId)
      .run();
    return { messages: r.meta.changes };
  }),
}));

const PERSON = '700000000000000001';
const APP_ID = '400000000000000001';
const ROLE = '500000000000000001';
const TOKEN = 'interaction-token-abc123';
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

async function setup(opts: { start?: string } = {}) {
  const h = harness(opts);
  const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  h.relay.config.discord.publicKey = hex(await crypto.subtle.exportKey('raw', pair.publicKey));
  const app = relayApp(h.relay);
  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => void pending.push(p), passThroughOnException() {}, props: {} };

  const sign = async (raw: string, timestamp = String(Math.floor(h.now().getTime() / 1000)), key = pair.privateKey) => ({
    'x-signature-ed25519': hex(await crypto.subtle.sign({ name: 'Ed25519' }, key, new TextEncoder().encode(timestamp + raw))),
    'x-signature-timestamp': timestamp,
  });
  /** Posts an interaction signed by Discord's key (or with the headers you give), and waits for deferred work. */
  async function sendRaw(raw: string, headers?: Record<string, string>) {
    const res = await app.request(
      '/discord/interactions',
      { method: 'POST', headers: { 'content-type': 'application/json', ...(headers ?? (await sign(raw))) }, body: raw },
      undefined,
      ctx,
    );
    await Promise.all(pending.splice(0));
    return res;
  }
  const send = (payload: unknown, headers?: Record<string, string>) => sendRaw(JSON.stringify(payload), headers);
  return { h, send, sendRaw, sign, pair };
}

type Setup = Awaited<ReturnType<typeof setup>>;

const base = { id: '800000000000000001', application_id: APP_ID, token: TOKEN, version: 1 };
const member = (user = PERSON, roles: string[] = []) => ({ user: { id: user, username: 'pat' }, roles });
const command = (sub: string, o: { guild?: string | null; user?: string; roles?: string[] } = {}) => ({
  ...base,
  type: 2,
  ...(o.guild === null ? { user: { id: o.user ?? PERSON } } : { guild_id: o.guild ?? GUILD, member: member(o.user, o.roles) }),
  data: { id: '810000000000000001', name: 'mirror', type: 1, options: [{ name: sub, type: 1 }] },
});
const button = (customId = 'mirror_agree') => ({ ...base, type: 3, guild_id: GUILD, member: member(), data: { custom_id: customId, component_type: 2 } });

const jsonOf = async (res: Response) => (await res.json()) as { type: number; data?: { content?: string; flags?: number } };

const personRow = (h: Harness) =>
  h.db.prepare('SELECT * FROM consents WHERE discord_user_id = ?').bind(PERSON).first<{ method: string; granted_at: string; revoked_at: string | null }>();
const audits = async (h: Harness) =>
  (
    await h.db
      .prepare(
        "SELECT actor_type, actor_id, action, target_id, reason, diff FROM audit_log WHERE action LIKE 'consent.%' OR action LIKE 'person.%' ORDER BY rowid",
      )
      .all<{ actor_type: string; actor_id: string; action: string; target_id: string; reason: string | null; diff: string | null }>()
  ).results;
const discordPaths = (h: Harness) => h.discordCalls.map((r) => `${r.method} ${new URL(r.url).pathname}`);

async function someone(h: Harness, id: string, o: { person?: string; channel?: string; deleted?: boolean } = {}) {
  await h.db
    .prepare(
      "INSERT INTO conversation (message_id, channel_id, author_kind, author_ref, discord_user_id, display_name, content, created_at, deleted_at) VALUES (?, ?, 'human', 'p_x', ?, 'Pat', 'hello', ?, ?)",
    )
    .bind(id, o.channel ?? LOUNGE, o.person ?? PERSON, h.now().toISOString(), o.deleted ? h.now().toISOString() : null)
    .run();
}

describe('interaction requests', () => {
  it('answer a PING with a PONG', async () => {
    const { send } = await setup();
    const res = await send({ ...base, type: 1 });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual({ type: 1 });
  });

  it('refuse a bad signature, a signature from another key, a changed body and missing headers with 401', async () => {
    const { send, sign, h } = await setup();
    const payload = { ...base, type: 1 };
    const raw = JSON.stringify(payload);
    const good = await sign(raw);

    const other = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    expect((await send(payload, { ...good, 'x-signature-ed25519': 'ab'.repeat(64) })).status).toBe(401);
    expect((await send(payload, await sign(raw, undefined, other.privateKey))).status).toBe(401);
    expect((await send({ ...payload, id: '800000000000000002' }, good)).status).toBe(401);
    expect((await send(payload, { ...good, 'x-signature-ed25519': 'not hex' })).status).toBe(401);
    expect((await send(payload, { 'x-signature-timestamp': good['x-signature-timestamp'] })).status).toBe(401);
    expect((await send(payload, { 'x-signature-ed25519': good['x-signature-ed25519'] })).status).toBe(401);
    expect((await send(payload, { ...good, 'x-signature-timestamp': 'yesterday' })).status).toBe(401);
    expect((await send(payload, good)).status).toBe(200);
    const body = (await (await send(payload, { ...good, 'x-signature-ed25519': 'ab'.repeat(64) })).json()) as { code: string };
    expect(body.code).toBe('unauthorized');
    expect(h.discordCalls).toHaveLength(0);
  });

  it('refuse a validly signed request with a timestamp more than five minutes off', async () => {
    const { send, sign, h } = await setup();
    const raw = JSON.stringify({ ...base, type: 1 });
    const at = (offsetSeconds: number) => String(Math.floor(h.now().getTime() / 1000) + offsetSeconds);
    expect((await send({ ...base, type: 1 }, await sign(raw, at(-301)))).status).toBe(401);
    expect((await send({ ...base, type: 1 }, await sign(raw, at(301)))).status).toBe(401);
    expect((await send({ ...base, type: 1 }, await sign(raw, at(-290)))).status).toBe(200);
    expect((await send({ ...base, type: 1 }, await sign(raw, at(290)))).status).toBe(200);
  });

  it('refuse everything when no public key is configured, rather than trust the request', async () => {
    const { send, h } = await setup();
    h.relay.config.discord.publicKey = null;
    expect((await send({ ...base, type: 1 })).status).toBe(503);
  });

  it('reject a signed body that isn’t an interaction, and anything unsigned', async () => {
    const { send, sendRaw, sign } = await setup();
    expect((await send({ hello: 'world' })).status).toBe(400);
    expect((await sendRaw('not json', await sign('not json'))).status).toBe(400);
    expect((await send({ ...base, type: 1 }, {})).status).toBe(401);
  });
});

describe('/mirror agree', () => {
  it('records the agreement, gives the role with an audit reason, and explains in plain words', async () => {
    const { h, send } = await setup();
    const res = await send(command('agree'));
    const out = await jsonOf(res);
    expect(out.type).toBe(4);
    expect(out.data!.flags).toBe(64);
    expect(out.data!.content).toContain('You agreed to the Logitland public mirror');
    expect(out.data!.content).toContain(h.relay.config.publicUrl);
    expect(out.data!.content).toContain('/mirror leave');
    expect(out.data!.content).toContain('role');

    expect(await personRow(h)).toMatchObject({ method: 'command', revoked_at: null, granted_at: h.now().toISOString() });
    expect(discordPaths(h)).toEqual([`PUT /api/v10/guilds/${GUILD}/members/${PERSON}/roles/${ROLE}`]);
    const call = h.discordCalls[0]!;
    expect(call.headers.get('authorization')).toBe('Bot test-bot-token');
    expect(decodeURIComponent(call.headers.get('x-audit-log-reason')!)).toBe('Agreed to the Logitland public mirror');
    expect(await audits(h)).toEqual([{ actor_type: 'public', actor_id: PERSON, action: 'consent.granted', target_id: PERSON, reason: 'command', diff: null }]);
  });

  it('works from the welcome message’s button and records the method', async () => {
    const { h, send } = await setup();
    const out = await jsonOf(await send(button()));
    expect(out.data!.content).toContain('You agreed');
    expect(await personRow(h)).toMatchObject({ method: 'button', revoked_at: null });
    expect(discordPaths(h)).toHaveLength(1);
  });

  it('keeps the original time and method when asked again, and still re-applies the role', async () => {
    const { h, send } = await setup();
    await send(command('agree'));
    const first = await personRow(h);
    h.advance(3_600_000);
    const out = await jsonOf(await send(button()));
    expect(out.data!.content).toContain('You had already agreed');
    expect(await personRow(h)).toEqual(first);
    expect(await audits(h)).toHaveLength(1);
    expect(discordPaths(h)).toHaveLength(2);
  });

  it('agrees again after leaving, with a new time', async () => {
    const { h, send } = await setup();
    await send(command('agree'));
    await send(command('leave'));
    expect((await personRow(h))!.revoked_at).not.toBeNull();
    h.advance(3_600_000);
    await send(button());
    expect(await personRow(h)).toMatchObject({ method: 'button', revoked_at: null, granted_at: h.now().toISOString() });
    expect((await audits(h)).map((a) => a.action)).toEqual(['consent.granted', 'consent.revoked', 'consent.granted']);
  });

  it('keeps the agreement and says so when Discord won’t give the role', async () => {
    const { h, send } = await setup();
    h.setDiscord(async () => Response.json({ message: 'Missing Permissions', code: 50013 }, { status: 403 }));
    const out = await jsonOf(await send(command('agree')));
    expect(out.data!.content).toContain('couldn’t give you the chat role');
    expect(await personRow(h)).toMatchObject({ revoked_at: null });
    expect(h.log.lines.some((l) => l.event === 'consent.role_failed')).toBe(true);
  });
});

describe('/mirror leave', () => {
  it('ends the agreement at once, defers, then removes the role, scrubs the person and edits the reply', async () => {
    const { h, send } = await setup();
    await seedChannel(h.relay, { publicMirror: true });
    await send(command('agree'));
    await someone(h, '310000000000000001');
    await someone(h, '310000000000000002');
    h.discordCalls.length = 0;
    vi.mocked(scrubPerson).mockClear();

    const res = await send(command('leave', { roles: [ROLE] }));
    expect(await res.json()).toEqual({ type: 5, data: { flags: 64 } });

    expect((await personRow(h))!.revoked_at).toBe(h.now().toISOString());
    expect(vi.mocked(scrubPerson)).toHaveBeenCalledWith(h.relay, PERSON);
    expect(discordPaths(h)).toEqual([
      `DELETE /api/v10/guilds/${GUILD}/members/${PERSON}/roles/${ROLE}`,
      `PATCH /api/v10/webhooks/${APP_ID}/${TOKEN}/messages/@original`,
    ]);
    expect(decodeURIComponent(h.discordCalls[0]!.headers.get('x-audit-log-reason')!)).toBe('Left the Logitland public mirror');
    const edit = h.discordCalls[1]!;
    expect(edit.headers.get('authorization')).toBeNull();
    const followUp = (await edit.json()) as { content: string; allowed_mentions: unknown };
    expect(followUp.content).toContain('I deleted 2 of your messages');
    expect(followUp.content).toContain('The chat role is gone');
    expect(followUp.allowed_mentions).toEqual({ parse: [] });

    expect(await audits(h)).toEqual([
      expect.objectContaining({ actor_type: 'public', actor_id: PERSON, action: 'consent.granted' }),
      expect.objectContaining({ actor_type: 'public', actor_id: PERSON, action: 'consent.revoked' }),
      expect.objectContaining({
        actor_type: 'public',
        actor_id: PERSON,
        action: 'person.messages_removed',
        diff: JSON.stringify({ mirrored_messages: { from: 2, to: 0 } }),
      }),
    ]);
    expect(JSON.stringify(h.log.lines)).not.toContain(TOKEN);
  });

  it('says so, and finishes the job on a retry, when part of it fails', async () => {
    const { h, send } = await setup();
    await seedChannel(h.relay, { publicMirror: true });
    await send(command('agree'));
    await someone(h, '310000000000000001');
    h.discordCalls.length = 0;
    h.setDiscord(async (req) =>
      req.method === 'DELETE' ? Response.json({ message: 'Missing Permissions', code: 50013 }, { status: 403 }) : Response.json({}),
    );
    await send(command('leave', { roles: [ROLE] }));
    const followUp = (await h.discordCalls.at(-1)!.json()) as { content: string };
    expect(followUp.content).toContain('I deleted 1 of your message');
    expect(followUp.content).toContain('Ask a moderator to remove it');

    // The agreement is already over, but the role is still there: leaving again has work to do.
    h.discordCalls.length = 0;
    h.setDiscord(async () => Response.json({}));
    const res = await send(command('leave', { roles: [ROLE] }));
    expect((await jsonOf(res)).type).toBe(5);
    expect(discordPaths(h)[0]).toMatch(/^DELETE .*\/roles\//);
  });

  it('tells the person when removing their messages fails, without losing the revoked agreement', async () => {
    const { h, send } = await setup();
    await send(command('agree'));
    vi.mocked(scrubPerson).mockRejectedValueOnce(new Error('database is locked'));
    h.discordCalls.length = 0;
    await send(command('leave', { roles: [ROLE] }));
    expect((await personRow(h))!.revoked_at).not.toBeNull();
    const followUp = (await h.discordCalls.at(-1)!.json()) as { content: string };
    expect(followUp.content).toContain('Something went wrong while removing your messages');
    expect(followUp.content).toContain('Run /mirror leave again');
    expect(h.log.lines.some((l) => l.event === 'interaction.leave_failed')).toBe(true);
  });

  it('retries the follow-up edit when Discord hasn’t registered the acknowledgement yet', async () => {
    const { h, send } = await setup();
    await send(command('agree'));
    let patches = 0;
    h.setDiscord(async (req) => {
      if (req.method !== 'PATCH') return Response.json({});
      patches += 1;
      return patches === 1 ? Response.json({ message: 'Unknown Webhook', code: 10015 }, { status: 404 }) : Response.json({});
    });
    await send(command('leave'));
    expect(patches).toBe(2);
  });

  it('answers straight away when there is nothing to remove', async () => {
    const { h, send } = await setup();
    const res = await send(command('leave'));
    const out = await jsonOf(res);
    expect(out.type).toBe(4);
    expect(out.data!.flags).toBe(64);
    expect(out.data!.content).toContain('nothing to remove');
    expect(h.discordCalls).toHaveLength(0);
  });

  it('removes messages even from someone who never agreed', async () => {
    const { h, send } = await setup();
    await seedChannel(h.relay, { publicMirror: false });
    await someone(h, '310000000000000001');
    const res = await send(command('leave'));
    expect((await jsonOf(res)).type).toBe(5);
    expect(vi.mocked(scrubPerson)).toHaveBeenLastCalledWith(h.relay, PERSON);
    const followUp = (await h.discordCalls.at(-1)!.json()) as { content: string };
    expect(followUp.content).toContain('I deleted 1 of your message');
  });
});

describe('/mirror status', () => {
  it('tells someone who hasn’t agreed how to join', async () => {
    const { send } = await setup();
    const out = await jsonOf(await send(command('status')));
    expect(out.data!.flags).toBe(64);
    expect(out.data!.content).toContain('haven’t agreed');
    expect(out.data!.content).toContain('/mirror agree');
  });

  it('shows when they agreed and how many of their messages are mirrored', async () => {
    const { h, send } = await setup();
    await seedChannel(h.relay, { id: LOUNGE, publicMirror: true });
    await seedChannel(h.relay, { id: '110000000000000002', name: 'bench', publicMirror: false });
    await send(command('agree'));
    await someone(h, '310000000000000001');
    await someone(h, '310000000000000002');
    await someone(h, '310000000000000003', { deleted: true });
    await someone(h, '310000000000000004', { channel: '110000000000000002' });
    await someone(h, '310000000000000005', { person: '700000000000000002' });
    const out = await jsonOf(await send(command('status')));
    expect(out.data!.content).toContain('agreed to the public mirror on 2026-10-19 with the /mirror command');
    expect(out.data!.content).toContain('2 of your messages');
  });

  it('shows nothing mirrored after leaving', async () => {
    const { h, send } = await setup();
    await seedChannel(h.relay, { publicMirror: true });
    await send(command('agree'));
    await someone(h, '310000000000000001');
    await send(command('leave'));
    const out = await jsonOf(await send(command('status')));
    expect(out.data!.content).toContain('haven’t agreed');
    expect(out.data!.content).not.toContain('still hold');
  });
});

describe('outside the Logitland server', () => {
  const wrong = async (s: Setup, payload: unknown) => {
    const out = await jsonOf(await s.send(payload));
    expect(out.type).toBe(4);
    expect(out.data!.flags).toBe(64);
    expect(out.data!.content).toContain('only works in the Logitland server');
    expect(await personRow(s.h)).toBeNull();
    expect(s.h.discordCalls).toHaveLength(0);
  };

  it('replies privately and changes nothing for every command and the button', async () => {
    const s = await setup();
    for (const sub of ['agree', 'leave', 'status']) await wrong(s, command(sub, { guild: '999999999999999999' }));
    await wrong(s, { ...button(), guild_id: '999999999999999999' });
  });

  it('does the same in a direct message', async () => {
    const s = await setup();
    await wrong(s, command('agree', { guild: null }));
  });

  it('does the same when the relay has no guild configured', async () => {
    const s = await setup();
    s.h.relay.config.discord.guildId = null;
    await wrong(s, command('agree'));
  });
});

describe('other interactions', () => {
  it('say they don’t know an unfamiliar command, subcommand or button', async () => {
    const { h, send } = await setup();
    for (const payload of [
      { ...command('agree'), data: { name: 'other', options: [{ name: 'agree' }] } },
      command('wave'),
      button('something_else'),
      { ...base, type: 4, guild_id: GUILD, member: member(), data: { name: 'mirror' } },
    ]) {
      const out = await jsonOf(await send(payload));
      expect(out.type).toBe(4);
      expect(out.data!.content).toContain('don’t know that command');
    }
    expect(await personRow(h)).toBeNull();
  });
});
