import { LIMITS } from '@logitland/contracts';
import { describe, expect, it } from 'vitest';
import { checkAvatarUrl, checkName } from './services/names';
import { clientHashes, purgeRawIpsJob, pruneOriginsJob, recordOrigin } from './services/origins';
import { asOwner, count, easyChallenges, getChallenge, ipHeader, signUp, signedUp, solve } from './signup.helpers';
import { NO_CLIENT, type ClientInfo } from './types';
import { ADMIN_DISCORD, harness, seedAgent, seedOwner, type Harness } from './testing';

const DAY = 86_400_000;
const at = (ip: string): ClientInfo => ({ ...NO_CLIENT, ip, asn: 64496, asOrganization: 'Example Net', country: 'NL' });

async function withAdmin() {
  const h = harness();
  const admin = await seedOwner(h.relay, ADMIN_DISCORD, 'admin');
  const act = (agentId: string, body: Record<string, unknown>) => h.internal('POST', `/internal/admin/agents/${agentId}/status`, body, asOwner(admin.id));
  return { h, admin, act };
}

const bans = (h: Harness, agentId: string) =>
  h.db
    .prepare('SELECT kind, hash, created_at, expires_at FROM banned_origins WHERE agent_id = ? ORDER BY kind')
    .bind(agentId)
    .all<{ kind: string; hash: string; created_at: string; expires_at: string }>();

describe('bans stick', () => {
  it('records every address and network on file for a banned agent, with an expiry', async () => {
    const { h, act } = await withAdmin();
    const a = await seedAgent(h.relay, { name: 'Bad Actor' });
    await recordOrigin(h.relay, a.id, at('203.0.113.7'), 'signup');
    await recordOrigin(h.relay, a.id, at('203.0.113.7'), 'use');
    await recordOrigin(h.relay, a.id, at('2001:db8:1:2::9'), 'use');
    expect((await act(a.id, { action: 'suspend', reason: 'spam' })).status).toBe(200);
    expect((await bans(h, a.id)).results).toEqual([]);
    expect((await act(a.id, { action: 'ban', reason: 'spam again' })).status).toBe(200);

    const { results } = await bans(h, a.id);
    const v4 = await clientHashes(h.relay, at('203.0.113.7'));
    const v6 = await clientHashes(h.relay, at('2001:db8:1:2::9'));
    // Every address on file, but only the network it signed up from: the IPv6 network it merely used stays open.
    expect(results.map((r) => r.hash).sort()).toEqual([v4.ip, v4.net, v6.ip].sort());
    expect(results.filter((r) => r.kind === 'ip')).toHaveLength(2);
    for (const r of results) expect(r.expires_at).toBe(new Date(h.now().getTime() + LIMITS.bannedOriginDays * DAY).toISOString());
    expect(JSON.stringify(results)).not.toContain('203.0.113');
  });

  it('refuses signups from a banned address or network with a plain 403 until the record expires', async () => {
    const { h, act } = await withAdmin();
    await easyChallenges(h);
    const bad = await signedUp(h, 'Bad Actor', { headers: ipHeader('203.0.113.7') });
    await act(bad.registration_id, { action: 'ban', reason: 'spam' });
    expect((await bans(h, bad.registration_id)).results).toHaveLength(2);

    for (const ip of ['203.0.113.7', '203.0.113.99']) {
      const res = await signUp(h, `Back Again ${ip.slice(-2)}`, { headers: ipHeader(ip) });
      expect(res.status, ip).toBe(403);
    }
    expect(await count(h, 'SELECT COUNT(*) AS n FROM agents')).toBe(1);
    expect((await signUp(h, 'Somewhere Else', { headers: ipHeader('198.51.100.9') })).status).toBe(200);

    h.advance(LIMITS.bannedOriginDays * DAY + 1000);
    expect((await signUp(h, 'Much Later', { headers: ipHeader('203.0.113.7') })).status).toBe(200);
  });

  it('leaves a challenge unspent when the origin is banned', async () => {
    const { h, act } = await withAdmin();
    await easyChallenges(h);
    const bad = await signedUp(h, 'Bad Actor', { headers: ipHeader('203.0.113.7') });
    const c = await getChallenge(h, ipHeader('203.0.113.7'));
    await act(bad.registration_id, { action: 'ban', reason: 'spam' });
    const res = await h.call(
      'POST',
      '/agent/identity',
      { type: 'anonymous', name: 'Back Again', pow: { challenge: c.challenge, nonce: solve(c.challenge, c.difficulty) } },
      ipHeader('203.0.113.7'),
    );
    expect(res.status).toBe(403);
    expect(await h.db.prepare('SELECT used_at FROM pow_challenges WHERE id = ?').bind(c.challenge).first()).toEqual({ used_at: null });
  });

  it('keeps the banned agent’s name out of reach, lookalikes included', async () => {
    const { h, act } = await withAdmin();
    await easyChallenges(h);
    const bad = await signedUp(h, 'Bad Actor', { headers: ipHeader('203.0.113.7') });
    await act(bad.registration_id, { action: 'ban', reason: 'spam' });
    for (const name of ['Bad Actor', 'bad-actor']) expect((await signUp(h, name, { headers: ipHeader('198.51.100.9') })).status, name).toBe(409);
    expect((await signUp(h, 'Вad Actor', { headers: ipHeader('198.51.100.9') })).status).toBe(422);
  });

  it('is lifted when an admin reinstates the agent, and writes nothing for a ban that lost the race', async () => {
    const { h, act } = await withAdmin();
    const a = await seedAgent(h.relay, { name: 'Maybe Bad' });
    await recordOrigin(h.relay, a.id, at('203.0.113.7'), 'signup');
    await act(a.id, { action: 'ban', reason: 'spam' });
    expect((await act(a.id, { action: 'ban', reason: 'again' })).status).toBe(409);
    expect((await bans(h, a.id)).results).toHaveLength(2);
    expect((await act(a.id, { action: 'reinstate', reason: 'mistake' })).status).toBe(200);
    expect((await bans(h, a.id)).results).toEqual([]);
    await easyChallenges(h);
    expect((await signUp(h, 'Fresh Start', { headers: ipHeader('203.0.113.7') })).status).toBe(200);
  });
});

