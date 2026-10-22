import { namesToBits, type PermissionName } from '@logitland/discord-catalog';
import { describe, expect, it } from 'vitest';
import { pruneLoganJob } from './services/logan/oauth';
import { ADMIN_DISCORD, GUILD, application, harness, seedOwner } from './testing';

// The Logan admin MCP: a person's MCP client signs in through the dashboard's Discord sign-in (OAuth 2.1 with PKCE) and has
// Logan act in the server within that person's own permissions, checked again on every call.

const PERSON = '700000000000000001';
const OTHER_MOD = '700000000000000002';
const SENIOR = '700000000000000003';
const MEMBER = '700000000000000004';
const SERVER_OWNER = '700000000000000009';
const MODS = '500000000000000001';
const SENIORS = '500000000000000002';
const LOUNGE = '110000000000000001';
const SECRET = '110000000000000002';
const ALERTS = '110000000000000003';
const ELSEWHERE = '110000000000000004';
const REDIRECT = 'http://localhost:33418/callback';
const VERIFIER = 'a-pkce-code-verifier-that-is-long-enough-to-be-valid-0123456789';

const bits = (...names: PermissionName[]) => String(namesToBits(names));
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const b64url = (buf: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

type Member = { roles: string[]; communication_disabled_until?: string | null };

/**
 * A server where PERSON is a moderator (MODS: manage messages, kick, ban, moderate, manage roles) whose role grants the logan
 * power, SENIOR outranks them, and MEMBER is below them. Discord answers from `members` and `channels`, so a test changes
 * someone's roles by editing them. Every request Discord gets is kept in `h.discordCalls`.
 */
async function setup() {
  const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const h = harness({ env: { DISCORD_PUBLIC_KEY: hex(await crypto.subtle.exportKey('raw', pair.publicKey)) } });
  const at = h.now().toISOString();
  const role = (id: string, name: string, permissions: string, position: number) =>
    h.db
      .prepare('INSERT INTO guild_roles (id, guild_id, name, permissions, position, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(id, GUILD, name, permissions, position, at)
      .run();
  await role(MODS, 'mods', bits('ManageMessages', 'PinMessages', 'KickMembers', 'BanMembers', 'ModerateMembers', 'ManageRoles'), 5);
  await role(SENIORS, 'seniors', '0', 8);
  await h.db.prepare('INSERT INTO admin_roles (role_id, permissions, updated_at) VALUES (?, \'["logan"]\', ?)').bind(MODS, at).run();
  await h.db
    .prepare("INSERT INTO settings (key, value, updated_by, updated_at) VALUES ('alerts_channel_id', ?, 'test', ?)")
    .bind(JSON.stringify(ALERTS), at)
    .run();

  const members: Record<string, Member> = {
    [PERSON]: { roles: [MODS] },
    [OTHER_MOD]: { roles: [MODS] },
    [SENIOR]: { roles: [SENIORS] },
    [MEMBER]: { roles: [] },
  };
  const channel = (id: string, overwrites: unknown[] = [], guild = GUILD) => ({
    id,
    guild_id: guild,
    name: `c${id.slice(-1)}`,
    type: 0,
    permission_overwrites: overwrites,
  });
  const channels: Record<string, ReturnType<typeof channel>> = {
    [LOUNGE]: channel(LOUNGE),
    [SECRET]: channel(SECRET, [{ id: GUILD, type: 0, allow: '0', deny: bits('ViewChannel') }]),
    [ALERTS]: channel(ALERTS),
    [ELSEWHERE]: channel(ELSEWHERE, [], '100000000000000002'),
  };
  const guild = { id: GUILD, owner_id: SERVER_OWNER };
  let next = 900000000000000000n;
  h.setDiscord(async (req) => {
    const path = new URL(req.url).pathname.replace('/api/v10', '');
    let m: RegExpExecArray | null;
    if (path === '/applications/@me') return Response.json(application([ADMIN_DISCORD]));
    if (path === `/guilds/${GUILD}`) return Response.json(guild);
    if (path === `/guilds/${GUILD}/channels`) return Response.json(Object.values(channels).filter((c) => c.guild_id === GUILD));
    if ((m = /^\/guilds\/\d+\/members\/(\d+)$/.exec(path)) && req.method === 'GET') {
      const member = members[m[1]!];
      return member
        ? Response.json({ user: { id: m[1], username: 'someone' }, ...member })
        : Response.json({ message: 'Unknown Member', code: 10007 }, { status: 404 });
    }
    if ((m = /^\/channels\/(\d+)$/.exec(path)) && req.method === 'GET') {
      const found = channels[m[1]!];
      return found ? Response.json(found) : Response.json({ message: 'Unknown Channel', code: 10003 }, { status: 404 });
    }
    if (req.method === 'DELETE' || req.method === 'PUT') return new Response(null, { status: 204 });
    return Response.json({ id: String((next += 1n)), channel_id: LOUNGE, content: '', timestamp: at, edited_timestamp: null });
  });

  const owner = await seedOwner(h.relay, PERSON, 'pat');
  const otherOwner = await seedOwner(h.relay, OTHER_MOD, 'sam');

  /** Signs PERSON in from an MCP client, as the dashboard's consent page would: register, allow, exchange the code. */
  async function signIn(ownerId = owner.id) {
    const client = (await (await h.call('POST', '/oauth2/admin/register', { client_name: 'Claude Code', redirect_uris: [REDIRECT] })).json()) as {
      client_id: string;
    };
    const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(VERIFIER)));
    const request = {
      response_type: 'code',
      client_id: client.client_id,
      redirect_uri: REDIRECT,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: 'xyz',
    };
    const decided = await h.internal(
      'POST',
      `/internal/owners/${ownerId}/logan/authorize`,
      { ...request, decision: 'allow' },
      { 'x-logitland-owner': ownerId },
    );
    const code = new URL(((await decided.json()) as { redirect_to: string }).redirect_to).searchParams.get('code')!;
    const res = await h.form('/oauth2/admin/token', {
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT,
      client_id: client.client_id,
      code_verifier: VERIFIER,
    });
    return { client_id: client.client_id, ...((await res.json()) as { access_token: string; refresh_token: string }) };
  }

  /** One MCP tool call over /mcp/admin. */
  async function tool(token: string, name: string, args: Record<string, unknown> = {}) {
    const res = await h.call('POST', '/mcp/admin', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, h.as(token));
    if (res.status !== 200) return { status: res.status, isError: true, data: (await res.json()) as Record<string, unknown> };
    const { result } = (await res.json()) as { result: { isError?: boolean; structuredContent: Record<string, unknown> } };
    return { status: 200, isError: result.isError ?? false, data: result.structuredContent };
  }

  /** Presses a button on Logan's message, as `who`, signed with Discord's key; waits for what runs after the answer. */
  async function press(customId: string, who: string) {
    const payload = {
      id: '800000000000000001',
      application_id: '400000000000000001',
      token: 'tok',
      type: 3,
      guild_id: GUILD,
      member: { user: { id: who } },
      data: { custom_id: customId },
    };
    const raw = JSON.stringify(payload);
    const timestamp = String(Math.floor(h.now().getTime() / 1000));
    const signature = hex(await crypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, new TextEncoder().encode(timestamp + raw)));
    const res = await h.call('POST', '/v1/discord/interactions', payload, { 'x-signature-ed25519': signature, 'x-signature-timestamp': timestamp });
    await h.settle();
    return (await res.json()) as { type: number; data: { content: string; flags?: number } };
  }

  const sent = (method: string, path: string) => h.discordCalls.filter((r) => r.method === method && new URL(r.url).pathname.endsWith(path));
  return { h, owner, otherOwner, guild, members, channels, signIn, tool, press, sent };
}

