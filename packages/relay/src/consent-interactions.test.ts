import { describe, expect, it, vi } from 'vitest';
import { relayApp } from './app';
import type { RelayBindings } from './config';
import { CONSENT_NOTICE_VERSION, consentNotice } from './services/consent';
import { AGREE_BUTTON, AGREE_COMMAND_BUTTON } from './services/interactions';
import { scrubPerson } from './services/scrub';
import { GUILD, LOUNGE, harness, seedChannel, type Harness } from './testing';

// The real scrubPerson, wrapped so tests can see how it was called and make it fail.
vi.mock('./services/scrub', async (importOriginal) => {
  const real = await importOriginal<typeof import('./services/scrub')>();
  return { ...real, scrubPerson: vi.fn(real.scrubPerson) };
});

const PERSON = '700000000000000001';
const APP_ID = '400000000000000001';
const ROLE = '500000000000000001';
const TOKEN = 'interaction-token-abc123';
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

async function setup(opts: { start?: string; keyless?: boolean; env?: Partial<RelayBindings> } = {}) {
  const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const publicKey = hex(await crypto.subtle.exportKey('raw', pair.publicKey));
  const h = harness({ start: opts.start, env: { ...(opts.keyless ? {} : { DISCORD_PUBLIC_KEY: publicKey }), ...opts.env } });
  const sign = async (raw: string, timestamp = String(Math.floor(h.now().getTime() / 1000)), key = pair.privateKey) => ({
    'x-signature-ed25519': hex(await crypto.subtle.sign({ name: 'Ed25519' }, key, new TextEncoder().encode(timestamp + raw))),
    'x-signature-timestamp': timestamp,
  });
  /** Posts an interaction signed by Discord's key (or with the headers you give), and waits for deferred work. */
  async function send(payload: unknown, headers?: Record<string, string>) {
    const res = await h.call('POST', '/discord/interactions', payload, headers ?? (await sign(JSON.stringify(payload))));
    await h.settle();
    return res;
  }
  /** The harness only sends JSON bodies, so a body that isn't JSON goes straight to the app. */
  async function sendRaw(raw: string) {
    return relayApp(h.relay).request('/discord/interactions', { method: 'POST', headers: await sign(raw), body: raw });
  }
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
/** The welcome message's button is `mirror_agree:<notice version>`; the one in the reply to /mirror agree is `mirror_agree_cmd:<notice version>`. */
const CMD_BUTTON = AGREE_COMMAND_BUTTON;
const button = (customId: string = AGREE_BUTTON) => ({ ...base, type: 3, guild_id: GUILD, member: member(), data: { custom_id: customId, component_type: 2 } });

const jsonOf = async (res: Response) =>
  (await res.json()) as {
    type: number;
    data?: { content?: string; flags?: number; components?: { type: number; components: { custom_id: string; label: string }[] }[] };
  };

const historyRows = async (h: Harness) =>
  (
    await h.db.prepare('SELECT discord_user_id, guild_id, action, method, notice_version, interaction_id, at FROM consent_history ORDER BY id').all<{
      discord_user_id: string;
      guild_id: string | null;
      action: string;
      method: string | null;
      notice_version: string | null;
      interaction_id: string | null;
      at: string;
    }>()
  ).results;
/** What the person sees last: the follow-up that replaced "thinking…". */
const lastFollowUp = async (h: Harness) =>
  (
    (await h.discordCalls
      .filter((r) => r.method === 'PATCH')
      .at(-1)!
      .json()) as { content: string }
  ).content;

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
    const { send } = await setup({ keyless: true });
    expect((await send({ ...base, type: 1 })).status).toBe(503);
  });

  it('reject a signed body that isn’t an interaction, and anything unsigned', async () => {
    const { send, sendRaw } = await setup();
    expect((await send({ hello: 'world' })).status).toBe(400);
    expect((await sendRaw('not json')).status).toBe(400);
    expect((await send({ ...base, type: 1 }, {})).status).toBe(401);
  });
});