describe('origin retention', () => {
  const origins = (h: Harness) => h.db.prepare('SELECT agent_id, kind FROM agent_origins ORDER BY id').all<{ agent_id: string; kind: string }>();

  it('deletes origin rows 90 days after they were last seen, and nothing newer', async () => {
    const h = harness();
    const a = await seedAgent(h.relay);
    await recordOrigin(h.relay, a.id, at('203.0.113.7'), 'signup');
    h.advance(60 * DAY);
    await recordOrigin(h.relay, a.id, at('198.51.100.1'), 'use');
    expect(await pruneOriginsJob(h.relay)).toBe(0);
    h.advance(LIMITS.originRetentionDays * DAY - 60 * DAY + 1000);
    expect(await pruneOriginsJob(h.relay)).toBe(1);
    expect((await origins(h)).results).toEqual([{ agent_id: a.id, kind: 'use' }]);
    h.advance(60 * DAY);
    expect(await pruneOriginsJob(h.relay)).toBe(1);
    expect((await origins(h)).results).toEqual([]);
  });

  it('keeps a banned agent’s rows until its ban record expires, then removes them with it', async () => {
    const { h, act } = await withAdmin();
    const banned = await seedAgent(h.relay, { name: 'Banned One' });
    const other = await seedAgent(h.relay, { name: 'Other One' });
    await recordOrigin(h.relay, banned.id, at('203.0.113.7'), 'signup');
    await recordOrigin(h.relay, other.id, at('198.51.100.1'), 'signup');
    h.advance(80 * DAY);
    await act(banned.id, { action: 'ban', reason: 'spam' });
    h.advance(15 * DAY);
    // 95 days old: the other agent's row goes, the banned agent's stays while its record runs.
    expect(await pruneOriginsJob(h.relay)).toBe(1);
    expect((await origins(h)).results).toEqual([{ agent_id: banned.id, kind: 'signup' }]);
    expect(await count(h, 'SELECT COUNT(*) AS n FROM banned_origins')).toBe(2);
    h.advance(LIMITS.bannedOriginDays * DAY);
    // Expired ban records (2) and the agent's now-unprotected row (1).
    expect(await pruneOriginsJob(h.relay)).toBe(3);
    expect((await origins(h)).results).toEqual([]);
    expect(await count(h, 'SELECT COUNT(*) AS n FROM banned_origins')).toBe(0);
  });

  it('works through a backlog in rounds', async () => {
    const h = harness();
    const a = await seedAgent(h.relay);
    const old = new Date(h.now().getTime() - 200 * DAY).toISOString();
    const insert = h.db.prepare("INSERT INTO agent_origins (agent_id, kind, ip_hmac, net_hmac, seen_at) VALUES (?, 'use', 'x', 'y', ?)");
    await h.db.batch(Array.from({ length: 1200 }, () => insert.bind(a.id, old)));
    expect(await pruneOriginsJob(h.relay)).toBe(1200);
    expect(await count(h, 'SELECT COUNT(*) AS n FROM agent_origins')).toBe(0);
  });

  it('clears the purge time with the sealed address, so purged rows are never read again', async () => {
    const h = harness();
    const a = await seedAgent(h.relay);
    await recordOrigin(h.relay, a.id, at('203.0.113.7'), 'signup');
    h.advance((LIMITS.rawIpRetentionDays + 1) * DAY);
    expect(await purgeRawIpsJob(h.relay)).toBe(1);
    expect(await h.db.prepare('SELECT ip_sealed, ip_purge_after FROM agent_origins').first()).toEqual({ ip_sealed: null, ip_purge_after: null });
    expect(await purgeRawIpsJob(h.relay)).toBe(0);
  });

  it('purges a backlog in rounds, and says in the query plan that it uses the purge index', async () => {
    const h = harness();
    const a = await seedAgent(h.relay);
    const due = new Date(h.now().getTime() - DAY).toISOString();
    const insert = h.db.prepare(
      "INSERT INTO agent_origins (agent_id, kind, ip_hmac, net_hmac, ip_sealed, ip_purge_after, seen_at) VALUES (?, 'use', 'x', 'y', 's', ?, ?)",
    );
    await h.db.batch(Array.from({ length: 1100 }, () => insert.bind(a.id, due, due)));
    expect(await purgeRawIpsJob(h.relay)).toBe(1100);
    expect(await count(h, 'SELECT COUNT(*) AS n FROM agent_origins WHERE ip_sealed IS NOT NULL')).toBe(0);
    const plan = (
      await (h.db as unknown as { raw: { prepare(sql: string): { all(...p: unknown[]): { detail: string }[] } } }).raw
        .prepare('EXPLAIN QUERY PLAN SELECT id FROM agent_origins WHERE ip_purge_after <= ? LIMIT 500')
        .all('2030-01-01')
    )
      .map((r) => r.detail)
      .join(' ');
    expect(plan).toContain('agent_origins_purge');
  });
});

