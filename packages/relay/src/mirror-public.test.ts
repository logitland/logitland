import { LIMITS, type ConversationPage, type PublicAgentProfile } from '@logitland/contracts';
import { describe, expect, it } from 'vitest';
import { clientHashes } from './services/origins';
import { updateSettings } from './services/settings';
import { ADMIN_DISCORD, BENCH, LOUNGE, harness, seedAgent, seedChannel, seedOwner, type Harness } from './testing';
import { agree } from './consent.testkit';

const PERSON = '700000000000000001';
const DASHBOARD = 'https://logitland.test';

async function message(
  h: Harness,
  id: string,
  o: {
    channel?: string;
    agentId?: string | null;
    person?: string | null;
    content?: string;
    thread?: string | null;
    deleted?: boolean;
    createdAt?: string;
    name?: string;
  } = {},
) {
  await h.db
    .prepare(
      'INSERT INTO conversation (message_id, channel_id, thread_id, author_kind, agent_id, author_ref, discord_user_id, display_name, content, created_at, deleted_at, removed_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      id,
      o.channel ?? LOUNGE,
      o.thread ?? null,
      o.agentId ? 'agent' : 'human',
      o.agentId ?? null,
      o.person ? `p_${o.person.slice(-6)}` : 'p_none',
      o.person ?? null,
      o.name ?? (o.agentId ? 'Agent' : 'Pat'),
      o.deleted ? null : (o.content ?? `text ${id}`),
      o.createdAt ?? h.now().toISOString(),
      o.deleted ? h.now().toISOString() : null,
      o.deleted ? 'moderator' : null,
    )
    .run();
}

const consent = (h: Harness, person: string, revoked = false) =>
  agree(h, person, { guild: '100000000000000001', at: '2026-10-19T02:00:00.000Z', revokedAt: revoked ? '2026-10-19T02:30:00.000Z' : null });

describe('public channel pages', () => {
  it('show an agent’s words in full and a person’s only while they have agreed', async () => {
    const h = harness();
    await seedChannel(h.relay, { publicMirror: true });
    const agent = await seedAgent(h.relay, { name: 'Orrery' });
    await message(h, '310000000000000001', { agentId: agent.id, content: 'from the agent', name: 'Orrery' });
    await message(h, '310000000000000002', { person: PERSON, content: 'a private thought', name: 'Pat' });

    const get = async () => (await (await h.call('GET', `/public/channels/${LOUNGE}/messages`)).json()) as ConversationPage;
    let page = await get();
    expect(page.messages.map((m) => m.message_id)).toEqual(['310000000000000002', '310000000000000001']);
    expect(page.messages[0]).toMatchObject({ content: null, author: { kind: 'human', display_name: 'A person in Discord' } });
    expect(page.messages[1]).toMatchObject({ content: 'from the agent', author: { kind: 'agent', agent_id: agent.id } });
    expect(JSON.stringify(page)).not.toContain(PERSON);
    expect(JSON.stringify(page)).not.toContain('a private thought');

    await consent(h, PERSON);
    page = await get();
    expect(page.messages[0]).toMatchObject({ content: 'a private thought', author: { display_name: 'Pat' } });
    expect(JSON.stringify(page)).not.toContain(PERSON);

    await h.db.prepare('UPDATE consents SET revoked_at = ? WHERE discord_user_id = ?').bind('2026-10-19T03:00:00Z', PERSON).run();
    expect((await get()).messages[0]).toMatchObject({ content: null, author: { display_name: 'A person in Discord' } });
  });

  it('answer 404 for a channel that isn’t mirrored or doesn’t exist, and list only the mirrored ones', async () => {
    const h = harness();
    await seedChannel(h.relay, { id: LOUNGE, name: 'lounge', publicMirror: true });
    await seedChannel(h.relay, { id: BENCH, name: 'bench', publicMirror: false });
    await message(h, '310000000000000001', { channel: BENCH, person: PERSON });

    expect((await h.call('GET', `/public/channels/${BENCH}/messages`)).status).toBe(404);
    expect((await h.call('GET', '/public/channels/119999999999999999/messages')).status).toBe(404);
    expect((await h.call('GET', `/public/channels/${LOUNGE}/messages`)).status).toBe(200);

    const list = await h.call('GET', '/public/channels');
    expect(await list.json()).toEqual({ channels: [{ id: LOUNGE, name: 'lounge', type: 'text', tags: [] }] });
  });

  it('page newest first with before, limit and thread_id', async () => {
    const h = harness();
    await seedChannel(h.relay, { publicMirror: true });
    const agent = await seedAgent(h.relay);
    for (let n = 1; n <= 5; n++) await message(h, `31000000000000000${n}`, { agentId: agent.id, thread: n % 2 ? '320000000000000001' : null });

    const first = (await (await h.call('GET', `/public/channels/${LOUNGE}/messages?limit=2`)).json()) as ConversationPage;
    expect(first.messages.map((m) => m.message_id)).toEqual(['310000000000000005', '310000000000000004']);
    expect(first.next_before).toBe('310000000000000004');
    const second = (await (await h.call('GET', `/public/channels/${LOUNGE}/messages?limit=2&before=${first.next_before}`)).json()) as ConversationPage;
    expect(second.messages.map((m) => m.message_id)).toEqual(['310000000000000003', '310000000000000002']);
    const last = (await (await h.call('GET', `/public/channels/${LOUNGE}/messages?limit=2&before=${second.next_before}`)).json()) as ConversationPage;
    expect(last.messages.map((m) => m.message_id)).toEqual(['310000000000000001']);
    expect(last.next_before).toBeNull();

    const thread = (await (await h.call('GET', `/public/channels/${LOUNGE}/messages?thread_id=320000000000000001`)).json()) as ConversationPage;
    expect(thread.messages.map((m) => m.message_id)).toEqual(['310000000000000005', '310000000000000003', '310000000000000001']);

    expect((await h.call('GET', `/public/channels/${LOUNGE}/messages?before=abc`)).status).toBe(400);
    expect((await h.call('GET', `/public/channels/${LOUNGE}/messages?limit=many`)).status).toBe(400);
  });

  it('keep deletions as tombstones without text', async () => {
    const h = harness();
    await seedChannel(h.relay, { publicMirror: true });
    const agent = await seedAgent(h.relay);
    await message(h, '310000000000000001', { agentId: agent.id, deleted: true });
    const page = (await (await h.call('GET', `/public/channels/${LOUNGE}/messages`)).json()) as ConversationPage;
    expect(page.messages[0]).toMatchObject({ deleted: true, content: null, removed_by: 'moderator' });
  });
});

