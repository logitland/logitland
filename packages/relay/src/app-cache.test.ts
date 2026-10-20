import { describe, expect, it } from 'vitest';
import { checkConfig, type RelayBindings } from './config';
import { SecretBox } from './crypto';
import { DEFAULT_SETTINGS, updateSettings } from './services/settings';
import { ADMIN_DISCORD, harness, seedAgent, seedChannel, seedOwner, type Harness } from './testing';

// Workers Cache keeps a 200 with no Cache-Control for two hours and answers a hit without running the Worker. So
// everything the relay serves is private until its handler says otherwise.

describe('cache headers', () => {
  it('keep the dashboard API out of every cache', async () => {
    const h = harness();
    const admin = await seedOwner(h.relay, ADMIN_DISCORD, 'admin');
    const headers = { 'x-logitland-owner': admin.id };
    for (const path of ['/internal/admin/health', '/internal/admin/audit', '/internal/admin/settings']) {
      const res = await h.internal('GET', path, undefined, headers);
      expect(res.status, path).toBe(200);
      expect(res.headers.get('cache-control'), path).toBe('private, no-store');
    }
    const denied = await h.internal('GET', '/internal/admin/health', undefined, { 'x-logitland-owner': 'own_nobody' });
    expect(denied.status).toBeGreaterThanOrEqual(400);
    expect(denied.headers.get('cache-control')).toBe('private, no-store');
  });

  it('keep agent routes out of every cache, answers and errors alike', async () => {
    const h = harness();
    const agent = await seedAgent(h.relay);
    const ok = await h.call('GET', '/v1/subscriptions', undefined, h.as(agent.key));
    expect(ok.status).toBe(200);
    expect(ok.headers.get('cache-control')).toBe('private, no-store');
    const unauthenticated = await h.call('GET', '/v1/subscriptions');
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.headers.get('cache-control')).toBe('private, no-store');
    const unknown = await h.call('GET', '/v1/nothing-here', undefined, h.as(agent.key));
    expect(unknown.status).toBe(404);
    expect(unknown.headers.get('cache-control')).toBe('private, no-store');
  });

  it('leave a handler’s own choice alone, and let only the docs be shared', async () => {
    const h = harness();
    await seedChannel(h.relay);
    const agent = await seedAgent(h.relay);
    expect((await h.call('GET', '/')).headers.get('cache-control')).toBe('public, max-age=300');
    expect((await h.call('GET', '/auth.md')).headers.get('cache-control')).toBe('public, max-age=300');
    expect((await h.call('GET', '/rules.md')).headers.get('cache-control')).toBe('public, max-age=300');
    // An explicit no-store from the handler stays as it is.
    expect((await h.call('GET', '/v1/channels', undefined, h.as(agent.key))).headers.get('cache-control')).toBe('no-store');
  });
});

describe('the audit trail pages without skipping entries', () => {
  it('follows (created_at, id), so entries that share a millisecond are all seen once', async () => {
    const h = harness();
    const admin = await seedOwner(h.relay, ADMIN_DISCORD, 'admin');
    const same = '2026-10-19T03:00:00.000Z';
    const rows = [
      ['aud_a', same],
      ['aud_b', same],
      ['aud_c', same],
      ['aud_d', same],
      ['aud_e', '2026-10-19T02:59:59.000Z'],
      ['aud_f', '2026-10-19T03:00:01.000Z'],
    ] as const;
    for (const [id, at] of rows)
      await h.db
        .prepare(
          "INSERT INTO audit_log (id, actor_type, actor_id, action, target_type, target_id, created_at) VALUES (?, 'system', 'x', 'test', 'thing', 't', ?)",
        )
        .bind(id, at)
        .run();

    const seen: string[] = [];
    let before: string | null = null;
    for (let page = 0; page < 10; page++) {
      const res = await h.internal('GET', `/internal/admin/audit?limit=2${before ? `&before=${encodeURIComponent(before)}` : ''}`, undefined, {
        'x-logitland-owner': admin.id,
      });
      const body = (await res.json()) as { entries: { id: string }[]; next_before: string | null };
      seen.push(...body.entries.map((e) => e.id));
      before = body.next_before;
      if (!before) break;
    }
    expect(seen).toEqual(['aud_f', 'aud_d', 'aud_c', 'aud_b', 'aud_a', 'aud_e']);
  });

  it('still takes a bare timestamp as "older than this"', async () => {
    const h = harness();
    const admin = await seedOwner(h.relay, ADMIN_DISCORD, 'admin');
    for (const [id, at] of [
      ['aud_a', '2026-10-19T03:00:00.000Z'],
      ['aud_b', '2026-10-19T02:00:00.000Z'],
    ])
      await h.db
        .prepare(
          "INSERT INTO audit_log (id, actor_type, actor_id, action, target_type, target_id, created_at) VALUES (?, 'system', 'x', 'test', 'thing', 't', ?)",
        )
        .bind(id, at)
        .run();
    const res = await h.internal('GET', `/internal/admin/audit?before=${encodeURIComponent('2026-10-19T03:00:00.000Z')}`, undefined, {
      'x-logitland-owner': admin.id,
    });
    expect(((await res.json()) as { entries: { id: string }[] }).entries.map((e) => e.id)).toEqual(['aud_b']);
  });

  it('counts the health page’s last hour of messages from the index on created_at', async () => {
    const h = harness();
    const plan = await h.db
      .prepare(
        'EXPLAIN QUERY PLAN SELECT status AS k, COUNT(*) AS n FROM relay_messages INDEXED BY relay_messages_created WHERE created_at > ? GROUP BY status',
      )
      .bind('2026-10-19T02:00:00.000Z')
      .all<{ detail: string }>();
    expect(plan.results.map((r) => r.detail).join(' ')).toMatch(/SEARCH relay_messages USING (COVERING )?INDEX relay_messages_created \(created_at>\?\)/);
    // And the health page itself runs it.
    const admin = await seedOwner(h.relay, ADMIN_DISCORD, 'admin');
    expect((await h.internal('GET', '/internal/admin/health', undefined, { 'x-logitland-owner': admin.id })).status).toBe(200);
  });
});

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
  JEV_LAYA_URL: 'https://jev.logitland.org/review',
  JEV_LAYA_TOKEN: 't',
  ADMIN_DISCORD_IDS: '200000000000000099',
  ...over,
});

