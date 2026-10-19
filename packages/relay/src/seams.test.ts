import { describe, expect, it } from 'vitest';
import { checkConfig, type RelayBindings } from './config';
import { SecretBox } from './crypto';
import { handleScheduled } from './jobs';
import { enforce, hit, sweepCountersJob } from './services/limits';
import { readPage } from './services/conversation';
import { openWebhook, usableChannel } from './services/channels';
import { getSettings, updateSettings } from './services/settings';
import { ADMIN_DISCORD, BENCH, LOUNGE, harness, seedAgent, seedChannel, seedOwner } from './testing';

const prodEnv = (over: Partial<RelayBindings> = {}): RelayBindings => ({
  DB: {} as RelayBindings['DB'],
  RELAY_SECRET_KEY: SecretBox.generateKey(),
  INTERNAL_TOKEN: 'k'.repeat(40),
  IP_HASH_KEY: 'h'.repeat(40),
  PUBLIC_URL: 'https://relay.logitland.org',
  DASHBOARD_URL: 'https://logitland.org',
  DISCORD_BOT_TOKEN: 'x',
  DISCORD_APPLICATION_ID: '1',
  DISCORD_PUBLIC_KEY: 'ab',
  DISCORD_GUILD_ID: '2',
  DISCORD_CONSENT_ROLE_ID: '3',
  JEV_LAYA_URL: 'https://jev.logitland.org/review',
  JEV_LAYA_TOKEN: 't',
  ADMIN_DISCORD_IDS: '200000000000000099',
  ...over,
});

describe('configuration fails closed', () => {
  it('accepts a complete production configuration', () => {
    expect(checkConfig(prodEnv())).toEqual([]);
  });

  it('names every missing or unsafe setting', () => {
    const problems = checkConfig(prodEnv({ DISCORD_BOT_TOKEN: undefined, INTERNAL_TOKEN: 'dev-internal-token', PUBLIC_URL: 'http://localhost:8787', JEV_LAYA_URL: undefined }));
    expect(problems).toEqual(
      expect.arrayContaining([
        'DISCORD_BOT_TOKEN is missing',
        'INTERNAL_TOKEN must be at least 32 random characters',
        'PUBLIC_URL must use https',
        'PUBLIC_URL points at a local host',
        'No classifier: set JEV_LAYA_URL and JEV_LAYA_TOKEN, or bind AI',
      ]),
    );
  });

  it('accepts Workers AI alone as the classifier', () => {
    expect(checkConfig(prodEnv({ JEV_LAYA_URL: undefined, JEV_LAYA_TOKEN: undefined, AI: { run: async () => ({}) } }))).toEqual([]);
  });

  it('refuses placeholders and development mode in public', () => {
    expect(checkConfig(prodEnv({ PUBLIC_URL: 'https://relay.REPLACE.invalid' }))).toContain('PUBLIC_URL is still a placeholder');
    expect(checkConfig(prodEnv({ RELAY_MODE: 'development' }))).toContain('RELAY_MODE=development is only allowed on a local PUBLIC_URL');
    expect(checkConfig(prodEnv({ RELAY_MODE: 'staging' }))).toContain('RELAY_MODE must be unset outside development');
  });
});

describe('sealed secrets', () => {
  it('bind ciphertext to where it lives', async () => {
    const box = new SecretBox({ id: 'k1', key: SecretBox.generateKey() });
    const sealed = await box.seal('https://discord.com/api/webhooks/1/abc', 'channels.webhook:1');
    expect(await box.open(sealed, 'channels.webhook:1')).toBe('https://discord.com/api/webhooks/1/abc');
    await expect(box.open(sealed, 'channels.webhook:2')).rejects.toThrow();
  });

  it('open values sealed with an older key after rotation', async () => {
    const oldKey = SecretBox.generateKey();
    const before = new SecretBox({ id: 'k1', key: oldKey });
    const sealed = await before.seal('secret', 'x:1');
    const after = new SecretBox({ id: 'k2', key: SecretBox.generateKey() }, [{ id: 'k1', key: oldKey }]);
    expect(await after.open(sealed, 'x:1')).toBe('secret');
    expect(after.isStale(sealed)).toBe(true);
    expect(after.isStale(await after.seal('secret', 'x:1'))).toBe(false);
  });
});

describe('rate counters', () => {
  it('count within a window and reset in the next', async () => {
    const h = harness();
    const l = { key: 'test:a:m', limit: 2, windowSeconds: 60 };
    expect((await hit(h.relay, l)).ok).toBe(true);
    expect((await hit(h.relay, l)).ok).toBe(true);
    const third = await hit(h.relay, l);
    expect(third.ok).toBe(false);
    expect(third.retryAfterSeconds).toBeGreaterThan(0);
    h.advance(61_000);
    expect((await hit(h.relay, l)).ok).toBe(true);
    await expect(enforce(h.relay, [{ ...l, limit: 0 }], 'Too many')).rejects.toMatchObject({ status: 429 });
    h.advance(3 * 86_400_000);
    expect(await sweepCountersJob(h.relay)).toBeGreaterThan(0);
  });
});

describe('settings', () => {
  it('default, change with an audit entry, and ignore no-ops', async () => {
    const h = harness();
    expect((await getSettings(h.relay)).signup_open).toBe(true);
    const owner = await seedOwner(h.relay, ADMIN_DISCORD, 'admin');
    const after = await updateSettings(h.relay, owner.id, { signup_open: false });
    expect(after.signup_open).toBe(false);
    await updateSettings(h.relay, owner.id, { signup_open: false });
    const { results } = await h.db.prepare("SELECT action FROM audit_log WHERE action = 'settings.updated'").all();
    expect(results).toHaveLength(1);
  });
});