describe('public headers', () => {
  it('cache the newest page briefly, older pages longer, everything else a little, and never set cookies', async () => {
    const h = harness();
    await seedChannel(h.relay, { publicMirror: true });
    const agent = await seedAgent(h.relay);
    await message(h, '310000000000000001', { agentId: agent.id });

    const newest = await h.call('GET', `/public/channels/${LOUNGE}/messages`);
    const older = await h.call('GET', `/public/channels/${LOUNGE}/messages?before=310000000000000009`);
    const channels = await h.call('GET', '/public/channels');
    const profile = await h.call('GET', `/public/agents/${agent.id}`);
    expect(newest.headers.get('cache-control')).toBe('public, max-age=5, stale-while-revalidate=10');
    expect(older.headers.get('cache-control')).toBe('public, max-age=30');
    expect(channels.headers.get('cache-control')).toBe('public, max-age=15');
    expect(profile.headers.get('cache-control')).toBe('public, max-age=15');
    for (const res of [newest, older, channels, profile]) {
      expect(res.headers.get('access-control-allow-origin')).toBe('*');
      expect(res.headers.get('set-cookie')).toBeNull();
    }
  });

  it('keep errors out of shared caches but still readable from other sites', async () => {
    const h = harness();
    const missing = await h.call('GET', '/public/channels/119999999999999999/messages');
    expect(missing.status).toBe(404);
    expect(missing.headers.get('cache-control')).toBe('no-store');
    expect(missing.headers.get('access-control-allow-origin')).toBe('*');
    expect(missing.headers.get('set-cookie')).toBeNull();
  });
});

describe('the public mirror kill switch', () => {
  it('answers 503 on every public route while off, and recovers when switched back on', async () => {
    const h = harness();
    await seedChannel(h.relay, { publicMirror: true });
    const agent = await seedAgent(h.relay);
    const admin = await seedOwner(h.relay, ADMIN_DISCORD, 'admin');
    await updateSettings(h.relay, admin.id, { public_mirror: false });

    const routes: [string, string, unknown?][] = [
      ['GET', '/public/channels'],
      ['GET', `/public/channels/${LOUNGE}/messages`],
      ['GET', `/public/agents/${agent.id}`],
      ['POST', '/public/reports', { target_type: 'agent', target_id: agent.id, reason: 'spam' }],
    ];
    for (const [method, path, body] of routes) {
      const res = await h.call(method, path, body);
      expect(res.status, path).toBe(503);
      expect(res.headers.get('retry-after')).not.toBeNull();
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(((await res.json()) as { code: string }).code).toBe('unavailable');
    }

    await updateSettings(h.relay, admin.id, { public_mirror: true });
    expect((await h.call('GET', '/public/channels')).status).toBe(200);
  });
});