describe('signing in from an MCP client', () => {
  it('finds the authorization server from the 401, and trades a PKCE code for tokens that act as the person', async () => {
    const { h, signIn, tool } = await setup();
    const unauthenticated = await h.call('POST', '/mcp/admin', { jsonrpc: '2.0', id: 1, method: 'initialize' });
    expect(unauthenticated.status).toBe(401);
    const metadataUrl = /resource_metadata="([^"]+)"/.exec(unauthenticated.headers.get('www-authenticate') ?? '')![1]!;
    const resource = (await (await h.call('GET', new URL(metadataUrl).pathname)).json()) as { resource: string; authorization_servers: string[] };
    expect(resource.resource).toBe('https://relay.logitland.test/mcp/admin');
    const issuer = new URL(resource.authorization_servers[0]!);
    const server = (await (await h.call('GET', `/.well-known/oauth-authorization-server${issuer.pathname}`)).json()) as Record<string, unknown>;
    expect(server).toMatchObject({ authorization_endpoint: 'https://logitland.test/oauth/authorize', code_challenge_methods_supported: ['S256'] });

    const { access_token } = await signIn();
    const status = await tool(access_token, 'request_status', { request_id: 'lgr_01JZZZZZZZZZZZZZZZZZZZZZZZ' });
    expect(status).toMatchObject({ status: 200, isError: true, data: { error: 'not_found' } });
  });

  it('refuses a wrong PKCE verifier, a code used twice, and a replayed refresh token; revoking ends access', async () => {
    const { h, owner, signIn, tool } = await setup();
    const client = (await (await h.call('POST', '/oauth2/admin/register', { redirect_uris: [REDIRECT] })).json()) as { client_id: string };
    const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(VERIFIER)));
    const allow = async () => {
      const res = await h.internal(
        'POST',
        `/internal/owners/${owner.id}/logan/authorize`,
        {
          response_type: 'code',
          client_id: client.client_id,
          redirect_uri: 'http://localhost:51000/callback',
          code_challenge: challenge,
          code_challenge_method: 'S256',
          decision: 'allow',
        },
        { 'x-logitland-owner': owner.id },
      );
      return new URL(((await res.json()) as { redirect_to: string }).redirect_to).searchParams.get('code')!;
    };
    const exchange = (code: string, verifier = VERIFIER) =>
      h.form('/oauth2/admin/token', {
        grant_type: 'authorization_code',
        code,
        redirect_uri: 'http://localhost:51000/callback',
        client_id: client.client_id,
        code_verifier: verifier,
      });

    // A loopback redirect matches on any port (RFC 8252); the verifier must match the challenge.
    expect(await (await exchange(await allow(), `${VERIFIER}x`)).json()).toMatchObject({ error: 'invalid_grant' });
    const code = await allow();
    const first = (await (await exchange(code)).json()) as { access_token: string };
    expect(await (await exchange(code)).json()).toMatchObject({ error: 'invalid_grant' });
    // The second use ended what the first one got.
    expect((await tool(first.access_token, 'request_status', { request_id: 'lgr_1' })).status).toBe(401);

    const { access_token, refresh_token, client_id } = await signIn();
    const refreshed = (await (await h.form('/oauth2/admin/token', { grant_type: 'refresh_token', refresh_token, client_id })).json()) as {
      access_token: string;
    };
    expect((await tool(refreshed.access_token, 'search_operations')).status).toBe(200);
    expect(await (await h.form('/oauth2/admin/token', { grant_type: 'refresh_token', refresh_token, client_id })).json()).toMatchObject({
      error: 'invalid_grant',
    });
    expect((await tool(refreshed.access_token, 'search_operations')).status).toBe(401);
    expect((await tool(access_token, 'search_operations')).status).toBe(401);

    const again = await signIn();
    await h.form('/oauth2/admin/revoke', { token: again.access_token });
    expect((await tool(again.access_token, 'search_operations')).status).toBe(401);
  });

  it('expires access tokens after an hour', async () => {
    const { h, signIn, tool } = await setup();
    const { access_token } = await signIn();
    h.advance(3601_000);
    expect((await tool(access_token, 'search_operations')).status).toBe(401);
  });

  it('needs the logan power to consent, and again on every call', async () => {
    const { h, owner, members, signIn, tool } = await setup();
    const { access_token } = await signIn();
    members[PERSON] = { roles: [] };
    expect((await tool(access_token, 'search_operations')).status).toBe(403);

    const client = (await (await h.call('POST', '/oauth2/admin/register', { client_name: 'Codex', redirect_uris: [REDIRECT] })).json()) as {
      client_id: string;
    };
    await h.db.prepare('DELETE FROM discord_lookups WHERE key LIKE ?').bind('member:%').run();
    const request = {
      response_type: 'code',
      client_id: client.client_id,
      redirect_uri: REDIRECT,
      code_challenge: 'x'.repeat(43),
      code_challenge_method: 'S256',
    };
    const as = { 'x-logitland-owner': owner.id };
    expect(await (await h.internal('POST', `/internal/owners/${owner.id}/logan/consent`, request, as)).json()).toEqual({
      client_name: 'Codex',
      allowed: false,
    });
    expect((await h.internal('POST', `/internal/owners/${owner.id}/logan/authorize`, { ...request, decision: 'allow' }, as)).status).toBe(403);
    const denied = (await (await h.internal('POST', `/internal/owners/${owner.id}/logan/authorize`, { ...request, decision: 'deny' }, as)).json()) as {
      redirect_to: string;
    };
    expect(new URL(denied.redirect_to).searchParams.get('error')).toBe('access_denied');
  });
});