describe('channel policy', () => {
  it('lets every agent read open channels and post where posting is on', async () => {
    const h = harness();
    await seedChannel(h.relay, { id: LOUNGE, access: 'post' });
    await seedChannel(h.relay, { id: BENCH, access: 'read_only', name: 'bench' });
    expect((await usableChannel(h.relay, LOUNGE, 'send')).id).toBe(LOUNGE);
    expect((await usableChannel(h.relay, BENCH, 'read')).id).toBe(BENCH);
    await expect(usableChannel(h.relay, BENCH, 'send')).rejects.toMatchObject({ status: 403 });
    await expect(usableChannel(h.relay, '119999999999999999', 'read')).rejects.toMatchObject({ status: 404 });
    expect((await openWebhook(h.relay, (await usableChannel(h.relay, LOUNGE, 'send'))))?.id).toBe('600000000000000001');
  });
});

describe('conversation reads', () => {
  it('orders snowflakes numerically and hides people who haven’t agreed from the public', async () => {
    const h = harness();
    const ins = (id: string, kind: string, person: string | null, content: string) =>
      h.db
        .prepare("INSERT INTO conversation (message_id, channel_id, author_kind, agent_id, author_ref, discord_user_id, display_name, content, created_at) VALUES (?, ?, ?, NULL, 'p_x', ?, 'name', ?, '2026-10-19T03:00:00.000Z')")
        .bind(id, LOUNGE, kind, person, content)
        .run();
    await ins('999999999999999999', 'agent', null, 'older, 18 digits');
    await ins('1234567890123456789', 'human', '700000000000000001', 'newer, 19 digits');
    const agentView = await readPage(h.relay, LOUNGE, { view: 'agent' });
    expect(agentView.messages.map((m) => m.message_id)).toEqual(['1234567890123456789', '999999999999999999']);
    expect(agentView.messages[0]!.content).toBe('newer, 19 digits');
    const publicView = await readPage(h.relay, LOUNGE, { view: 'public' });
    expect(publicView.messages[0]!.content).toBeNull();
    expect(publicView.messages[0]!.author.display_name).toBe('A person in Discord');
    await h.db.prepare("INSERT INTO consents (discord_user_id, guild_id, method, granted_at) VALUES ('700000000000000001', '1', 'command', '2026-10-19T03:00:00Z')").run();
    expect((await readPage(h.relay, LOUNGE, { view: 'public' })).messages[0]!.content).toBe('newer, 19 digits');
    expect((await readPage(h.relay, LOUNGE, { view: 'agent', before: '1234567890123456789' })).messages.map((m) => m.message_id)).toEqual(['999999999999999999']);
  });
});

describe('apps', () => {
  it('keep the dashboard API off the public app', async () => {
    const h = harness();
    expect((await h.call('GET', '/internal/admin/audit')).status).toBe(404);
  });

  it('bind owner routes to the signed-in owner and guard admin routes', async () => {
    const h = harness();
    const admin = await seedOwner(h.relay, ADMIN_DISCORD, 'admin');
    const person = await seedOwner(h.relay, '200000000000000002', 'person');
    expect((await h.internal('GET', `/internal/owners/${person.id}/agents`, undefined, { 'x-logitland-owner': admin.id })).status).toBe(403);
    expect((await h.internal('GET', '/internal/admin/audit', undefined, { 'x-logitland-owner': person.id })).status).toBe(403);
    expect((await h.internal('GET', '/internal/admin/audit', undefined, { 'x-logitland-owner': admin.id })).status).toBe(200);
    expect((await h.internal('GET', '/internal/admin/audit', undefined, { 'x-logitland-owner': admin.id, 'x-logitland-internal': 'wrong' })).status).toBe(401);
  });

  it('cap request bodies and answer problems as JSON', async () => {
    const h = harness();
    const res = await h.call('POST', '/v1/agents', { name: 'x'.repeat(70_000) });
    expect(res.status).toBe(413);
    expect(res.headers.get('content-type')).toContain('application/problem+json');
  });

  it('authenticate agents by key without needing an owner', async () => {
    const h = harness();
    const unowned = await seedAgent(h.relay, { tier: 'new', ownerId: null });
    const suspended = await seedAgent(h.relay, { status: 'suspended' });
    const { authenticateKey } = await import('./services/identity');
    expect((await authenticateKey(h.relay, unowned.key, { ip: null, asn: null, asOrganization: null, country: null })).agent.tier).toBe('new');
    await expect(authenticateKey(h.relay, suspended.key, { ip: null, asn: null, asOrganization: null, country: null })).rejects.toMatchObject({ status: 403 });
    await expect(authenticateKey(h.relay, 'lk_nope', { ip: null, asn: null, asOrganization: null, country: null })).rejects.toMatchObject({ status: 401 });
  });
});

describe('cron', () => {
  it('runs every job and keeps going when one fails', async () => {
    const h = harness({ gateway: { ensure: async () => Promise.reject(new Error('gateway down')), status: async () => ({}) } });
    const out = await handleScheduled(h.relay);
    expect(out.gateway).toBe('failed');
    expect(out.held).toBe(0);
    expect(h.log.lines.some((l) => l.event === 'cron.job_failed' && l.fields.job === 'gateway')).toBe(true);
  });
});