describe('searching the registry', () => {
  it('refuses a search too long for D1’s 50-byte LIKE pattern, and accepts one that fits', async () => {
    const { h, admin } = await withAdmin();
    await seedAgent(h.relay, { name: 'Findable Bot' });
    const search = (q: string) => h.internal('GET', `/internal/admin/agents?q=${encodeURIComponent(q)}`, undefined, asOwner(admin.id));
    const fits = await search('x'.repeat(48));
    expect(fits.status).toBe(200);
    const tooLong = await search('x'.repeat(49));
    expect(tooLong.status).toBe(400);
    expect((await tooLong.json()).detail).toContain('too long');
    expect((await search('é'.repeat(25))).status).toBe(400);
    expect((await search('_'.repeat(25))).status).toBe(400);
    expect((await search('a'.repeat(300))).status).toBe(400);
    const found = await (await search('findable')).json();
    expect(found.agents).toHaveLength(1);
  });
});

describe('the fixed message rules on profile text', () => {
  it('refuse names that are blocked sites, and still allow ordinary ones', () => {
    expect(checkName('bit.ly')).toMatchObject({ ok: false, code: 'blocked_domain' });
    expect(checkName('Moth-9')).toEqual({ ok: true });
  });

  it('keep avatars off blocked sites only', () => {
    expect(checkAvatarUrl('https://bit.ly/a.png')).toMatchObject({ ok: false, code: 'blocked_domain' });
    expect(checkAvatarUrl('https://cdn.example.com/photos/1234-5678-9012.png')).toEqual({ ok: true });
  });
});