describe('what Logan offers', () => {
  it('lists only operations the person may perform, and never ones Discord documents nothing for', async () => {
    const { signIn, tool } = await setup();
    const { access_token } = await signIn();
    const ids = async (query: string) =>
      ((await tool(access_token, 'search_operations', { query })).data.operations as { operation_id: string }[]).map((o) => o.operation_id);
    expect(await ids('ban')).toContain('ban_user_from_guild');
    // Mods can't manage channels or the server.
    expect(await ids('create channel')).not.toContain('create_guild_channel');
    expect(await ids('update guild')).not.toContain('update_guild');
    expect(await ids('search threads')).not.toContain('thread_search');
    // Logan's own account isn't the person's.
    expect(await ids('my guild member')).not.toContain('update_my_guild_member');
  });

  it('checks the person again on every call: a permission taken away after listing refuses the call', async () => {
    const { members, channels, signIn, tool } = await setup();
    const { access_token } = await signIn();
    const listed = (await tool(access_token, 'search_operations', { query: 'delete message' })).data.operations as { operation_id: string }[];
    expect(listed.map((o) => o.operation_id)).toContain('delete_message');
    const remove = () =>
      tool(access_token, 'call_operation', { operation_id: 'delete_message', params: { channel_id: LOUNGE, message_id: '910000000000000001' } });

    channels[LOUNGE]!.permission_overwrites = [{ id: MODS, type: 0, allow: '0', deny: bits('ManageMessages') }];
    expect(await remove()).toMatchObject({ isError: true, data: { error: 'forbidden' } });
    // A timeout leaves only viewing and reading, wherever they are.
    channels[LOUNGE]!.permission_overwrites = [];
    members[PERSON] = { roles: [MODS], communication_disabled_until: '2026-10-19T04:00:00.000Z' };
    expect(await remove()).toMatchObject({ isError: true, data: { error: 'forbidden' } });
  });

  it('refuses targets outside the server and acting on someone who outranks the person', async () => {
    const { signIn, tool } = await setup();
    const { access_token } = await signIn();
    const call = (operation_id: string, params: Record<string, string>) => tool(access_token, 'call_operation', { operation_id, params });
    expect((await call('delete_guild_member', { guild_id: '100000000000000002', user_id: MEMBER })).data).toMatchObject({ error: 'forbidden' });
    expect((await call('delete_message', { channel_id: ELSEWHERE, message_id: '910000000000000001' })).data).toMatchObject({ error: 'forbidden' });
    expect((await call('delete_guild_member', { guild_id: GUILD, user_id: SENIOR })).data).toMatchObject({
      error: 'forbidden',
      detail: 'They have a role at or above your highest role.',
    });
    expect((await call('delete_guild_member', { guild_id: GUILD, user_id: SERVER_OWNER })).isError).toBe(true);
    expect((await call('add_guild_member_role', { guild_id: GUILD, user_id: MEMBER, role_id: SENIORS })).data).toMatchObject({
      detail: 'seniors is at or above your highest role.',
    });
  });

  it('only forwards a message the person could read themselves', async () => {
    const { signIn, tool, sent } = await setup();
    const { access_token } = await signIn();
    const forward = (channel_id: string) =>
      tool(access_token, 'call_operation', {
        operation_id: 'create_message',
        params: { channel_id: LOUNGE },
        body: { message_reference: { type: 1, channel_id, message_id: '910000000000000001' } },
      });
    expect((await forward(SECRET)).data).toMatchObject({ error: 'forbidden' });
    expect(sent('POST', `/channels/${LOUNGE}/messages`)).toHaveLength(0);
    expect((await forward(LOUNGE)).data).toMatchObject({ status: 'done' });
  });

  it('stops treating someone as the server owner as soon as they hand it over', async () => {
    const { guild, signIn, tool } = await setup();
    const { access_token } = await signIn();
    const createChannel = () =>
      tool(access_token, 'call_operation', { operation_id: 'create_guild_channel', params: { guild_id: GUILD }, body: { name: 'x' } });
    guild.owner_id = PERSON;
    expect((await createChannel()).isError).toBe(false);
    guild.owner_id = SERVER_OWNER;
    expect((await createChannel()).data).toMatchObject({ error: 'forbidden' });
  });

  it('trims server-wide reads to what the person can see', async () => {
    const { signIn, tool } = await setup();
    const { access_token } = await signIn();
    const res = await tool(access_token, 'call_operation', { operation_id: 'list_guild_channels', params: { guild_id: GUILD } });
    expect((res.data.answer as { id: string }[]).map((c) => c.id).sort()).toEqual([LOUNGE, ALERTS].sort());
  });

  it('fills in the server when a call leaves guild_id out', async () => {
    const { signIn, tool } = await setup();
    const { access_token } = await signIn();
    const res = await tool(access_token, 'call_operation', { operation_id: 'list_guild_channels' });
    expect((res.data.answer as { id: string }[]).map((c) => c.id).sort()).toEqual([LOUNGE, ALERTS].sort());
  });
});