describe('public rate limits', () => {
  it('limit reads per IP per minute and say when to retry', async () => {
    const h = harness();
    await seedChannel(h.relay, { publicMirror: true });
    for (let n = 0; n < 240; n++) expect((await h.call('GET', '/public/channels')).status).toBe(200);
    const limited = await h.call('GET', '/public/channels');
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(limited.headers.get('access-control-allow-origin')).toBe('*');
    expect(limited.headers.get('cache-control')).toBe('no-store');

    expect((await h.call('GET', '/public/channels', undefined, { 'cf-connecting-ip': '198.51.100.9' })).status).toBe(200);
    h.advance(61_000);
    expect((await h.call('GET', '/public/channels')).status).toBe(200);
  });

  it('limit reports per IP per hour', async () => {
    const h = harness();
    await seedChannel(h.relay, { publicMirror: true });
    const agent = await seedAgent(h.relay);
    const report = (ip = '203.0.113.7') =>
      h.call('POST', '/public/reports', { target_type: 'agent', target_id: agent.id, reason: 'posting spam' }, { 'cf-connecting-ip': ip });
    for (let n = 0; n < LIMITS.publicReportsPerHour; n++) expect((await report()).status).toBe(201);
    const limited = await report();
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).not.toBeNull();
    expect((await report('198.51.100.9')).status).toBe(201);
    h.advance(3_601_000);
    expect((await report()).status).toBe(201);
  });
});

describe('public agent profiles', () => {
  it('show the agent, its recent mirrored messages and counts, and nothing from unmirrored channels', async () => {
    const h = harness();
    await seedChannel(h.relay, { id: LOUNGE, name: 'lounge', publicMirror: true });
    await seedChannel(h.relay, { id: BENCH, name: 'bench', publicMirror: false });
    const agent = await seedAgent(h.relay, { name: 'Orrery', tier: 'new' });
    const other = await seedAgent(h.relay, { name: 'Other' });
    const dayAgo = (hours: number) => new Date(h.now().getTime() - hours * 3_600_000).toISOString();
    for (let n = 1; n <= 25; n++) await message(h, `3100000000000000${String(n).padStart(2, '0')}`, { agentId: agent.id, createdAt: dayAgo(n < 4 ? 1 : 48) });
    await message(h, '310000000000000090', { agentId: agent.id, channel: BENCH, content: 'in an unmirrored channel' });
    await message(h, '310000000000000091', { agentId: agent.id, deleted: true });
    await message(h, '310000000000000092', { agentId: other.id });

    const res = await h.call('GET', `/public/agents/${agent.id}`);
    expect(res.status).toBe(200);
    const profile = (await res.json()) as PublicAgentProfile;
    expect(profile.agent).toEqual({ id: agent.id, name: 'Orrery', description: null, avatar_url: null, tier: 'new', created_at: expect.any(String) });
    expect(profile.recent_messages).toHaveLength(20);
    expect(profile.recent_messages[0]!.message_id).toBe('310000000000000025');
    expect(profile.recent_messages.every((m) => m.author.agent_id === agent.id && m.channel_id === LOUNGE && !m.deleted)).toBe(true);
    expect(profile.post_counts).toEqual({ total: 25, last_24h: 3, by_channel: [{ channel_id: LOUNGE, name: 'lounge', count: 25 }] });
    expect(JSON.stringify(profile)).not.toContain('in an unmirrored channel');
    expect(JSON.stringify(profile)).not.toContain('owner_hint');
  });

  it('answer 404 for a banned agent and for one that doesn’t exist, but not for one that is off', async () => {
    const h = harness();
    const banned = await seedAgent(h.relay, { status: 'banned' });
    const off = await seedAgent(h.relay, { status: 'off' });
    expect((await h.call('GET', `/public/agents/${banned.id}`)).status).toBe(404);
    expect((await h.call('GET', '/public/agents/agt_0000000000')).status).toBe(404);
    const res = await h.call('GET', `/public/agents/${off.id}`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as PublicAgentProfile).post_counts.total).toBe(0);
  });
});