/** Only what is said about the token: other settings have their own checks. */
const tokenProblems = (token: string) => checkConfig(prodEnv({ INTERNAL_TOKEN: token })).filter((p) => p.startsWith('INTERNAL_TOKEN'));

describe('INTERNAL_TOKEN is refused for what is wrong with it, not for what it happens to contain', () => {
  it('accepts a random token even if it spells dev, test or change', () => {
    for (const token of ['aB3dEvK9x2Qm7TeSt4pL0cHaNgEz81Rw5uYv6Ji', 'x'.repeat(20) + 'TEST' + 'y'.repeat(20), 'changeK7m2Qp9Xv4Lr8Zt1Wn6Bj3Hc5Dg0Fs']) {
      expect(tokenProblems(token), token).toEqual([]);
    }
  });

  it('says a short or missing token is too short', () => {
    expect(tokenProblems('short')).toEqual(['INTERNAL_TOKEN must be at least 32 random characters']);
    expect(tokenProblems('')).toEqual(['INTERNAL_TOKEN must be at least 32 random characters']);
  });

  it('says an example value is an example value, however long it has been padded', () => {
    for (const token of ['dev-internal-token' + '0'.repeat(20), 'Test-Internal-Token' + '0'.repeat(20), 'changeme'.repeat(5)]) {
      expect(tokenProblems(token), token).toEqual(['INTERNAL_TOKEN is still an example value; generate a new one']);
    }
  });
});

describe('queries that used to scan', () => {
  async function plan(h: Harness, sql: string, ...args: unknown[]) {
    return (
      await h.db
        .prepare(`EXPLAIN QUERY PLAN ${sql}`)
        .bind(...args)
        .all<{ detail: string }>()
    ).results
      .map((r) => r.detail)
      .join(' | ');
  }

  it('read a page of the audit trail from an index', async () => {
    const h = harness();
    const audit = await plan(h, 'SELECT * FROM audit_log WHERE (created_at, id) < (?, ?) ORDER BY created_at DESC, id DESC LIMIT 5', 'a', 'b');
    expect(audit).toContain('SEARCH audit_log USING INDEX audit_log_created');
    expect(audit).not.toContain('TEMP B-TREE');
  });
});

describe('the health page’s kill switches', () => {
  it('list every on/off setting, including the ones added later, and follow them', async () => {
    const h = harness();
    const admin = await seedOwner(h.relay, ADMIN_DISCORD, 'admin');
    const health = async () =>
      (
        (await (await h.internal('GET', '/internal/admin/health', undefined, { 'x-logitland-owner': admin.id })).json()) as {
          switches: Record<string, boolean>;
        }
      ).switches;

    const switches = Object.entries(DEFAULT_SETTINGS)
      .filter(([, v]) => typeof v === 'boolean')
      .map(([k]) => k);
    expect(switches).toContain('deliveries_paused');
    expect(Object.keys(await health()).sort()).toEqual([...switches].sort());
    expect((await health()).deliveries_paused).toBe(false);

    await updateSettings(h.relay, admin.id, { deliveries_paused: true, relay_read_only: true });
    expect(await health()).toMatchObject({ deliveries_paused: true, relay_read_only: true });
  });
});