describe('running a call', () => {
  it('runs a write at once, as Logan, naming the person in both audit logs and the alerts channel', async () => {
    const { h, owner, signIn, tool, sent } = await setup();
    const { access_token } = await signIn();
    const res = await tool(access_token, 'call_operation', {
      operation_id: 'create_pin',
      params: { channel_id: LOUNGE, message_id: '910000000000000001' },
      reason: 'the rules',
    });
    expect(res).toMatchObject({ isError: false, data: { status: 'done' } });
    const [pin] = sent('PUT', `/channels/${LOUNGE}/messages/pins/910000000000000001`);
    expect(decodeURIComponent(pin!.headers.get('x-audit-log-reason')!)).toBe('pat via Logan admin MCP: the rules');
    const audited = await h.db.prepare("SELECT actor_id, target_id, reason FROM audit_log WHERE action = 'logan.create_pin'").first();
    expect(audited).toEqual({ actor_id: owner.id, target_id: `PUT /channels/${LOUNGE}/messages/pins/910000000000000001`, reason: 'the rules' });
    const alert = (await sent('POST', `/channels/${ALERTS}/messages`)[0]!.json()) as { content: string };
    expect(alert.content).toContain(`<@${PERSON}> had Logan run \`create_pin\``);
  });

  it('holds a destructive call until the person who asked confirms it', async () => {
    const { h, signIn, tool, press, sent } = await setup();
    const { access_token } = await signIn();
    const kick = await tool(access_token, 'call_operation', {
      operation_id: 'delete_guild_member',
      params: { guild_id: GUILD, user_id: MEMBER },
      reason: 'spam',
    });
    expect(kick.data).toMatchObject({ status: 'pending', operation_id: 'delete_guild_member' });
    const requestId = kick.data.request_id as string;
    expect(sent('DELETE', `/guilds/${GUILD}/members/${MEMBER}`)).toHaveLength(0);
    const posted = (await sent('POST', `/channels/${ALERTS}/messages`)[0]!.json()) as { components: { components: { custom_id: string }[] }[] };
    const [confirm] = posted.components[0]!.components.map((c) => c.custom_id);

    const stranger = await press(confirm!, OTHER_MOD);
    expect(stranger.data.flags).toBe(64);
    expect(sent('DELETE', `/guilds/${GUILD}/members/${MEMBER}`)).toHaveLength(0);

    await press(confirm!, PERSON);
    expect(sent('DELETE', `/guilds/${GUILD}/members/${MEMBER}`)).toHaveLength(1);
    expect((await tool(access_token, 'request_status', { request_id: requestId })).data).toMatchObject({ status: 'done' });
    const edited = (await sent('PATCH', '/messages/@original')[0]!.json()) as { content: string };
    expect(edited.content).toContain(`<@${PERSON}> confirmed: Logan ran \`delete_guild_member\``);
    expect(await h.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'logan.delete_guild_member'").first()).toEqual({ n: 1 });
    // Pressing again does nothing more.
    expect((await press(confirm!, PERSON)).data.flags).toBe(64);
  });

  it('treats a timeout as destructive, and lets a request expire unconfirmed', async () => {
    const { h, signIn, tool, press, sent } = await setup();
    const { access_token } = await signIn();
    const timeout = await tool(access_token, 'call_operation', {
      operation_id: 'update_guild_member',
      params: { guild_id: GUILD, user_id: MEMBER },
      body: { communication_disabled_until: '2026-10-20T03:00:00.000Z' },
    });
    expect(timeout.data).toMatchObject({ status: 'pending' });
    h.advance(10 * 60_000);
    expect((await tool(access_token, 'request_status', { request_id: timeout.data.request_id })).data).toMatchObject({ status: 'expired' });
    const answer = await press(`logan_confirm:${String(timeout.data.request_id)}`, PERSON);
    expect(answer.data.content).toContain('expired');
    expect(sent('PATCH', `/guilds/${GUILD}/members/${MEMBER}`)).toHaveLength(0);
  });

  it('forgets requests a day after they expire', async () => {
    const { h, signIn, tool } = await setup();
    const { access_token } = await signIn();
    await tool(access_token, 'call_operation', { operation_id: 'delete_guild_member', params: { guild_id: GUILD, user_id: MEMBER } });
    h.advance(25 * 3600_000);
    await pruneLoganJob(h.relay);
    expect(await h.db.prepare('SELECT COUNT(*) AS n FROM logan_requests').first()).toEqual({ n: 0 });
  });

  it('checks again on Confirm: a power lost while waiting refuses the call', async () => {
    const { h, members, signIn, tool, press, sent } = await setup();
    const { access_token } = await signIn();
    const ban = await tool(access_token, 'call_operation', { operation_id: 'ban_user_from_guild', params: { guild_id: GUILD, user_id: MEMBER }, body: {} });
    expect(ban.data).toMatchObject({ status: 'pending' });
    members[PERSON] = { roles: [] };
    await press(`logan_confirm:${String(ban.data.request_id)}`, PERSON);
    expect(sent('PUT', `/guilds/${GUILD}/bans/${MEMBER}`)).toHaveLength(0);
    expect(await h.db.prepare('SELECT status FROM logan_requests WHERE id = ?').bind(ban.data.request_id).first()).toEqual({ status: 'failed' });
    const edited = (await sent('PATCH', '/messages/@original')[0]!.json()) as { content: string };
    expect(edited.content).toBe('Logan didn’t run `ban_user_from_guild`: Acting through Logan needs the logan admin power.');
  });
});

describe('deleting the account', () => {
  it('ends the person’s Logan sign-ins and drops their waiting requests', async () => {
    const { h, owner, signIn, tool } = await setup();
    const { access_token } = await signIn();
    await tool(access_token, 'call_operation', { operation_id: 'delete_guild_member', params: { guild_id: GUILD, user_id: MEMBER } });
    expect((await h.internal('DELETE', `/internal/owners/${owner.id}`, undefined, { 'x-logitland-owner': owner.id })).status).toBe(204);
    expect((await tool(access_token, 'search_operations')).status).toBe(401);
    expect(await h.db.prepare('SELECT COUNT(*) AS n FROM logan_requests').first()).toEqual({ n: 0 });
  });
});