describe('/mirror agree', () => {
  it('shows the notice with an agree button, and agrees to nothing', async () => {
    const { h, send } = await setup();
    const out = await jsonOf(await send(command('agree')));
    expect(out.type).toBe(4);
    expect(out.data!.flags).toBe(64);
    expect(out.data!.content).toBe(consentNotice(h.relay.config.dashboardUrl));
    expect(out.data!.components).toEqual([{ type: 1, components: [{ type: 2, style: 1, label: 'I agree: let me chat', custom_id: CMD_BUTTON }] }]);

    expect(await personRow(h)).toBeNull();
    expect(await historyRows(h)).toEqual([]);
    expect(await audits(h)).toEqual([]);
    expect(h.discordCalls).toHaveLength(0);
  });

  it('has a notice that fits in a Discord message and says what is shared, with whom, and how to leave', async () => {
    const { h } = await setup();
    const notice = consentNotice(h.relay.config.dashboardUrl);
    expect(notice.length).toBeLessThan(2000);
    for (const part of [
      'from that moment on',
      'Nothing you wrote before you agreed is copied',
      'messages, polls, thread titles',
      'display name',
      'public web page and a public API',
      'Search engines may index',
      'Every AI agent connected to Logitland',
      'webhook servers',
      'Automated moderation',
      'Cloudflare Workers AI',
      '/mirror leave',
      'deletes what Logitland holds of yours',
      'can’t be recalled',
      'Discord keeps its own copy',
      `${h.relay.config.dashboardUrl}/privacy`,
      `${h.relay.config.dashboardUrl}/mirror`,
    ])
      expect(notice).toContain(part);
    // The mirror site, never the relay's own address.
    expect(notice).not.toContain(h.relay.config.publicUrl);
  });

  it('agrees only when the button in that reply is pressed, and records the notice and the interaction', async () => {
    const { h, send } = await setup();
    const res = await send(button(CMD_BUTTON));
    expect(await res.json()).toEqual({ type: 5, data: { flags: 64 } });

    expect(await personRow(h)).toMatchObject({
      method: 'command',
      notice_version: CONSENT_NOTICE_VERSION,
      interaction_id: base.id,
      revoked_at: null,
      granted_at: h.now().toISOString(),
    });
    expect(await historyRows(h)).toEqual([
      {
        discord_user_id: PERSON,
        guild_id: GUILD,
        action: 'granted',
        method: 'command',
        notice_version: CONSENT_NOTICE_VERSION,
        interaction_id: base.id,
        at: h.now().toISOString(),
      },
    ]);
    expect(discordPaths(h)).toEqual([
      `PUT /api/v10/guilds/${GUILD}/members/${PERSON}/roles/${ROLE}`,
      `PATCH /api/v10/webhooks/${APP_ID}/${TOKEN}/messages/@original`,
    ]);
    const call = h.discordCalls[0]!;
    expect(call.headers.get('authorization')).toBe('Bot test-bot-token');
    expect(decodeURIComponent(call.headers.get('x-audit-log-reason')!)).toBe('Agreed to the Logitland public mirror');
    const followUp = await lastFollowUp(h);
    expect(followUp).toContain('You agreed to the Logitland public mirror');
    expect(followUp).toContain(`${h.relay.config.dashboardUrl}/privacy`);
    expect(followUp).toContain('You have the chat role');
    expect(followUp).toContain('/mirror leave');
    expect(await audits(h)).toEqual([{ actor_type: 'public', actor_id: PERSON, action: 'consent.granted', target_id: PERSON, reason: 'command', diff: null }]);
  });

  it('works from the welcome message’s button and records the method', async () => {
    const { h, send } = await setup();
    expect(await (await send(button())).json()).toEqual({ type: 5, data: { flags: 64 } });
    expect(await personRow(h)).toMatchObject({ method: 'button', notice_version: CONSENT_NOTICE_VERSION, revoked_at: null });
    expect((await historyRows(h))[0]).toMatchObject({ action: 'granted', method: 'button' });
    expect(await lastFollowUp(h)).toContain('You agreed');
  });

  it('does not record an agreement from a button posted under an older notice: it shows the current notice and a fresh button instead', async () => {
    const { h, send } = await setup();
    for (const id of ['mirror_agree', 'mirror_agree_cmd', 'mirror_agree:2020-01-01', 'mirror_agree_cmd:2020-01-01']) {
      const out = await jsonOf(await send({ ...button(id), id: '800000000000000009' }));
      expect(out.type).toBe(4);
      expect(out.data!.content).toBe(consentNotice(h.relay.config.dashboardUrl));
      expect(out.data!.flags).toBe(64);
      expect(out.data!.components).toEqual([{ type: 1, components: [{ type: 2, style: 1, label: 'I agree: let me chat', custom_id: CMD_BUTTON }] }]);
    }
    expect(await personRow(h)).toBeNull();
    expect(await historyRows(h)).toEqual([]);
  });

  it('answers before the role call, so a slow Discord can’t miss the three-second deadline', async () => {
    const { h, sign } = await setup();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    h.setDiscord(async (req) => {
      if (req.method === 'PUT') await gate;
      return Response.json({});
    });
    const payload = button(CMD_BUTTON);
    const res = await h.call('POST', '/discord/interactions', payload, await sign(JSON.stringify(payload)));
    expect(await res.json()).toEqual({ type: 5, data: { flags: 64 } });
    // The agreement is already on record; only the role is still on its way.
    expect(await personRow(h)).toMatchObject({ revoked_at: null });
    expect(h.discordCalls.filter((r) => r.method === 'PATCH')).toHaveLength(0);
    release();
    await h.settle();
    expect(await lastFollowUp(h)).toContain('You have the chat role');
  });

  it('keeps the original time, method and notice when asked again, writes no second record, and still re-applies the role', async () => {
    const { h, send } = await setup();
    await send(button(CMD_BUTTON));
    const first = await personRow(h);
    h.advance(3_600_000);
    await send({ ...button(), id: '800000000000000002' });
    expect(await lastFollowUp(h)).toContain('You had already agreed');
    expect(await personRow(h)).toEqual(first);
    expect(await audits(h)).toHaveLength(1);
    expect(await historyRows(h)).toHaveLength(1);
    expect(h.discordCalls.filter((r) => r.method === 'PUT')).toHaveLength(2);
  });

  it('agrees again after leaving, with a new time, and keeps every step in the history', async () => {
    const { h, send } = await setup();
    await send(button(CMD_BUTTON));
    await send({ ...command('leave'), id: '800000000000000002' });
    expect((await personRow(h))!.revoked_at).not.toBeNull();
    h.advance(3_600_000);
    await send({ ...button(), id: '800000000000000003' });
    expect(await personRow(h)).toMatchObject({ method: 'button', revoked_at: null, granted_at: h.now().toISOString(), interaction_id: '800000000000000003' });
    expect((await audits(h)).map((a) => a.action)).toEqual(['consent.granted', 'consent.revoked', 'consent.granted']);
    expect((await historyRows(h)).map((r) => [r.action, r.method, r.interaction_id])).toEqual([
      ['granted', 'command', base.id],
      ['revoked', 'command', '800000000000000002'],
      ['granted', 'button', '800000000000000003'],
    ]);
  });

  it('keeps the agreement and says so when Discord won’t give the role', async () => {
    const { h, send } = await setup();
    h.setDiscord(async () => Response.json({ message: 'Missing Permissions', code: 50013 }, { status: 403 }));
    await send(button(CMD_BUTTON));
    expect(await lastFollowUp(h)).toContain('couldn’t give you the chat role');
    expect(await personRow(h)).toMatchObject({ revoked_at: null });
    expect(h.log.lines.some((l) => l.event === 'consent.role_failed')).toBe(true);
  });

  it('waits out a short Discord rate limit on the role once, so a busy moment does not leave the person without it', async () => {
    const { h, send } = await setup();
    let puts = 0;
    h.setDiscord(async (req) => {
      if (req.method === 'PUT' && ++puts === 1) return Response.json({ retry_after: 0.01, global: false }, { status: 429 });
      return Response.json({});
    });
    await send(button(CMD_BUTTON));
    expect(puts).toBe(2);
    expect(await lastFollowUp(h)).toContain('You have the chat role');
  });

  it('gives up on a long rate limit instead of holding the request, and says the role was not given', async () => {
    const { h, send } = await setup();
    let puts = 0;
    h.setDiscord(async (req) => {
      if (req.method === 'PUT') {
        puts++;
        return Response.json({ retry_after: 60, global: false }, { status: 429 });
      }
      return Response.json({});
    });
    await send(button(CMD_BUTTON));
    expect(puts).toBe(1);
    expect(await lastFollowUp(h)).toContain('couldn’t give you the chat role');
  });

  it('stops one person from agreeing over and over: the sixth try in ten minutes is refused, and writes nothing', async () => {
    const { h, send } = await setup();
    for (let n = 1; n <= 6; n++) await send({ ...button(CMD_BUTTON), id: `80000000000000010${n}` });
    const rolePuts = discordPaths(h).filter((p) => p.startsWith('PUT')).length;
    const out = await jsonOf(await send({ ...button(CMD_BUTTON), id: '800000000000000107' }));
    expect(out.type).toBe(4);
    expect(out.data!.content).toContain('Wait about');
    expect(discordPaths(h).filter((p) => p.startsWith('PUT'))).toHaveLength(rolePuts);
    // Another person is not held up by it, and the window passes.
    expect((await jsonOf(await send({ ...button(CMD_BUTTON), id: '800000000000000108', member: member('700000000000000002') }))).type).toBe(5);
    h.advance(11 * 60_000);
    expect((await jsonOf(await send({ ...button(CMD_BUTTON), id: '800000000000000109' }))).type).toBe(5);
  });

  it('still ends the agreement when someone leaves too often, and leaves the clean-up for a later try', async () => {
    const { h, send } = await setup();
    await send(button(CMD_BUTTON));
    for (let n = 1; n <= 12; n++) await send({ ...command('leave'), id: `80000000000000020${n}` });
    vi.mocked(scrubPerson).mockClear();
    const out = await jsonOf(await send({ ...command('leave'), id: '800000000000000299' }));
    expect(out.type).toBe(4);
    expect(out.data!.content).toContain('Your agreement has ended');
    expect(vi.mocked(scrubPerson)).not.toHaveBeenCalled();
    expect((await personRow(h))!.revoked_at).not.toBeNull();
  });

  it('ends consistent when an agree and a leave overlap: the role follows the agreement, whichever finishes last', async () => {
    const { h, sign } = await setup();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const roleCalls: string[] = [];
    h.setDiscord(async (req) => {
      if (new URL(req.url).pathname.includes('/roles/')) {
        roleCalls.push(req.method);
        if (req.method === 'PUT') await gate;
      }
      return Response.json({});
    });
    const post = async (payload: unknown) => h.call('POST', '/discord/interactions', payload, await sign(JSON.stringify(payload)));
    await post(button(CMD_BUTTON)); // agreement recorded; the role call is waiting on Discord
    await post({ ...command('leave', { roles: [ROLE] }), id: '800000000000000002' }); // agreement ended; the leave takes the role away
    release();
    await h.settle();
    expect((await personRow(h))!.revoked_at).not.toBeNull();
    // The late grant found the agreement gone and took the role back: the last word is a removal.
    expect(roleCalls.at(-1)).toBe('DELETE');
  });
});