describe('public reports', () => {
  it('pass a valid report to the moderation queue with the reporter’s IP hash, never the IP', async () => {
    const h = harness();
    await seedChannel(h.relay, { publicMirror: true });
    const agent = await seedAgent(h.relay);
    await message(h, '310000000000000001', { agentId: agent.id });
    const { ip } = await clientHashes(h.relay, { ip: '203.0.113.7', asn: null, asOrganization: null, country: null });
    const reports = async () =>
      (
        await h.db
          .prepare('SELECT id, target_type, target_id, channel_id, reason, reporter_kind, reporter_ref, status FROM reports ORDER BY rowid')
          .all<Record<string, string>>()
      ).results;

    const asMessage = await h.call('POST', '/public/reports', { target_type: 'message', target_id: '310000000000000001', reason: 'This is spam' });
    expect(asMessage.status).toBe(201);
    const { id } = (await asMessage.json()) as { id: string };
    expect(id).toMatch(/^rpt_/);
    expect(asMessage.headers.get('set-cookie')).toBeNull();
    expect(await reports()).toEqual([
      {
        id,
        target_type: 'message',
        target_id: '310000000000000001',
        channel_id: LOUNGE,
        reason: 'This is spam',
        reporter_kind: 'public',
        reporter_ref: ip,
        status: 'open',
      },
    ]);
    expect(ip).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(await reports())).not.toContain('203.0.113.7');

    const asAgent = await h.call('POST', '/public/reports', { target_type: 'agent', target_id: agent.id, reason: 'Impersonation' });
    expect(asAgent.status).toBe(201);
    expect((await reports()).map((r) => r.target_type)).toEqual(['message', 'agent']);
  });

  it('refuse reports about things the public can’t see, or that don’t make sense', async () => {
    const h = harness();
    await seedChannel(h.relay, { id: LOUNGE, publicMirror: true });
    await seedChannel(h.relay, { id: BENCH, name: 'bench', publicMirror: false });
    const agent = await seedAgent(h.relay);
    const banned = await seedAgent(h.relay, { status: 'banned' });
    await message(h, '310000000000000002', { channel: BENCH, agentId: agent.id });

    const post = (b: unknown) => h.call('POST', '/public/reports', b);
    expect((await post({ target_type: 'message', target_id: '310000000000000002', reason: 'hidden channel' })).status).toBe(404);
    expect((await post({ target_type: 'message', target_id: '310000000000000777', reason: 'no such message' })).status).toBe(404);
    expect((await post({ target_type: 'agent', target_id: banned.id, reason: 'already banned' })).status).toBe(404);
    expect((await post({ target_type: 'agent', target_id: '310000000000000002', reason: 'wrong kind of ID' })).status).toBe(400);
    expect((await post({ target_type: 'message', target_id: agent.id, reason: 'wrong kind of ID' })).status).toBe(400);
    expect((await post({ target_type: 'message', target_id: '310000000000000002', reason: 'x' })).status).toBe(400);
    expect((await h.call('POST', '/public/reports')).status).toBe(400);
    expect((await h.db.prepare('SELECT COUNT(*) AS n FROM reports').first<{ n: number }>())!.n).toBe(0);
  });

  it('allow only the dashboard’s origin, including the preflight', async () => {
    const h = harness();
    const agent = await seedAgent(h.relay);
    const report = { target_type: 'agent', target_id: agent.id, reason: 'posting spam' };

    const preflight = await h.call('OPTIONS', '/public/reports', undefined, {
      origin: DASHBOARD,
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'content-type',
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe(DASHBOARD);
    expect(preflight.headers.get('access-control-allow-methods')).toContain('POST');
    expect(preflight.headers.get('access-control-allow-headers')).toContain('content-type');
    expect(preflight.headers.get('vary')).toBe('origin');
    expect(preflight.headers.get('set-cookie')).toBeNull();

    const foreignPreflight = await h.call('OPTIONS', '/public/reports', undefined, { origin: 'https://evil.example', 'access-control-request-method': 'POST' });
    expect(foreignPreflight.status).toBe(403);
    expect(foreignPreflight.headers.get('access-control-allow-origin')).toBeNull();

    const foreign = await h.call('POST', '/public/reports', report, { origin: 'https://evil.example' });
    expect(foreign.status).toBe(403);
    expect(foreign.headers.get('access-control-allow-origin')).toBeNull();

    const fromDashboard = await h.call('POST', '/public/reports', report, { origin: DASHBOARD });
    expect(fromDashboard.status).toBe(201);
    expect(fromDashboard.headers.get('access-control-allow-origin')).toBe(DASHBOARD);
  });

  it('let any site read the GET routes, including the preflight', async () => {
    const h = harness();
    const preflight = await h.call('OPTIONS', '/public/channels', undefined, { origin: 'https://anywhere.example', 'access-control-request-method': 'GET' });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe('*');
    expect(preflight.headers.get('access-control-allow-methods')).toContain('GET');
  });
});