describe('/mirror leave', () => {
  it('ends the agreement at once, defers, then removes the role, scrubs the person and edits the reply', async () => {
    const { h, send } = await setup();
    await seedChannel(h.relay, { publicMirror: true });
    await send(button(CMD_BUTTON));
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
    expect(followUp.content).toContain('I deleted 2 messages of yours');
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
    await send(button(CMD_BUTTON));
    await someone(h, '310000000000000001');
    h.discordCalls.length = 0;
    h.setDiscord(async (req) =>
      req.method === 'DELETE' ? Response.json({ message: 'Missing Permissions', code: 50013 }, { status: 403 }) : Response.json({}),
    );
    await send(command('leave', { roles: [ROLE] }));
    const followUp = (await h.discordCalls.at(-1)!.json()) as { content: string };
    expect(followUp.content).toContain('I deleted 1 message of yours');
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
    await send(button(CMD_BUTTON));
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
    await send(button(CMD_BUTTON));
    let patches = 0;
    h.setDiscord(async (req) => {
      if (req.method !== 'PATCH') return Response.json({});
      patches += 1;
      return patches === 1 ? Response.json({ message: 'Unknown Webhook', code: 10015 }, { status: 404 }) : Response.json({});
    });
    await send(command('leave'));
    expect(patches).toBe(2);
  });

  it('runs the whole clean-up even when there is nothing to remove', async () => {
    const { h, send } = await setup();
    const res = await send(command('leave'));
    expect(await res.json()).toEqual({ type: 5, data: { flags: 64 } });
    expect(vi.mocked(scrubPerson)).toHaveBeenLastCalledWith(h.relay, PERSON);
    expect(await lastFollowUp(h)).toContain('I had no messages of yours to delete');
    expect(discordPaths(h)).toEqual([
      `DELETE /api/v10/guilds/${GUILD}/members/${PERSON}/roles/${ROLE}`,
      `PATCH /api/v10/webhooks/${APP_ID}/${TOKEN}/messages/@original`,
    ]);
  });

  it('cleans up tombstones of someone with no live messages, which an early return used to leave naming them', async () => {
    const { h, send } = await setup();
    await seedChannel(h.relay, { publicMirror: true });
    await someone(h, '310000000000000001', { deleted: true });
    await send(command('leave'));
    expect(
      await h.db.prepare('SELECT discord_user_id, display_name, author_ref FROM conversation WHERE message_id = ?').bind('310000000000000001').first(),
    ).toEqual({ discord_user_id: null, display_name: 'Former participant', author_ref: 'p_removed' });
  });

  it('removes messages even from someone who never agreed', async () => {
    const { h, send } = await setup();
    await seedChannel(h.relay, { publicMirror: false });
    await someone(h, '310000000000000001');
    const res = await send(command('leave'));
    expect((await jsonOf(res)).type).toBe(5);
    expect(vi.mocked(scrubPerson)).toHaveBeenLastCalledWith(h.relay, PERSON);
    const followUp = (await h.discordCalls.at(-1)!.json()) as { content: string };
    expect(followUp.content).toContain('I deleted 1 message of yours');
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

  it('shows when they agreed and how many of their messages Logitland holds, in any channel', async () => {
    const { h, send } = await setup();
    await seedChannel(h.relay, { id: LOUNGE, publicMirror: true });
    await seedChannel(h.relay, { id: '110000000000000002', name: 'bench', publicMirror: false });
    // Everything held counts, whether or not the channel is mirrored or open to agents: leaving deletes all of it.
    await seedChannel(h.relay, { id: '110000000000000003', name: 'dark', publicMirror: true, access: 'off' });
    await send(button(CMD_BUTTON));
    await someone(h, '310000000000000001');
    await someone(h, '310000000000000002');
    await someone(h, '310000000000000003', { deleted: true });
    await someone(h, '310000000000000004', { channel: '110000000000000002' });
    await someone(h, '310000000000000006', { channel: '110000000000000003' });
    await someone(h, '310000000000000005', { person: '700000000000000002' });
    const out = await jsonOf(await send(command('status')));
    expect(out.data!.content).toContain('agreed to the public mirror on 2026-10-19 with the /mirror command');
    expect(out.data!.content).toContain('Logitland holds 4 of your messages');
  });

  it('shows nothing mirrored after leaving', async () => {
    const { h, send } = await setup();
    await seedChannel(h.relay, { publicMirror: true });
    await send(button(CMD_BUTTON));
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
    await wrong(s, { ...button(CMD_BUTTON), guild_id: '999999999999999999' });
  });

  it('does the same in a direct message', async () => {
    const s = await setup();
    await wrong(s, command('agree', { guild: null }));
  });

  it('does the same when the relay has no guild configured', async () => {
    const s = await setup({ env: { DISCORD_GUILD_ID: undefined } });
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
